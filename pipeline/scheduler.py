"""
Scheduler: crawl -> aggregate -> publish, on a loop.

Run this as a systemd service, a Docker container, or a cron entry. It is the
only process that holds your Riot API key.

    export RIOT_API_KEY=RGAPI-...
    python scheduler.py --platforms na1 euw1 kr --interval-hours 6

Cadence
-------
Six hours is a reasonable default. Considerations:
  * Riot's docs note fresh matches are cheaper to look up than old ones, so
    frequent short crawls beat occasional deep backfills.
  * A patch drops roughly every two weeks and invalidates the meta. Detect the
    version change and start a fresh window rather than blending patches --
    mixed-patch stats are actively misleading right after a balance change.
  * A personal key (20 req/s, 100 req/2min) realistically supports one region
    at modest depth. Plan for a production key before going multi-region.

Failure policy
--------------
A failed crawl must never take down serving. If crawling raises, the previous
build stays live and the loop retries next cycle -- stale data beats no data.
A failed publish leaves `current` pointing at the last good build.
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import time
from pathlib import Path

from ingest import crawl
from publish import publish, current_patch, patch_filter

log = logging.getLogger("scheduler")
LOCK = Path("scheduler.lock")
STATE = Path("scheduler_state.json")


class Lock:
    """Stops two schedulers double-spending your rate limit."""

    def __init__(self, path: Path = LOCK, stale_after: int = 3 * 3600):
        self.path, self.stale_after = path, stale_after

    def __enter__(self):
        if self.path.exists():
            age = time.time() - self.path.stat().st_mtime
            if age < self.stale_after:
                raise RuntimeError(
                    f"another scheduler is running (lock {age:.0f}s old). "
                    f"Delete {self.path} if that's wrong.")
            log.warning("clearing stale lock (%.0fs old)", age)
        self.path.write_text(str(time.time()))
        return self

    def __exit__(self, *exc):
        self.path.unlink(missing_ok=True)


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(s: dict) -> None:
    STATE.write_text(json.dumps(s, indent=2))


def prune_old_patches(db: str, keep_patch: str) -> int:
    """Drop matches from previous patches.

    This is deliberate, not just housekeeping: after a balance patch the old
    data describes a game that no longer exists. Keeping it inflates your
    sample size while degrading accuracy, which is the worst trade available.

    Uses publish.patch_filter for the pattern. Building it inline here is what
    destroyed a 2,920-match store once already: live game_version reads
    "Linux Version 16.16.804.9184 (...)", so a literal "Version 16.16.%"
    prefix matched nothing, NOT LIKE therefore matched everything, and the
    prune deleted the entire table the first time the detected patch changed.

    The guard below is the real protection. A prune that would remove
    everything is always a bug in the pattern rather than a genuine state --
    even a total patch rollover leaves the matches just crawled on the new
    one -- so it refuses instead of emptying the store.
    """
    conn = sqlite3.connect(db)
    total = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    keeping = conn.execute("SELECT COUNT(*) FROM matches WHERE game_version LIKE ?",
                           (patch_filter(keep_patch),)).fetchone()[0]
    if total and keeping == 0:
        log.error("refusing to prune: no match would survive keep_patch=%r "
                  "(pattern %r matched 0 of %d rows) -- check game_version parsing",
                  keep_patch, patch_filter(keep_patch), total)
        return 0
    cur = conn.execute("DELETE FROM matches WHERE game_version NOT LIKE ?",
                       (patch_filter(keep_patch),))
    conn.commit()
    return cur.rowcount


def cycle(platforms: list[str], tiers: list[str], players_per_tier: int,
          matches_per_player: int, lookback_days: int, db: str,
          tft_set: int | None, comp_names: dict | None) -> None:
    state = load_state()

    for platform in platforms:
        try:
            crawl(platform, tiers, players_per_tier, matches_per_player,
                  lookback_days, Path(db))
        except Exception:
            # One region failing must not stop the others or block publishing.
            log.exception("crawl failed for %s -- continuing", platform)

    patch = current_patch(sqlite3.connect(db))
    if patch and state.get("patch") and patch != state["patch"]:
        removed = prune_old_patches(db, patch)
        log.warning("patch changed %s -> %s; pruned %d stale matches",
                    state["patch"], patch, removed)
    state["patch"] = patch

    try:
        out = publish(db, tft_set, comp_names)
        state["last_publish"] = int(time.time())
        state["last_build"] = out.name
        log.info("published build %s", out.name)
    except Exception:
        log.exception("publish failed -- previous build stays live")

    save_state(state)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platforms", nargs="+", default=["na1"])
    ap.add_argument("--tiers", nargs="+", default=["challenger", "grandmaster"])
    ap.add_argument("--players-per-tier", type=int, default=100)
    ap.add_argument("--matches-per-player", type=int, default=20)
    ap.add_argument("--lookback-days", type=int, default=3)
    ap.add_argument("--interval-hours", type=float, default=6.0)
    ap.add_argument("--once", action="store_true", help="single cycle, then exit (for cron)")
    ap.add_argument("--db", default="tft.db")
    ap.add_argument("--set", type=int, dest="tft_set")
    ap.add_argument("--comp-names")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    names = json.loads(Path(args.comp_names).read_text()) if args.comp_names else None

    with Lock():
        while True:
            started = time.time()
            log.info("=== cycle start: %s ===", ", ".join(args.platforms))
            cycle(args.platforms, args.tiers, args.players_per_tier,
                  args.matches_per_player, args.lookback_days, args.db,
                  args.tft_set, names)
            elapsed = time.time() - started
            log.info("=== cycle done in %.1f min ===", elapsed / 60)

            if args.once:
                return
            sleep_for = max(0.0, args.interval_hours * 3600 - elapsed)
            log.info("sleeping %.1f h", sleep_for / 3600)
            time.sleep(sleep_for)


if __name__ == "__main__":
    main()
