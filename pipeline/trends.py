"""
Day-bucketed time series: how each unit, item, trait and comp moved over time.

WHY THIS ISN'T A SNAPSHOT ARCHIVE
---------------------------------
The obvious way to build trends is to save a copy of every publish and diff
them later, which means the feature shows nothing until you've published for a
week. It isn't necessary: every match row already carries `game_datetime`, so
the same history can be reconstructed from the store you already have, on the
first run, and it stays correct if a crawl is skipped or re-run. Archiving
builds would also pin the numbers to whatever sample each publish happened to
hold, where bucketing by match date gives every day the same treatment.

The cost is that a day's bucket keeps filling while crawls continue to pull
older matches, so recent days firm up over the following runs rather than being
final the moment they're written. That's the right trade for a tier list --
a stale-but-stable wrong number is worse than one that sharpens.

PATCH BOUNDARIES
----------------
Deliberately NOT filtered to the current patch. A trend that stops at the patch
boundary can't show the thing you actually want to see, which is what the patch
did. Each day records the patch that dominated it so the client can mark the
boundary rather than silently splicing two different games together.

PLACE CHANGE
------------
A single delta per entity: mean placement over the last `window` days against
the `window` days before that. Both sides need `MIN_WINDOW_SAMPLE` boards or
the entity reports no change at all -- with a few thousand boards a day, a unit
played 20 times swings half a placement on noise alone, and shipping that as a
trend arrow would be inventing movement.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

from aggregate import Stat, comp_signature

log = logging.getLogger("trends")

# Days of history to publish. Beyond this the series is mostly previous sets
# and the file grows for no reading anyone does.
DEFAULT_DAYS = 21

# Days each side of the place-change comparison.
DEFAULT_WINDOW = 3

# Minimum boards on EACH side of the comparison before a delta is reported.
MIN_WINDOW_SAMPLE = 60

# Minimum boards for one entity in a day before that day gets a point on its
# line. Below this the marker is noise and drawing it implies a precision that
# isn't there.
MIN_DAY_SAMPLE = 15

# Minimum boards in a day before the day is charted at all.
#
# Needed independently of the per-entity floor because of partial days at both
# ends of the window: the current day is still being played, and the oldest is
# however far back the crawl happened to reach. Such a day passes the entity
# floor for a handful of units and produces a hard convergence spike at the
# edge of every chart -- twenty boards' worth of noise drawn with the same
# weight as a full day's three thousand.
MIN_DAY_TOTAL = 300

# Entities kept in the published series, ranked by total sample. The full set
# would be several megabytes and no chart plots 127 items at once.
TOP_N = {"units": 80, "items": 60, "traits": 50, "comps": 25}


def _day(ms: int | None) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _patch_of(game_version: str | None) -> str | None:
    import re
    if not game_version:
        return None
    m = re.search(r"(\d+)\.(\d+)", game_version)
    return f"{m.group(1)}.{m.group(2)}" if m else None


def _rows(conn: sqlite3.Connection, tft_set: int | None, platform: str | None,
          queue_id: int | None, puuid_filter: set[str] | None):
    """Match rows with their date, newest first. Mirrors aggregate's filters
    apart from the patch, which trends deliberately spans."""
    sql = "SELECT game_datetime, game_version, raw FROM matches WHERE 1=1"
    params: list = []
    if tft_set is not None:
        sql += " AND tft_set = ?"
        params.append(tft_set)
    if platform:
        sql += " AND platform = ?"
        params.append(platform)
    sql += " ORDER BY game_datetime DESC"

    for ts, gv, raw in conn.execute(sql, params):
        m = json.loads(raw)
        info = m.get("info", {})
        if queue_id is not None and info.get("queue_id") not in (queue_id, None):
            continue
        lobby = [p for p in info.get("participants", [])
                 if puuid_filter is None or p.get("puuid") in puuid_filter]
        if lobby:
            yield _day(ts), _patch_of(gv), lobby


def build_trends(conn: sqlite3.Connection, *, tft_set: int | None = None,
                 platform: str | None = None, queue_id: int | None = 1100,
                 puuid_filter: set[str] | None = None,
                 days: int = DEFAULT_DAYS, window: int = DEFAULT_WINDOW) -> dict:
    # (kind, entity_id, day) -> Stat
    series: dict[str, dict[str, dict[str, Stat]]] = {
        k: defaultdict(lambda: defaultdict(Stat)) for k in ("units", "items", "traits", "comps")
    }
    day_totals: Counter = Counter()
    day_patches: dict[str, Counter] = defaultdict(Counter)

    for day, patch, lobby in _rows(conn, tft_set, platform, queue_id, puuid_filter):
        if not day:
            continue
        for p in lobby:
            placement = p.get("placement")
            if not placement:
                continue
            day_totals[day] += 1
            if patch:
                day_patches[day][patch] += 1

            series["comps"][comp_signature(p)][day].add(placement)

            # Once-per-board for units and items, matching aggregate.py -- a
            # unit fielded twice or an item equipped on two carriers must not
            # count twice, or the play rate drifts above the board count.
            seen_units: set[str] = set()
            seen_items: set[str] = set()
            for u in p.get("units", []):
                cid = u.get("character_id")
                if cid and cid not in seen_units:
                    series["units"][cid][day].add(placement)
                    seen_units.add(cid)
                for it in u.get("itemNames") or []:
                    if it not in seen_items:
                        series["items"][it][day].add(placement)
                        seen_items.add(it)

            # Traits are collapsed across breakpoints here. The tier list splits
            # them because 4-of and 6-of are different decisions; a trend line
            # per breakpoint would be mostly gaps, since a given breakpoint is
            # only hit a few dozen times a day.
            for t in p.get("traits", []):
                name = t.get("name")
                if name and t.get("tier_current", 0) > 0:
                    series["traits"][name][day].add(placement)

    if not day_totals:
        return {"days": [], "series": {}, "change": {}, "day_samples": {}}

    all_days = [d for d in sorted(day_totals) if day_totals[d] >= MIN_DAY_TOTAL][-days:]
    if not all_days:
        return {"days": [], "series": {}, "change": {}, "day_samples": {},
                "thin_days": dict(day_totals)}
    keep = set(all_days)

    out_series: dict[str, dict[str, list]] = {}
    out_change: dict[str, dict[str, dict]] = {}

    # The most recent `window` days, and the `window` before them. Taken from
    # the days that actually have data rather than from the calendar, so a gap
    # in crawling shifts the comparison instead of emptying it.
    curr_days = set(all_days[-window:])
    prev_days = set(all_days[-2 * window:-window])

    for kind, entities in series.items():
        ranked = sorted(entities.items(),
                        key=lambda kv: -sum(s.n for d, s in kv[1].items() if d in keep))
        rows: dict[str, list] = {}
        changes: dict[str, dict] = {}

        for eid, by_day in ranked[:TOP_N[kind]]:
            points = []
            for d in all_days:
                s = by_day.get(d)
                if not s or s.n < MIN_DAY_SAMPLE:
                    continue
                points.append({
                    "d": d,
                    "n": s.n,
                    "place": round(s.avg, 3),
                    "win": round(s.win_rate, 4),
                    "top4": round(s.top4_rate, 4),
                    "rate": round(s.n / max(day_totals[d], 1), 4),
                })
            if points:
                rows[eid] = points

            curr = [by_day[d] for d in curr_days if d in by_day]
            prev = [by_day[d] for d in prev_days if d in by_day]
            n_curr = sum(s.n for s in curr)
            n_prev = sum(s.n for s in prev)
            if n_curr >= MIN_WINDOW_SAMPLE and n_prev >= MIN_WINDOW_SAMPLE:
                avg_curr = sum(s.placement_sum for s in curr) / n_curr
                avg_prev = sum(s.placement_sum for s in prev) / n_prev
                changes[eid] = {
                    "delta": round(avg_curr - avg_prev, 3),
                    "curr": round(avg_curr, 3),
                    "prev": round(avg_prev, 3),
                    "n_curr": n_curr,
                    "n_prev": n_prev,
                }

        out_series[kind] = rows
        out_change[kind] = changes

    return {
        "generated_at": int(time.time()),
        "days": all_days,
        "day_samples": {d: day_totals[d] for d in all_days},
        "day_patches": {d: (day_patches[d].most_common(1)[0][0] if day_patches[d] else None)
                        for d in all_days},
        "window": window,
        "window_days": {"current": sorted(curr_days), "previous": sorted(prev_days)},
        "min_window_sample": MIN_WINDOW_SAMPLE,
        # Days held back for thin sample, so the client can say the series stops
        # short on purpose rather than looking like the crawl broke.
        "thin_days": {d: n for d, n in sorted(day_totals.items()) if n < MIN_DAY_TOTAL},
        "series": out_series,
        "change": out_change,
    }


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    ap = argparse.ArgumentParser(description="Build the day-bucketed trend series.")
    ap.add_argument("--db", default="tft.db")
    ap.add_argument("--set", type=int, dest="tft_set")
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS)
    ap.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    ap.add_argument("--out", default="trends.json")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    conn = sqlite3.connect(args.db)
    t = build_trends(conn, tft_set=args.tft_set, days=args.days, window=args.window)
    Path(args.out).write_text(json.dumps(t, indent=2))
    print(f"{len(t['days'])} days: {t['days'][0] if t['days'] else '-'} .. "
          f"{t['days'][-1] if t['days'] else '-'}")
    for kind, rows in t["series"].items():
        print(f"  {kind:7s} {len(rows):3d} series, {len(t['change'][kind]):3d} with a measurable change")
