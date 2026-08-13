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


if __name__ == "__main__":
    main()
