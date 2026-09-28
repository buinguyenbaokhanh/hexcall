"""Validate the aggregation logic with synthetic matches shaped like real
tft-match-v1 responses. This proves the pipeline works end-to-end without
needing an API key or network access.

The synthetic data has a KNOWN ground truth planted in it:
  - 'Anima' comps are strong (good placements)
  - 'RichGetRicher' augment is strong generally
  - 'RichGetRicher' is EXTRA strong specifically in Fast9 comps  <-- the signal
    the recommender must recover
  - a Legend augment is included and must be filtered out entirely
"""

import json
import random
import sqlite3
import time

from ingest import open_db
from aggregate import build_stats, comp_signature, is_legend_augment
from publish import current_patch

random.seed(42)

TRAIT_SETS = {
    "Anima":      [("Anima", 5, 3), ("Duelist", 2, 1)],
    "Fast9":      [("Stargazer", 4, 3), ("Vanguard", 2, 1)],
    "Reroll":     [("Brawler", 6, 3), ("Bruiser", 2, 1)],
    "DarkStar":   [("DarkStar", 4, 2), ("Sniper", 2, 1)],
}
CARRIES = {"Anima": "TFT17_Fiora", "Fast9": "TFT17_Vex",
           "Reroll": "TFT17_MasterYi", "DarkStar": "TFT17_Jhin"}

AUGMENTS = ["TFT17_Augment_RichGetRicher", "TFT17_Augment_Preparation",
            "TFT17_Augment_PandorasItems", "TFT17_Augment_SalvageBin",
            "TFT17_Augment_FastForward"]
LEGEND_AUG = "TFT_Augment_LegendPoro"   # must be filtered out

# Ground truth placement biases (lower = better)
COMP_BIAS = {"Anima": -0.9, "Fast9": -0.2, "Reroll": 0.1, "DarkStar": 0.8}
AUG_BIAS = {"TFT17_Augment_RichGetRicher": -0.5,
            "TFT17_Augment_PandorasItems": -0.3,
            "TFT17_Augment_Preparation": -0.1,
            "TFT17_Augment_FastForward": 0.1,
            "TFT17_Augment_SalvageBin": 0.4}
# The interaction we want the recommender to find:
SYNERGY = {("TFT17_Augment_RichGetRicher", "Fast9"): -1.2,
           ("TFT17_Augment_FastForward", "Fast9"): -0.8,
           ("TFT17_Augment_RichGetRicher", "Reroll"): 0.6}


def make_participant(comp: str, placement_slot: int) -> dict:
    traits = [{"name": n, "num_units": u, "style": s, "tier_current": s, "tier_total": 4}
              for n, u, s in TRAIT_SETS[comp]]
    units = [{"character_id": CARRIES[comp], "itemNames": ["TFT_Item_InfinityEdge",
              "TFT_Item_LastWhisper", "TFT_Item_GuinsoosRageblade"],
              "rarity": 4, "tier": 2}]
    units += [{"character_id": f"TFT17_Filler{i}", "itemNames": [], "rarity": 1, "tier": 2}
              for i in range(7)]
    augs = random.sample(AUGMENTS, 3)
    if random.random() < 0.3:
        augs[0] = LEGEND_AUG
    return {"placement": placement_slot, "augments": augs, "traits": traits,
            "units": units, "level": 8, "last_round": 30, "puuid": "x"}


def score(comp: str, augs: list[str]) -> float:
    s = COMP_BIAS[comp] + random.gauss(0, 1.4)
    for a in augs:
        s += AUG_BIAS.get(a, 0.0)
        s += SYNERGY.get((a, comp), 0.0)
    return s


def synth_match(mid: str) -> dict:
    board = []
    for _ in range(8):
        comp = random.choices(list(TRAIT_SETS), weights=[3, 3, 2, 1])[0]
        p = make_participant(comp, 0)
        board.append((score(comp, p["augments"]), p))
    board.sort(key=lambda x: x[0])
    for i, (_, p) in enumerate(board, 1):
        p["placement"] = i
    return {"metadata": {"match_id": mid},
            "info": {"game_datetime": int(time.time() * 1000),
                     "game_version": "Version 17.8.700.1234",
                     "tft_set_number": 17, "queue_id": 1100,
                     "participants": [p for _, p in board]}}


def main() -> None:
    conn = open_db(":memory:") if False else sqlite3.connect(":memory:")
    conn.executescript(open("/dev/stdin").read() if False else """
    CREATE TABLE matches (match_id TEXT PRIMARY KEY, platform TEXT, game_datetime INTEGER,
      game_version TEXT, tft_set INTEGER, queue_id INTEGER, raw TEXT, fetched_at INTEGER);""")

    N = 1500
    for i in range(N):
        m = synth_match(f"NA1_{i}")
        conn.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
                     (f"NA1_{i}", "na1", m["info"]["game_datetime"],
                      m["info"]["game_version"], 17, 1100,
                      json.dumps(m), int(time.time())))
    conn.commit()
    print(f"generated {N} matches ({N*8} participants)\n")

    stats = build_stats(conn, tft_set=17)
    print(f"sample_size = {stats['sample_size']}, baseline = {stats['baseline_placement']}\n")

    print("=== COMP TIER LIST (by avg placement, lower is better) ===")
    for sig, s in sorted(stats["comps"].items(), key=lambda kv: kv[1]["avg_placement"]):
        print(f"  {s['avg_placement']:.2f} ±{s['stderr']:.2f}  top4 {s['top4_rate']*100:4.1f}%  "
              f"n={s['n']:5d}  play {s['play_rate']*100:4.1f}%  {sig}")

    print("\n=== AUGMENT TIER LIST ===")
    for a, s in sorted(stats["augments"].items(), key=lambda kv: kv[1]["avg_placement"]):
        print(f"  {s['avg_placement']:.2f} ±{s['stderr']:.2f}  top4 {s['top4_rate']*100:4.1f}%  n={s['n']:5d}  {a}")

    print("\n=== TOP AUGMENT -> COMP PAIRINGS (the recommendation signal) ===")
    for r in stats["augment_comp_pairs"][:8]:
        print(f"  lift {r['lift_vs_comp']:+.2f}  avg {r['avg_placement']:.2f}  n={r['n']:4d}"
              f"  {r['augment'].replace('TFT17_Augment_',''):16s} -> {r['comp'][:46]}")

    print("\n=== VALIDATION ===")
    legend_leaked = [a for a in stats["augments"] if is_legend_augment(a)]
    print(f"  Legend augments in output: {legend_leaked}  -> {'PASS' if not legend_leaked else 'FAIL'}")
    pair_leaked = [r for r in stats["augment_comp_pairs"] if is_legend_augment(r["augment"])]
    print(f"  Legend augments in pairs:  {len(pair_leaked)}  -> {'PASS' if not pair_leaked else 'FAIL'}")

    best_pair = stats["augment_comp_pairs"][0]
    found = "RichGetRicher" in best_pair["augment"] and "Stargazer" in best_pair["comp"]
    print(f"  Recovered planted synergy (RichGetRicher x Fast9/Stargazer) as #1 pair: "
          f"{'PASS' if found else 'FAIL'} -> {best_pair['augment']} x {best_pair['comp'][:40]}")

    # Expected ordering derived analytically from the ground-truth model:
    # each of 5 augments appears with p=0.6, so a comp's expected score is
    #   COMP_BIAS + 0.6*sum(AUG_BIAS) + 0.6*sum(SYNERGY for that comp)
    expected = {}
    for comp in TRAIT_SETS:
        syn = sum(v for (a, c), v in SYNERGY.items() if c == comp)
        expected[comp] = COMP_BIAS[comp] + 0.6 * (sum(AUG_BIAS.values()) + syn)
    expected_order = [c for c, _ in sorted(expected.items(), key=lambda kv: kv[1])]

    trait_head = {"Anima": "Anima", "Fast9": "Stargazer",
                  "Reroll": "Brawler", "DarkStar": "DarkStar"}
    observed = sorted(stats["comps"].items(), key=lambda kv: kv[1]["avg_placement"])
    observed_order = []
    for sig, _ in observed:
        for comp, head in trait_head.items():
            if sig.startswith(head):
                observed_order.append(comp)
    ok = observed_order == expected_order
    print(f"  Recovered planted comp ordering: {'PASS' if ok else 'FAIL'}")
    print(f"    expected {expected_order}")
    print(f"    observed {observed_order}")

    check_set_rollover()


def check_set_rollover() -> None:
    """A new set's first patch must win over the old set's last one.

    The old set's patch is newer-looking than nothing and far better sampled,
    so a set-blind choice picks it -- and a build pinned to the new set then
    filters to zero rows.
    """
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE matches (match_id TEXT PRIMARY KEY, game_version TEXT, tft_set INTEGER)")
    rows = [(f"old_{i}", "Linux Version 16.16.804.9184 (Aug 10 2026)", 17) for i in range(1500)]
    rows += [(f"new_{i}", "Linux Version 16.19.812.1234 (Sep 21 2026)", 18) for i in range(300)]
    conn.executemany("INSERT INTO matches VALUES (?,?,?)", rows)

    got_new, got_old = current_patch(conn, tft_set=18), current_patch(conn, tft_set=17)
    ok = got_new == "16.19" and got_old == "16.16"
    print(f"  Patch chosen within the build's set at a set rollover: {'PASS' if ok else 'FAIL'}"
          f" -> Set 18 {got_new}, Set 17 {got_old}")

    check_calendar_patches()


def check_calendar_patches() -> None:
    """Set 18 matches carry no version; their patch comes from when they were
    played, and a patch's rollout window is left unassigned."""
    from calendar import timegm
    from publish import calendar_patch, assign_calendar_patches

    table = {"18.2": "2026-09-10", "18.3": "2026-09-23"}
    at = lambda s: timegm(time.strptime(s, "%Y-%m-%d %H:%M")) * 1000  # noqa: E731
    cases = {
        "2026-09-09 11:59": None,      # before 18.2's rollout: before the calendar
        "2026-09-10 09:00": None,      # 18.2 rolling out
        "2026-09-15 12:00": "18.2",
        "2026-09-22 11:59": "18.2",    # last minute before 18.3 starts rolling out
        "2026-09-22 12:00": None,      # 18.3 rolling out (Asia, the previous UTC evening)
        "2026-09-23 23:59": None,
        "2026-09-24 00:00": "18.3",
        "2026-10-08 23:59": "18.3",    # 15.x days after the last entry
        "2026-10-09 00:00": None,      # 16 days on: the calendar has fallen behind
    }
    got = {when: calendar_patch(at(when), table) for when in cases}
    ok = got == cases

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE matches (match_id TEXT PRIMARY KEY, game_datetime INTEGER,"
                 " game_version TEXT, tft_set INTEGER)")
    placeholder = "TFT Unreal Version ?.?.?.?"
    conn.executemany("INSERT INTO matches VALUES (?,?,?,18)",
                     [(f"m{i}", at("2026-09-26 10:00"), placeholder) for i in range(50)]
                     + [("roll", at("2026-09-23 08:00"), placeholder)])
    assign_calendar_patches(conn)
    e2e = current_patch(conn, tft_set=18)
    unassigned = conn.execute("SELECT game_version FROM matches WHERE match_id='roll'").fetchone()[0]
    ok = ok and e2e == "18.3" and "?" not in unassigned and not any(c.isdigit() for c in unassigned)
    print(f"  Unversioned Set 18 matches get a patch from the calendar: {'PASS' if ok else 'FAIL'}"
          f" -> store resolves to {e2e}"
          + ("" if got == cases else f"; mismatches {[(k, got[k], v) for k, v in cases.items() if got[k] != v]}"))


if __name__ == "__main__":
    main()
