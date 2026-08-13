"""
Generates a demo stats.json by running synthetic matches through the REAL
aggregate.py code path. The schema is therefore identical to what
`python aggregate.py` produces from live Riot data -- only the numbers are
synthetic, so the UI can be built and reviewed before you have a production key.

Replace with real output by running:
    python ingest.py --platform na1 --tiers challenger grandmaster
    python aggregate.py --db tft.db --set 17 --out stats.json
"""

import json
import random
import sqlite3
import time

from aggregate import build_stats

random.seed(17)

# Set 17 comp archetypes. Champion ids and trait names are the REAL ones for
# the set, taken from Community Dragon's roster -- not invented.
#
# That matters beyond cosmetics: the app joins match-derived stats onto the
# published champion catalogue by character_id. Invented ids join to nothing,
# so every champion in the demo would render with no cost, role or traits, and
# every real champion with no placement -- which reads as "the Champions tab is
# broken" rather than "this is synthetic data". Keep these ids in sync with
# the live set, or regenerate them from public/current/champion-meta.json.
#
# Format: name: (traits, carry, core_units, flex_pool, bias)
COMPS = {
    "5 Anima": (
        [("Anima", 5, 3), ("Marauder", 2, 1)], "TFT17_Fiora",
        ["TFT17_Fiora", "TFT17_Illaoi", "TFT17_Aurora", "TFT17_Jinx", "TFT17_Briar"],
        ["TFT17_Urgot", "TFT17_Akali", "TFT17_Belveth"], -0.85),
    "Stargazer Xayah": (
        [("Stargazer", 4, 3), ("Sniper", 2, 1)], "TFT17_Xayah",
        ["TFT17_Xayah", "TFT17_Lulu", "TFT17_Jax", "TFT17_TwistedFate", "TFT17_Talon"],
        ["TFT17_Nunu", "TFT17_Gnar", "TFT17_Ezreal"], -0.55),
    "N.O.V.A. Akali": (
        [("N.O.V.A.", 4, 2), ("Marauder", 2, 1)], "TFT17_Akali",
        ["TFT17_Akali", "TFT17_Aatrox", "TFT17_Caitlyn", "TFT17_Maokai", "TFT17_Kindred"],
        ["TFT17_Belveth", "TFT17_Urgot", "TFT17_MasterYi"], -0.45),
    "Vex Fast 9": (
        [("Stargazer", 3, 2), ("Conduit", 2, 1)], "TFT17_Vex",
        ["TFT17_Vex", "TFT17_Lulu", "TFT17_Nunu", "TFT17_AurelionSol", "TFT17_Bard"],
        ["TFT17_Morgana", "TFT17_Viktor", "TFT17_Zoe"], -0.10),
    "Two Tanky Samira": (
        [("Space Groove", 4, 2), ("Sniper", 2, 1)], "TFT17_Samira",
        ["TFT17_Samira", "TFT17_Nasus", "TFT17_Teemo", "TFT17_Ornn", "TFT17_Nami"],
        ["TFT17_Gwen", "TFT17_Blitzcrank", "TFT17_Gnar"], -0.15),
    "Brawler Yi": (
        [("Brawler", 6, 3), ("Marauder", 2, 1)], "TFT17_MasterYi",
        ["TFT17_MasterYi", "TFT17_Chogath", "TFT17_RekSai", "TFT17_Gragas", "TFT17_Pantheon"],
        ["TFT17_Maokai", "TFT17_Urgot", "TFT17_TahmKench"], 0.15),
    "Shepherd LeBlanc": (
        [("Shepherd", 4, 2), ("Conduit", 2, 1)], "TFT17_Leblanc",
        ["TFT17_Leblanc", "TFT17_Lissandra", "TFT17_Teemo", "TFT17_Illaoi", "TFT17_Sona"],
        ["TFT17_Morgana", "TFT17_Viktor", "TFT17_IvernMinion"], 0.25),
    "Dark Stars": (
        [("Dark Star", 4, 2), ("Sniper", 2, 1)], "TFT17_Jhin",
        ["TFT17_Jhin", "TFT17_Chogath", "TFT17_Lissandra", "TFT17_Mordekaiser", "TFT17_Kaisa"],
        ["TFT17_Karma", "TFT17_Xayah", "TFT17_Ezreal"], 0.70),
    "Lulu Reroll": (
        [("Replicator", 4, 3), ("Stargazer", 2, 1)], "TFT17_Lulu",
        ["TFT17_Lulu", "TFT17_Lissandra", "TFT17_Veigar", "TFT17_Pantheon", "TFT17_Nami"],
        ["TFT17_Poppy", "TFT17_Gnar", "TFT17_Corki"], 0.85),
}

COMP_WEIGHTS = [3.0, 2.8, 2.5, 1.8, 2.2, 2.0, 1.5, 1.2, 1.0]

AUGMENTS = {
    "TFT6_Augment_MaxLevel10":  -0.45,
    "TFT6_Augment_PandorasItems":  -0.35,
    "TFT9_Augment_HedgeFund":    -0.15,
    "TFT6_Augment_TradeSector2":    -0.10,
    "TFT6_Augment_Diversify1":    -0.05,
    "TFT11_Augment_Slammin":  0.00,
    "TFT6_Augment_ThriftShop":     0.05,
    "TFT16_Augment_UltraRapidFire":       0.10,
    "TFT6_Augment_ItemGrabBag1": 0.15,
    "TFT6_Augment_TinyTitans":    0.20,
    "TFT10_Augment_CrashTestDummies":  0.30,
    "TFT6_Augment_SalvageBin":      0.40,
}
LEGEND_AUGS = ["TFT_Augment_LegendPoro", "TFT_Augment_LegendDraven"]

# The interaction structure -- this is what the recommender must recover.
SYNERGY = {
    ("TFT6_Augment_MaxLevel10", "Vex Fast 9"):      -1.15,
    ("TFT6_Augment_ThriftShop", "Vex Fast 9"):        -0.95,
    ("TFT16_Augment_UltraRapidFire", "Vex Fast 9"):          -0.55,
    ("TFT6_Augment_MaxLevel10", "Brawler Yi"):       0.55,
    ("TFT6_Augment_TinyTitans", "Brawler Yi"):       -0.85,
    ("TFT6_Augment_TinyTitans", "Lulu Reroll"):      -0.90,
    ("TFT10_Augment_CrashTestDummies", "Lulu Reroll"):    -0.80,
    ("TFT10_Augment_CrashTestDummies", "Brawler Yi"):     -0.60,
    ("TFT6_Augment_PandorasItems", "Stargazer Xayah"): -0.70,
    ("TFT6_Augment_ItemGrabBag1", "N.O.V.A. Akali"): -0.65,
    ("TFT6_Augment_TradeSector2", "N.O.V.A. Akali"):    -0.50,
    ("TFT6_Augment_Diversify1", "5 Anima"):           -0.60,
    ("TFT11_Augment_Slammin", "Dark Stars"):     -0.70,
    ("TFT6_Augment_PandorasItems", "Two Tanky Samira"): -0.55,
    ("TFT9_Augment_HedgeFund", "Two Tanky Samira"):  -0.40,
    ("TFT6_Augment_SalvageBin", "Vex Fast 9"):          0.50,
}

ITEMS = ["TFT_Item_InfinityEdge", "TFT_Item_GuinsoosRageblade", "TFT_Item_LastWhisper",
         "TFT_Item_JeweledGauntlet", "TFT_Item_BlueBuff", "TFT_Item_MadredsBloodrazor",
         "TFT_Item_Bloodthirster", "TFT_Item_Deathblade"]


CARRY_ITEMS = ["TFT_Item_InfinityEdge", "TFT_Item_GuinsoosRageblade",
               "TFT_Item_LastWhisper", "TFT_Item_JeweledGauntlet",
               "TFT_Item_BlueBuff", "TFT_Item_MadredsBloodrazor",
               "TFT_Item_Bloodthirster", "TFT_Item_Deathblade",
               "TFT_Item_SpearOfShojin", "TFT_Item_HextechGunblade"]
TANK_ITEMS = ["TFT_Item_WarmogsArmor", "TFT_Item_BrambleVest",
              "TFT_Item_DragonsClaw", "TFT_Item_Redemption",
              "TFT_Item_GargoyleStoneplate", "TFT_Item_RedBuff"]

# Item preferences per carry, so "best item holders" is a real signal rather
# than uniform noise. First entries are the intended BIS.
CARRY_BIS = {
    "TFT17_Fiora":    ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_LastWhisper"],
    "TFT17_Xayah":    ["TFT_Item_GuinsoosRageblade", "TFT_Item_LastWhisper", "TFT_Item_Bloodthirster"],
    "TFT17_Akali":    ["TFT_Item_JeweledGauntlet", "TFT_Item_HextechGunblade", "TFT_Item_InfinityEdge"],
    "TFT17_Vex":      ["TFT_Item_BlueBuff", "TFT_Item_JeweledGauntlet", "TFT_Item_SpearOfShojin"],
    "TFT17_Samira":   ["TFT_Item_InfinityEdge", "TFT_Item_LastWhisper", "TFT_Item_Bloodthirster"],
    "TFT17_MasterYi": ["TFT_Item_GuinsoosRageblade", "TFT_Item_Deathblade", "TFT_Item_Bloodthirster"],
    "TFT17_Leblanc":  ["TFT_Item_JeweledGauntlet", "TFT_Item_BlueBuff", "TFT_Item_HextechGunblade"],
    "TFT17_Jhin":     ["TFT_Item_InfinityEdge", "TFT_Item_MadredsBloodrazor", "TFT_Item_LastWhisper"],
    "TFT17_Lulu":     ["TFT_Item_BlueBuff", "TFT_Item_JeweledGauntlet", "TFT_Item_SpearOfShojin"],
}


def participant(comp: str) -> dict:
    traits_def, carry, core, flex, _bias = COMPS[comp]
    traits = [{"name": n, "num_units": u, "style": s, "tier_current": s, "tier_total": 4}
              for n, u, s in traits_def]

    units = []
    # Carry: usually BIS, sometimes off-BIS, star level varies
    bis = CARRY_BIS.get(carry, CARRY_ITEMS[:3])
    if random.random() < 0.62:
        carry_items = list(bis)
    elif random.random() < 0.6:
        carry_items = list(dict.fromkeys(bis[:2] + [random.choice(CARRY_ITEMS)]))
    else:
        carry_items = random.sample(CARRY_ITEMS, random.choice([1, 2, 3]))
    units.append({
        "character_id": carry,
        "itemNames": carry_items,
        "rarity": random.choice([3, 4]),
        "tier": random.choices([1, 2, 3], weights=[4, 76, 20])[0],
    })

    # Core units: nearly always present, frontline gets tank items
    for i, cid in enumerate(core):
        if cid == carry or random.random() > 0.93:
            continue
        items = random.sample(TANK_ITEMS, 2) if i == 1 and random.random() < 0.55 else []
        units.append({
            "character_id": cid, "itemNames": items,
            "rarity": random.choice([1, 2, 3]),
            "tier": random.choices([1, 2, 3], weights=[8, 80, 12])[0],
        })

    # Flex slots: the part of the board that actually varies
    for cid in random.sample(flex, min(len(flex), random.choice([1, 2, 2, 3]))):
        units.append({
            "character_id": cid, "itemNames": [],
            "rarity": random.choice([1, 2, 4]),
            "tier": random.choices([1, 2], weights=[25, 75])[0],
        })

    augs = random.sample(list(AUGMENTS), 3)
    if random.random() < 0.35:
        augs[random.randrange(3)] = random.choice(LEGEND_AUGS)
    return {"placement": 0, "augments": augs, "traits": traits, "units": units,
            "level": random.choices([7, 8, 9], weights=[18, 58, 24])[0],
            "last_round": random.randint(25, 38),
            "gold_left": random.randint(0, 14),
            "puuid": "synthetic"}


def score(comp: str, augs: list[str]) -> float:
    s = COMPS[comp][4] + random.gauss(0, 1.5)
    for a in augs:
        s += AUGMENTS.get(a, 0.0) + SYNERGY.get((a, comp), 0.0)
    return s


def match(mid: str) -> dict:
    names = list(COMPS)
    board = []
    for _ in range(8):
        c = random.choices(names, weights=COMP_WEIGHTS)[0]
        p = participant(c)
        board.append((score(c, p["augments"]), p))
    board.sort(key=lambda x: x[0])
    for i, (_, p) in enumerate(board, 1):
        p["placement"] = i
    return {"metadata": {"match_id": mid},
            "info": {"game_datetime": int(time.time() * 1000),
                     "game_version": "Version 17.8.700.1234",
                     "tft_set_number": 17, "queue_id": 1100,
                     "participants": [p for _, p in board]}}


def main(n_matches: int = 6000, out: str = "stats.json") -> None:
    conn = sqlite3.connect(":memory:")
    conn.executescript(
        "CREATE TABLE matches (match_id TEXT PRIMARY KEY, platform TEXT, "
        "game_datetime INTEGER, game_version TEXT, tft_set INTEGER, queue_id INTEGER, "
        "raw TEXT, fetched_at INTEGER);")
    for i in range(n_matches):
        m = match(f"NA1_{i}")
        conn.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
                     (f"NA1_{i}", "na1", m["info"]["game_datetime"],
                      m["info"]["game_version"], 17, 1100, json.dumps(m), 0))
    conn.commit()

    stats = build_stats(conn, tft_set=17)

    # Attach display names. In production these come from static_data.NameResolver
    # (Data Dragon) plus the COMP_NAMES override map in providers.py.
    sig_to_name = {}
    for name, (traits_def, carry, _core, _flex, _b) in COMPS.items():
        sig = "_".join(f"{n}{u}" for n, u, _s in
                       sorted(traits_def, key=lambda t: (t[2], t[1]), reverse=True))
        sig_to_name[f"{sig} :: {carry}"] = name
    stats["comp_names"] = sig_to_name
    stats["augment_names"] = {
        a: __import__("static_data").prettify_id(a) for a in stats["augments"]
    }
    stats["generated_at"] = int(time.time())
    stats["is_synthetic"] = True
    stats["patch"] = "17.8"

    with open(out, "w") as f:
        json.dump(stats, f, indent=2)

    unnamed = [s for s in stats["comps"] if s not in sig_to_name]
    print(f"{stats['sample_size']} participants -> {len(stats['comps'])} comps, "
          f"{len(stats['augments'])} augments, {len(stats['augment_comp_pairs'])} pairs")
    print(f"unnamed comp signatures: {unnamed}")


if __name__ == "__main__":
    main()
