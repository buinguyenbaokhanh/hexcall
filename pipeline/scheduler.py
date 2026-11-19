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
  * A personal key (20 req/s, 100 req/2min) supports a daily crawl of three
    regions' apex ladders -- what .github/workflows/crawl.yml runs. Much more
    depth or frequency than that needs a production key.

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
import time
from pathlib import Path

from ingest import crawl
from publish import publish

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


def cycle(platforms: list[str], tiers: list[str], players_per_tier: int,
          matches_per_player: int, lookback_days: int, db: str,
          tft_set: int | None, comp_names: dict | None) -> int:
    """One crawl + publish pass. Returns how many platforms failed to crawl."""
    state = load_state()

    failed = 0
    for platform in platforms:
        try:
            crawl(platform, tiers, players_per_tier, matches_per_player,
                  lookback_days, Path(db))
        except Exception:
            # One region failing must not stop the others or block publishing.
            log.exception("crawl failed for %s -- continuing", platform)
            failed += 1

    if failed == len(platforms):
        return failed

    try:
        out = publish(db, tft_set, comp_names)
        state["last_publish"] = int(time.time())
        state["last_build"] = out.name
        log.info("published build %s", out.name)
    except Exception:
        log.exception("publish failed -- previous build stays live")

    save_state(state)
    return failed


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
            failed = cycle(args.platforms, args.tiers, args.players_per_tier,
                           args.matches_per_player, args.lookback_days, args.db,
                           args.tft_set, names)
            elapsed = time.time() - started
            log.info("=== cycle done in %.1f min ===", elapsed / 60)

            if args.once:
                # Every region failing is almost always the key (missing,
                # revoked, regenerated) rather than Riot. The loop above
                # swallows it so publishing still runs, which is right for a
                # long-lived service but turns a scheduled CI run green while
                # it does nothing -- so a one-shot run reports it.
                if failed == len(args.platforms):
                    raise SystemExit(f"all {failed} platform crawls failed -- check RIOT_API_KEY")
                return
            sleep_for = max(0.0, args.interval_hours * 3600 - elapsed)
            log.info("sleeping %.1f h", sleep_for / 3600)
            time.sleep(sleep_for)


if __name__ == "__main__":
    main()
