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

from riot_client import RiotTFTClient

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


def collect_ladder_puuids(client: RiotTFTClient, platform: str,
                          tiers: list[str], limit_per_tier: int) -> list[tuple[str, str, int]]:
    """Returns [(puuid, tier, leaguePoints)]."""
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
    return out


def crawl(platform: str, tiers: list[str], players_per_tier: int,
          matches_per_player: int, lookback_days: int, db_path: Path = DB_PATH) -> None:
    client = RiotTFTClient()
    conn = open_db(db_path)
    now = int(time.time())
    start_time = now - lookback_days * 86400

    players = collect_ladder_puuids(client, platform, tiers, players_per_tier)
    log.info("collected %d ladder players on %s", len(players), platform)

    conn.executemany(
        "INSERT OR REPLACE INTO players(puuid, platform, tier, lp, seen_at) VALUES (?,?,?,?,?)",
        [(p, platform, t, lp, now) for p, t, lp in players],
    )
    conn.commit()

    known = {r[0] for r in conn.execute("SELECT match_id FROM matches")}
    log.info("%d matches already stored", len(known))

    new_count = 0
    for i, (puuid, tier, _lp) in enumerate(players, 1):
        ids = client.match_ids(platform, puuid, count=matches_per_player,
                               start_time=start_time) or []
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
