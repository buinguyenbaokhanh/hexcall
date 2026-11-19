"""
Ingestion crawler: ladder -> PUUIDs -> match IDs -> match JSON -> SQLite.

Design notes
------------
* High-elo bias is intentional. Aggregating Challenger/GM/Master gives you a
  cleaner signal for "what is actually strong" than all-rank data, which mostly
  measures what is popular. Run a second pass over Diamond/Emerald if you want
  a separate lower-rank tier list -- comps that need tight execution look far
  worse there, which is useful information for your users.
* Every match is stored raw. Aggregation is a separate step so you can recompute
  tier lists with new logic without re-crawling.
* Checkpointed: safe to kill and restart. Already-seen match IDs are skipped.
* Riot's docs note fresh matches are cheaper to look up than old ones, so crawl
  continuously with a short lookback rather than backfilling months of history.

Usage:
    export RIOT_API_KEY=RGAPI-...
    python ingest.py --platform na1 --tiers challenger grandmaster --matches-per-player 20
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import time
from pathlib import Path

from riot_client import RiotTFTClient, PLATFORM_TO_REGION

log = logging.getLogger("ingest")

DB_PATH = Path("tft.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS matches (
    match_id      TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    game_datetime INTEGER,
    game_version  TEXT,
    tft_set       INTEGER,
    queue_id      INTEGER,
    raw           TEXT NOT NULL,
    fetched_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_version ON matches(game_version);
CREATE INDEX IF NOT EXISTS idx_matches_set ON matches(tft_set);

CREATE TABLE IF NOT EXISTS players (
    puuid      TEXT PRIMARY KEY,
    platform   TEXT NOT NULL,
    tier       TEXT,
    lp         INTEGER,
    seen_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def open_db(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


# Tiers to fall back through when the apex ladders are empty, best first.
#
# They ARE empty for the first days of a new set: ranked resets with the set,
# and nobody has climbed to Master yet. On Set 18's launch day every apex
# ladder on na1, euw1, sg2 and kr returned zero entries, which made the crawler
# collect no players and store nothing while reporting success -- the same
# silent-failure shape as the SEA routing bug, arriving from a different
# direction.
#
# Descending is deliberate. Seeding from the highest tier that actually has
# players keeps the population as close to the usual one as the ladder allows,
# and the crawl narrows back to apex on its own as players climb.
FALLBACK_TIERS = ["DIAMOND", "EMERALD", "PLATINUM", "GOLD", "SILVER", "BRONZE"]

# Divisions within a tier, best first. I is the top of each tier.
DIVISIONS = ["I", "II", "III", "IV"]


def collect_ladder_puuids(client: RiotTFTClient, platform: str,
                          tiers: list[str], limit_per_tier: int) -> list[tuple[str, str, int]]:
    """Returns [(puuid, tier, leaguePoints)].

    Tries the requested apex tiers, then walks down the regular ladder if those
    come back empty, so a set rollover degrades the POPULATION rather than
    producing an empty crawl. What it actually seeded is logged and stored, so
    the publisher can describe the population instead of assuming apex.
    """
    out: list[tuple[str, str, int]] = []
    for tier in tiers:
        data = client.apex_league(platform, tier)
        if not data:
            log.warning("no data for %s %s", platform, tier)
            continue
        entries = data.get("entries", [])
        entries.sort(key=lambda e: e.get("leaguePoints", 0), reverse=True)
        for e in entries[:limit_per_tier]:
            # tft-league-v1 returns puuid directly on modern responses.
            puuid = e.get("puuid")
            if puuid:
                out.append((puuid, tier.upper(), e.get("leaguePoints", 0)))
        log.info("%s %s -> %d players", platform, tier, min(len(entries), limit_per_tier))

    if out:
        return out

    log.warning("%s: every apex ladder is empty -- this is normal for the first "
                "days of a set, when ranked has reset. Falling back down the "
                "ladder so the crawl collects something rather than silently "
                "storing nothing.", platform)
    want = limit_per_tier * max(len(tiers), 1)
    seen = set()
    used: list[str] = []
    for tier in FALLBACK_TIERS:
        got_here = 0
        for div in DIVISIONS:
            page = 1
            while len(out) < want:
                entries = client.league_entries(platform, tier, div, page=page) or []
                if not entries:
                    break
                for e in entries:
                    puuid = e.get("puuid")
                    if puuid and puuid not in seen:
                        seen.add(puuid)
                        out.append((puuid, tier, e.get("leaguePoints", 0)))
                        got_here += 1
                        if len(out) == want:
                            break
                page += 1
            if len(out) >= want:
                break
        if got_here:
            used.append(tier)
        # Keep descending until there are ENOUGH players, not merely some. A
        # thinly populated tier during a rollover yields a handful -- EUW gave
        # 11 from Emerald -- and stopping there seeds a twentieth of the
        # intended crawl while looking like it worked.
        if len(out) >= want:
            break
    if used:
        log.info("%s: seeded %d players from %s", platform, len(out),
                 used[0] if len(used) == 1 else f"{used[0]}-{used[-1]}")
    if not out:
        log.error("%s: no players found in any tier. Either the region is dead "
                  "or the ladder has not been populated yet.", platform)
    return out


def crawl(platform: str, tiers: list[str], players_per_tier: int,
          matches_per_player: int, lookback_days: int, db_path: Path = DB_PATH) -> None:
    client = RiotTFTClient()
    conn = open_db(db_path)
    now = int(time.time())
    start_time = now - lookback_days * 86400

    players = collect_ladder_puuids(client, platform, tiers, players_per_tier)
    if not players:
        raise RuntimeError(f"no ladder players found on {platform}")
    log.info("collected %d ladder players on %s", len(players), platform)

    conn.executemany(
        "INSERT OR REPLACE INTO players(puuid, platform, tier, lp, seen_at) VALUES (?,?,?,?,?)",
        [(p, platform, t, lp, now) for p, t, lp in players],
    )
    conn.commit()

    known = {r[0] for r in conn.execute("SELECT match_id FROM matches")}
    log.info("%d matches already stored", len(known))

    new_count = 0
    empty_streak = 0
    for i, (puuid, tier, _lp) in enumerate(players, 1):
        ids = client.match_ids(platform, puuid, count=matches_per_player,
                               start_time=start_time) or []
        # A wrong regional cluster returns HTTP 200 with an empty list, which is
        # indistinguishable from a player who simply hasn't played. Ladder
        # players have by definition played, so a run of empties in a row means
        # the requests are going somewhere that has never heard of them --
        # almost always PLATFORM_TO_REGION. Without this the crawl reports
        # success and stores nothing.
        if not ids:
            empty_streak += 1
            if empty_streak == 15:
                log.error(
                    "15 consecutive ladder players on %s returned no matches. "
                    "These are ranked players, so they have games -- this is "
                    "almost certainly the wrong regional cluster for %s "
                    "(currently routing to '%s'). Check PLATFORM_TO_REGION.",
                    platform, platform, PLATFORM_TO_REGION.get(platform, "?"))
        else:
            empty_streak = 0
        todo = [m for m in ids if m not in known]
        for mid in todo:
            m = client.match(platform, mid)
            if not m:
                continue
            info = m.get("info", {})
            conn.execute(
                "INSERT OR REPLACE INTO matches"
                "(match_id, platform, game_datetime, game_version, tft_set, queue_id, raw, fetched_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (
                    mid, platform,
                    info.get("game_datetime"),
                    info.get("game_version"),
                    info.get("tft_set_number"),
                    info.get("queue_id"),
                    json.dumps(m, separators=(",", ":")),
                    int(time.time()),
                ),
            )
            known.add(mid)
            new_count += 1
        conn.commit()
        if i % 10 == 0:
            log.info("player %d/%d, %d new matches stored", i, len(players), new_count)

    log.info("done: %d new matches on %s", new_count, platform)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", default="na1",
                    help="na1, euw1, kr, sg2, ...")
    ap.add_argument("--tiers", nargs="+", default=["challenger", "grandmaster"],
                    choices=["challenger", "grandmaster", "master"])
    ap.add_argument("--players-per-tier", type=int, default=100)
    ap.add_argument("--matches-per-player", type=int, default=20)
    ap.add_argument("--lookback-days", type=int, default=3,
                    help="Keep this short; the current patch is what matters.")
    ap.add_argument("--db", default="tft.db")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    crawl(args.platform, args.tiers, args.players_per_tier,
          args.matches_per_player, args.lookback_days, Path(args.db))


if __name__ == "__main__":
    main()
