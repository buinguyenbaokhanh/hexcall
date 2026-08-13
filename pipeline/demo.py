import json, logging, random, sqlite3
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
PLATS = ["na1", "euw1", "kr"]
TIERS = ["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND"]
pool = {}
for p in PLATS:
    for i in range(400):
        puuid = f"{p}_player_{i}"
        pool.setdefault(p, []).append(puuid)
        conn.execute("INSERT INTO players VALUES (?,?,?,?,?)",
                     (puuid, p, random.choices(TIERS, weights=[1,2,4,6])[0], 0, 0))
logging.info("generating 6000 matches ...")
for i in range(6000):
    plat = PLATS[i % 3]
    m = ms.match(f"M_{i}")
    for part, puuid in zip(m["info"]["participants"], random.sample(pool[plat], 8)):
        part["puuid"] = puuid
    conn.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
                 (f"M_{i}", plat, m["info"]["game_datetime"],
                  "Version 17.8.700.1", 17, 1100, json.dumps(m), 0))
conn.commit()
names = {}
for name, (traits, carry, _core, _flex, _b) in ms.COMPS.items():
    sig = "_".join(f"{n}{u}" for n, u, _s in sorted(traits, key=lambda t: (t[2], t[1]), reverse=True))
    names[f"{sig} :: {carry}"] = name
publish.publish("tft.db", tft_set=17, comp_names=names)
print("\nDemo data ready. Now start the server and the app.")
