#!/usr/bin/env bash
# Preview the UI with generated sample data. No API key needed.
# Useful for checking the interface before you've crawled anything real.
set -euo pipefail

cd pipeline
../.venv/bin/python - <<'PY'
import json, sqlite3, random, time, logging
import make_sample_stats as ms, publish
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
random.seed(17)
conn = sqlite3.connect("tft.db")
conn.executescript("""
DROP TABLE IF EXISTS matches; DROP TABLE IF EXISTS players;
CREATE TABLE matches (match_id TEXT PRIMARY KEY, platform TEXT, game_datetime INTEGER,
  game_version TEXT, tft_set INTEGER, queue_id INTEGER, raw TEXT, fetched_at INTEGER);
CREATE TABLE players (puuid TEXT PRIMARY KEY, platform TEXT, tier TEXT, lp INTEGER, seen_at INTEGER);
""")
plats, TIERS = ["na1","euw1","kr"], ["CHALLENGER","GRANDMASTER","MASTER","DIAMOND"]
pool = {}
for p in plats:
    for i in range(400):
        t = random.choices(TIERS, weights=[1,2,4,6])[0]
        pool.setdefault(p, []).append(f"{p}_player_{i}")
        conn.execute("INSERT INTO players VALUES (?,?,?,?,?)", (f"{p}_player_{i}", p, t, 0, 0))
for i in range(6000):
    plat = plats[i%3]; m = ms.match(f"M_{i}")
    for part, pu in zip(m["info"]["participants"], random.sample(pool[plat], 8)):
        part["puuid"] = pu
    conn.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
        (f"M_{i}", plat, m["info"]["game_datetime"], "Version 17.8.700.1", 17, 1100, json.dumps(m), 0))
conn.commit()
names = {}
for name,(td,carry,_) in ms.COMPS.items():
    sig = "_".join(f"{n}{u}" for n,u,_s in sorted(td, key=lambda t:(t[2],t[1]), reverse=True))
    names[f"{sig} :: {carry}"] = name
publish.publish("tft.db", tft_set=17, comp_names=names)
print("\nDemo data published. Run ./run-dev.sh")
PY
