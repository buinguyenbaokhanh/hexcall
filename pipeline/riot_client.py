"""
Rate-limited client for the Riot Teamfight Tactics API.

Endpoints used (all documented at https://developer.riotgames.com/apis):
  tft-league-v1   -> platform routing (na1, euw1, kr, sg2, ...)
  tft-match-v1    -> regional routing (americas, europe, asia)

Personal (development) keys are limited to roughly:
  20 requests / 1 second
  100 requests / 2 minutes
Production keys are far higher. This client enforces the personal-key limits by
default; raise them via RateLimiter if you get approved for a production key.

The API key is read from the RIOT_API_KEY environment variable. Never hardcode
it -- Riot's security policy explicitly forbids shipping keys in distributed code.
"""

from __future__ import annotations

import os
import time
import threading
import logging
from collections import deque
from typing import Any

import requests

log = logging.getLogger("riot")

PLATFORM_TO_REGION = {
    "na1": "americas", "br1": "americas", "la1": "americas", "la2": "americas",
    "euw1": "europe", "eun1": "europe", "tr1": "europe", "ru": "europe",
    "kr": "asia", "jp1": "asia", "oc1": "asia", "ph2": "asia", "sg2": "asia",
    "th2": "asia", "tw2": "asia", "vn2": "asia",
}


class RateLimiter:
    """Sliding-window limiter enforcing several (count, seconds) budgets at once."""

    def __init__(self, budgets: list[tuple[int, float]] | None = None):
        # Default = Riot personal/development key limits.
        self.budgets = budgets or [(20, 1.0), (100, 120.0)]
        self._hits: list[deque] = [deque() for _ in self.budgets]
        self._lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                wait = 0.0
                for (limit, window), hits in zip(self.budgets, self._hits):
                    while hits and now - hits[0] > window:
                        hits.popleft()
                    if len(hits) >= limit:
                        wait = max(wait, window - (now - hits[0]) + 0.01)
                if wait == 0.0:
                    for hits in self._hits:
                        hits.append(now)
                    return
            time.sleep(wait)


class RiotTFTClient:
    def __init__(self, api_key: str | None = None, limiter: RateLimiter | None = None,
                 max_retries: int = 5):
        self.api_key = api_key or os.environ.get("RIOT_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "No API key. Set RIOT_API_KEY in your environment "
                "(get one at https://developer.riotgames.com)."
            )
        self.limiter = limiter or RateLimiter()
        self.max_retries = max_retries
        self.session = requests.Session()
        self.session.headers.update({"X-Riot-Token": self.api_key})

    # ---------------- core request ----------------

    def _get(self, host: str, path: str, params: dict | None = None) -> Any:
        url = f"https://{host}{path}"
        for attempt in range(self.max_retries):
            self.limiter.acquire()
            try:
                r = self.session.get(url, params=params, timeout=15)
            except requests.RequestException as e:
                log.warning("network error %s (attempt %d)", e, attempt + 1)
                time.sleep(2 ** attempt)
                continue

            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                # Riot tells you exactly how long to wait. Respect it.
                retry_after = float(r.headers.get("Retry-After", "5"))
                log.warning("429 rate limited, sleeping %.1fs", retry_after)
                time.sleep(retry_after + 0.5)
                continue
            if r.status_code == 404:
                return None
            if 500 <= r.status_code < 600:
                log.warning("server %d, backing off", r.status_code)
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (401, 403):
                raise RuntimeError(
                    f"{r.status_code} from Riot -- key is invalid or expired. "
                    "Personal keys expire every 24 hours; regenerate it."
                )
            r.raise_for_status()
        raise RuntimeError(f"gave up on {url} after {self.max_retries} attempts")

    # ---------------- account-v1 ----------------

    def account_by_riot_id(self, region: str, game_name: str, tag_line: str) -> dict | None:
        """Riot ID -> account (incl. puuid). region in {americas, europe, asia}.

        Summoner names were retired in favour of Riot IDs (gameName#tagLine),
        so this is the correct entry point for "look up my account".
        """
        from urllib.parse import quote
        return self._get(
            f"{region}.api.riotgames.com",
            f"/riot/account/v1/accounts/by-riot-id/{quote(game_name)}/{quote(tag_line)}",
        )

    # ---------------- tft-league-v1 ----------------

    def apex_league(self, platform: str, tier: str) -> dict | None:
        """tier in {challenger, grandmaster, master}. Returns a LeagueListDTO."""
        return self._get(f"{platform}.api.riotgames.com",
                         f"/tft/league/v1/{tier}")

    def league_entries(self, platform: str, tier: str, division: str,
                       page: int = 1, queue: str = "RANKED_TFT") -> list | None:
        """Non-apex tiers, e.g. tier=DIAMOND division=I. Paginated."""
        return self._get(
            f"{platform}.api.riotgames.com",
            f"/tft/league/v1/entries/{tier}/{division}",
            {"queue": queue, "page": page},
        )

    # ---------------- tft-match-v1 ----------------

    def match_ids(self, platform: str, puuid: str, count: int = 20,
                  start: int = 0, start_time: int | None = None) -> list[str] | None:
        region = PLATFORM_TO_REGION[platform]
        params: dict[str, Any] = {"count": count, "start": start}
        if start_time:
            params["startTime"] = start_time
        return self._get(f"{region}.api.riotgames.com",
                         f"/tft/match/v1/matches/by-puuid/{puuid}/ids", params)

    def match(self, platform: str, match_id: str) -> dict | None:
        region = PLATFORM_TO_REGION[platform]
        return self._get(f"{region}.api.riotgames.com",
                         f"/tft/match/v1/matches/{match_id}")
