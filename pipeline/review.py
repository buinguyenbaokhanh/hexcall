"""
Personal match review -- find the mistakes you repeat.

This is post-game analysis, which Riot's TFT policy explicitly encourages:
"Products that help players improve their skills over time are encouraged.
Pre-game best practices or post-game analysis are great spaces for this."

It looks at YOUR last N ranked games and compares them against the aggregate
statistics the pipeline already publishes, to surface leaks you can't see from
a single game. Most players lose LP to the same two or three mistakes over and
over and have no idea which ones.

WHAT match-v1 ACTUALLY GIVES YOU
--------------------------------
An end-of-game snapshot per participant: placement, level, last_round,
gold_left, augments, traits, units, items, players_eliminated,
total_damage_to_players. There is NO round-by-round history -- overlays that
show your HP curve get it from the game client, not this API. So every leak
below is derived from end-state data plus lobby comparison, which is honest
about what's measurable rather than inventing a narrative.

THE LEAKS
---------
1. Augment fit       -- did you take augments that suit the comp you played?
                        Uses the augment->comp lift table. This is the one the
                        big sites don't really do.
2. Gold hoarding     -- gold left when you were eliminated.
3. Level tempo       -- your level vs. lobby peers who reached the same round.
4. Comp flexibility  -- are you forcing one comp regardless of what you're given?
5. Comp skill gap    -- which comps do you underperform the field in?
6. Exit timing       -- where your bottom-4 games actually end.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from aggregate import comp_signature, is_legend_augment

log = logging.getLogger("review")

# Thresholds. These are judgement calls, not physics -- tune them once you've
# looked at your own data. Each is stated in the output so the user can argue.
GOLD_HOARD_THRESHOLD = 25       # gold left at elimination
LEVEL_BEHIND_THRESHOLD = 0.4    # levels behind lobby peers at same round
FORCE_RATE_THRESHOLD = 0.45     # share of games in one comp
MIN_GAMES_FOR_COMP_VERDICT = 4
MIN_GAMES = 10                  # below this, say so rather than guess


def fetch_history(client, region: str, platform: str, game_name: str,
                  tag_line: str, count: int = 20) -> tuple[str, list[dict]]:
    """Resolve a Riot ID and pull their recent ranked matches."""
    acct = client.account_by_riot_id(region, game_name, tag_line)
    if not acct:
        raise RuntimeError(f"No account found for {game_name}#{tag_line} in {region}")
    puuid = acct["puuid"]

    ids = client.match_ids(platform, puuid, count=count) or []
    matches = []
    for mid in ids:
        m = client.match(platform, mid)
        if m and m.get("info", {}).get("queue_id") in (1100, None):
            matches.append(m)
    return puuid, matches


def _me(match: dict, puuid: str) -> dict | None:
    for p in match.get("info", {}).get("participants", []):
        if p.get("puuid") == puuid:
            return p
    return None


# --- individual leak detectors -------------------------------------------

def leak_augment_fit(games: list[dict], stats: dict) -> dict | None:
    """Did your augments suit the comp you actually played?

    For each game: sum the measured lift of your augments in the comp you ended
    on, and compare against the best available alternative you could have taken
    from that same choice set. We can't see the choices you declined -- the API
    doesn't record them -- so this measures fit, not decision quality, and the
    output says so.
    """
    pair = {(p["augment"], p["comp"]): p for p in stats["augment_comp_pairs"]}
    rows, total_lift, measured = [], 0.0, 0

    for g in games:
        sig = g["sig"]
        per_aug = []
        for a in g["augments"]:
            rec = pair.get((a, sig))
            if rec:
                per_aug.append({
                    "augment": a,
                    "name": stats["augment_names"].get(a, a),
                    "lift": rec["lift_vs_comp"],
                    "n": rec["n"],
                })
        if not per_aug:
            continue
        game_lift = sum(x["lift"] for x in per_aug)
        total_lift += game_lift
        measured += 1
        worst = min(per_aug, key=lambda x: -x["lift"])
        if worst["lift"] > 0.25:
            rows.append({
                "comp": stats["comp_names"].get(sig, sig),
                "augment": worst["name"],
                "lift": round(worst["lift"], 2),
                "placement": g["placement"],
            })

    if measured < 3:
        return None

    avg = total_lift / measured
    rows.sort(key=lambda r: -r["lift"])
    return {
        "id": "augment_fit",
        "title": "Augment fit with your comp",
        "severity": "high" if avg > 0.25 else "medium" if avg > 0.1 else "ok",
        "metric": f"{avg:+.2f} avg placement from augment/comp fit",
        "detail": (
            "Positive means your augments historically make the comp you played "
            "perform worse than its baseline. Negative means they suit it."
            if avg > 0 else
            "Your augments generally suit the comps you commit to."
        ),
        "examples": rows[:4],
        "caveat": "Measures fit only. The API doesn't record the augments you declined, "
                  "so this can't tell you whether a better option was on offer.",
    }


def leak_gold_hoarding(games: list[dict]) -> dict | None:
    golds = [g["gold_left"] for g in games if g["gold_left"] is not None]
    if len(golds) < MIN_GAMES // 2:
        return None
    avg = statistics.mean(golds)
    bad = [g for g in games
           if (g["gold_left"] or 0) >= GOLD_HOARD_THRESHOLD and g["placement"] >= 5]
    return {
        "id": "gold_hoarding",
        "title": "Gold left when eliminated",
        "severity": "high" if avg >= GOLD_HOARD_THRESHOLD else "medium" if avg >= 15 else "ok",
        "metric": f"{avg:.0f} gold on average",
        "detail": (
            f"You died holding {GOLD_HOARD_THRESHOLD}+ gold in {len(bad)} of your "
            f"bottom-4 games. Gold banked at elimination is gold that never became "
            f"board strength."
            if bad else
            "You're generally spending down before you die."
        ),
        "examples": [{"placement": g["placement"], "gold": g["gold_left"],
                      "round": g["last_round"]} for g in bad[:4]],
    }


def leak_level_tempo(games: list[dict]) -> dict | None:
    """Your level vs. lobby peers who survived to the same round."""
    diffs = []
    for g in games:
        peers = [p for p in g["lobby"]
                 if abs((p.get("last_round") or 0) - (g["last_round"] or 0)) <= 1
                 and p.get("puuid") != g["puuid"]]
        if len(peers) >= 2:
            diffs.append(g["level"] - statistics.mean(p["level"] for p in peers))
    if len(diffs) < MIN_GAMES // 2:
        return None
    avg = statistics.mean(diffs)
    behind = avg < -LEVEL_BEHIND_THRESHOLD
    ahead = avg > LEVEL_BEHIND_THRESHOLD
    return {
        "id": "level_tempo",
        "title": "Level relative to your lobby",
        "severity": "medium" if (behind or ahead) else "ok",
        "metric": f"{avg:+.2f} levels vs. peers at the same round",
        "detail": (
            "You're consistently behind the lobby on level. That usually means "
            "over-saving or rolling too early, and it costs you board slots at "
            "the moment fights get decided."
            if behind else
            "You're leveling ahead of your lobby. That's fine with a strong econ "
            "start, but it's how boards end up weak and uncontested at 8."
            if ahead else
            "Your leveling tracks the lobby."
        ),
    }


def leak_comp_flexibility(games: list[dict], stats: dict) -> dict | None:
    if len(games) < MIN_GAMES:
        return None
    counts = Counter(g["sig"] for g in games)
    top_sig, top_n = counts.most_common(1)[0]
    rate = top_n / len(games)
    # Shannon entropy normalised by the max for this many games.
    total = sum(counts.values())
    ent = -sum((c / total) * math.log2(c / total) for c in counts.values())
    max_ent = math.log2(len(counts)) if len(counts) > 1 else 1
    return {
        "id": "comp_flexibility",
        "title": "Comp flexibility",
        "severity": "high" if rate > 0.6 else "medium" if rate > FORCE_RATE_THRESHOLD else "ok",
        "metric": f"{len(counts)} distinct comps in {len(games)} games",
        "detail": (
            f"You played {stats['comp_names'].get(top_sig, top_sig)} in "
            f"{top_n} of {len(games)} games ({rate*100:.0f}%). Forcing one line "
            f"caps you at how often the lobby lets you have it."
            if rate > FORCE_RATE_THRESHOLD else
            "You're playing what the game gives you rather than forcing one line."
        ),
        "diversity_score": round(ent / max_ent, 2) if max_ent else 0,
    }


def leak_comp_skill_gap(games: list[dict], stats: dict) -> dict | None:
    """Which comps do you underperform the field in?"""
    by_comp: dict[str, list[int]] = defaultdict(list)
    for g in games:
        by_comp[g["sig"]].append(g["placement"])

    rows = []
    for sig, places in by_comp.items():
        field = stats["comps"].get(sig)
        if not field or len(places) < MIN_GAMES_FOR_COMP_VERDICT:
            continue
        mine = statistics.mean(places)
        rows.append({
            "comp": stats["comp_names"].get(sig, sig),
            "games": len(places),
            "your_avg": round(mine, 2),
            "field_avg": field["avg_placement"],
            "gap": round(mine - field["avg_placement"], 2),
        })
    if not rows:
        return None
    rows.sort(key=lambda r: -r["gap"])
    worst = rows[0]
    return {
        "id": "comp_skill_gap",
        "title": "Comps you underperform in",
        "severity": "high" if worst["gap"] > 0.7 else "medium" if worst["gap"] > 0.3 else "ok",
        "metric": f"{worst['comp']}: {worst['gap']:+.2f} vs. field",
        "detail": (
            f"You average {worst['your_avg']} in {worst['comp']} where the field "
            f"averages {worst['field_avg']}. Either drop it or work out what the "
            f"field knows that you don't -- positioning and item priority are the "
            f"usual answers."
            if worst["gap"] > 0.3 else
            "You're performing at or above field average in the comps you play enough to judge."
        ),
        "table": rows,
    }


def leak_exit_timing(games: list[dict]) -> dict | None:
    bot4 = [g for g in games if g["placement"] >= 5]
    if len(bot4) < 3:
        return None
    rounds = [g["last_round"] for g in bot4 if g["last_round"]]
    if not rounds:
        return None
    avg = statistics.mean(rounds)
    early = sum(1 for r in rounds if r <= 26)  # roughly stage 4 or earlier
    return {
        "id": "exit_timing",
        "title": "Where your bad games end",
        "severity": "high" if early / len(rounds) > 0.5 else "medium" if early else "ok",
        "metric": f"round {avg:.0f} average in bottom-4 games",
        "detail": (
            f"{early} of your {len(rounds)} bottom-4 games ended by stage 4. Dying "
            f"that early is an early-game or stabilisation problem, not a late-game "
            f"one -- you're losing before your comp exists."
            if early / len(rounds) > 0.3 else
            "Your losses come late, which means you're stabilising and then losing "
            "the endgame. Look at positioning and item allocation rather than econ."
        ),
    }


# --- orchestration --------------------------------------------------------

def analyse(puuid: str, matches: list[dict], stats: dict) -> dict:
    games = []
    for m in matches:
        me = _me(m, puuid)
        if not me:
            continue
        games.append({
            "match_id": m.get("metadata", {}).get("match_id"),
            "puuid": puuid,
            "placement": me.get("placement"),
            "level": me.get("level", 0),
            "last_round": me.get("last_round"),
            "gold_left": me.get("gold_left"),
            "augments": [a for a in (me.get("augments") or []) if not is_legend_augment(a)],
            "sig": comp_signature(me),
            "lobby": m.get("info", {}).get("participants", []),
        })

    if not games:
        return {"error": "no ranked games found for this account"}

    placements = [g["placement"] for g in games]
    summary = {
        "games": len(games),
        "avg_placement": round(statistics.mean(placements), 2),
        "top4_rate": round(sum(1 for p in placements if p <= 4) / len(placements), 3),
        "win_rate": round(sum(1 for p in placements if p == 1) / len(placements), 3),
        "field_avg": stats["baseline_placement"],
        "placement_counts": {str(i): placements.count(i) for i in range(1, 9)},
        "low_sample": len(games) < MIN_GAMES,
    }

    detectors = [
        leak_augment_fit(games, stats),
        leak_comp_skill_gap(games, stats),
        leak_gold_hoarding(games),
        leak_level_tempo(games),
        leak_comp_flexibility(games, stats),
        leak_exit_timing(games),
    ]
    leaks = [d for d in detectors if d]
    order = {"high": 0, "medium": 1, "ok": 2}
    leaks.sort(key=lambda d: order.get(d["severity"], 3))

    return {
        "summary": summary,
        "leaks": leaks,
        "recent": [
            {"placement": g["placement"], "comp": stats["comp_names"].get(g["sig"], g["sig"]),
             "level": g["level"], "round": g["last_round"], "gold": g["gold_left"],
             "augments": [stats["augment_names"].get(a, a) for a in g["augments"]]}
            for g in games
        ],
        "patch": stats.get("patch"),
        "compared_against": stats.get("slice_label", "published stats"),
    }


def main() -> None:
    import argparse
    from riot_client import RiotTFTClient, PLATFORM_TO_REGION

    ap = argparse.ArgumentParser(description="Review your own recent TFT games.")
    ap.add_argument("riot_id", help="GameName#TAG")
    ap.add_argument("--platform", default="na1")
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--stats", default="public/current/global-apex.json")
    ap.add_argument("--out", default="review.json")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    if "#" not in args.riot_id:
        raise SystemExit("Riot ID must look like GameName#TAG")
    name, tag = args.riot_id.rsplit("#", 1)

    stats = json.loads(Path(args.stats).read_text())
    client = RiotTFTClient()
    region = PLATFORM_TO_REGION[args.platform]

    log.info("resolving %s#%s ...", name, tag)
    puuid, matches = fetch_history(client, region, args.platform, name, tag, args.count)
    log.info("pulled %d ranked games", len(matches))

    result = analyse(puuid, matches, stats)
    Path(args.out).write_text(json.dumps(result, indent=2))

    s = result["summary"]
    print(f"\n{args.riot_id} -- last {s['games']} ranked games")
    print(f"  avg placement {s['avg_placement']}  (field {s['field_avg']})")
    print(f"  top 4 {s['top4_rate']*100:.0f}%   firsts {s['win_rate']*100:.0f}%\n")
    for leak in result["leaks"]:
        mark = {"high": "!!", "medium": "! ", "ok": "  "}[leak["severity"]]
        print(f"{mark} {leak['title']}: {leak['metric']}")
        print(f"     {leak['detail']}\n")
    print(f"written to {args.out}")


if __name__ == "__main__":
    main()
