# Hexcall

A Teamfight Tactics decision-assist tool. It aggregates ranked match data from the
Riot API, computes **conditional** comp statistics, and tells you which composition
your specific augments actually support — then reviews your own recent games to find
the mistakes you repeat.

Built to stay inside Riot's third-party developer policy, which shaped the design more
than any technical constraint did.

```
┌─ scheduler ──────────────────────────────────────────┐
│  ingest      ladder → puuids → matches → SQLite      │
│  aggregate   matches → comp/augment/pair statistics  │
│  publish     statistics → immutable JSON + manifest  │
└──────────────────────┬───────────────────────────────┘
                       ▼
              static artifacts (~5 KB gzipped/slice)
                       ▼
              React client ── fetch → rank → review
```

---

## What makes it different

Every TFT stats site will tell you an augment's average placement. Few tell you what
that average is *conditional on the comp you're playing*:

| Augment | Into Fast 9 | Into Reroll |
|---|---|---|
| Rich Get Richer | **2.88** | 5.40 |
| Diamond Hands | 4.60 | **3.94** |

That conditional table is what turns "here's the meta" into "here's what *you* should
build." A comp with a mediocre 4.86 baseline becomes the correct call when your
augments support it — a static tier list can never tell you that.

**Ranking model:**

```
projected_placement = comp.avg_placement + Σ shrink(lift(augment, comp), n)
```

Lifts are shrunk toward zero by sample size (empirical Bayes, k=150), so a large swing
measured on 40 games counts far less than the same swing on 1,200. Without this the top
of the list fills with small-sample noise — the most common way tier lists mislead.

---

## Features

**Comp recommender** — enter your augments, get comps ranked by projected placement,
with per-augment contribution breakdowns and confidence based on the smallest sample
behind each ranking.

**Meta browser** — comp and augment tier lists with sample sizes and standard errors
surfaced, not hidden.

**Game review** — pulls your last 20 ranked games and detects recurring leaks:

- *Augment fit* — are you taking augments that suit the comps you commit to?
- *Comp skill gap* — which comps do you underperform the field in?
- *Gold hoarding* — gold banked when you were eliminated
- *Level tempo* — your level vs. lobby peers at the same round
- *Comp flexibility* — are you forcing one line regardless of what you're given?
- *Exit timing* — do your losses come at stage 4 or stage 6?

---

## Design decisions

**The client never calls the Riot API.** The key would ship in the bundle (against
Riot's security policy), rate limits are per-key rather than per-user, and building a
tier list takes minutes of crawling. A scheduled job aggregates server-side and
publishes static JSON.

**Tier filtering applies to participants, not matches.** A Challenger game contains
seven opponents who may be Master or Diamond. Filtering by match would quietly
contaminate an "apex only" slice with lower-tier boards.

**Under-sampled slices are withheld, not published.** Below 4,000 participants a slice
produces noise wearing a costume. During testing EUW and KR were correctly dropped at
~3,850 rather than shipped.

**Old patches are deleted, not archived.** After a balance patch the old data describes
a game that no longer exists. Keeping it inflates sample size while degrading accuracy.

**Publishing is atomic.** Each build writes to `builds/<timestamp>/` then flips a
symlink. Clients never see a half-written file; rollback is one symlink change.

**Crawl failure never takes down serving.** If one region throws, others continue and
the previous build stays live. Stale data beats no data — and the UI says which it's
showing rather than quietly serving old numbers as current.

---

## Policy compliance

Riot's TFT developer policy is restrictive in ways that are easy to violate accidentally.
The constraints are enforced in code, not just documented:

| Requirement | Implementation |
|---|---|
| No Legend augment win rates | `LEGEND_AUGMENT_PREFIXES` filter in `aggregate.py` |
| No real-time game-state recommendations | Augments are entered manually; the app never reads game state |
| No opponent/lobby scouting during gameplay | Review covers your own history only |
| Product registration required | — |

The line Riot draws: static pre-game guidance is explicitly allowed, but recommendations
that *"adjust in real time based on the player's actions in game and give direct
prescriptions"* are not. This is a reference tool you consult, not an assistant watching
your game.

Notably, checking a tier list mid-game is both the least useful thing a player can do
and the thing the policy specifically prohibits. That overlap isn't a coincidence —
post-game review is where improvement actually happens, which is why it's a first-class
feature here.

---

## Stack

**Pipeline:** Python 3.12, SQLite, `requests`, Flask
**Client:** React 18, Vite, Tailwind
**Deploy:** GitHub Actions → Pages, or any static host

No ORM, no message queue, no Redis. The data is small, the write pattern is
"one process, once every six hours," and SQLite handles it without ceremony.

---

## Running it

```bash
./setup.sh        # venv + npm install
./run-demo.sh     # generated sample data, no API key needed
./run-dev.sh      # http://localhost:5173
```

For real data, get a key at [developer.riotgames.com](https://developer.riotgames.com):

```bash
export RIOT_API_KEY=RGAPI-...
./run-crawl.sh na1 17     # platform, TFT set
./run-dev.sh
```

Development keys expire every 24 hours. See [START-HERE.md](START-HERE.md) for the full
walkthrough and [pipeline/DEPLOYMENT.md](pipeline/DEPLOYMENT.md) for production notes.

---

## Testing

```bash
cd pipeline && python test_pipeline.py
```

Runs the aggregation against 12,000 synthetic participants with known ground truth
planted in them, and asserts it recovers the planted comp ordering, augment strengths,
and augment×comp interactions — plus that Legend augments are filtered. No API key or
network required.

The leak detectors are validated the same way: a synthetic player is generated with
deliberate flaws (forces one comp, hoards gold, levels behind, takes reroll augments
into Fast 9) and the review engine is asserted to find all four.

---

## Known limitations

- **Comp naming is hand-maintained.** `COMP_NAMES` in `providers.py` maps trait
  signatures to community names. These shift every patch and auto-generated labels read
  awkwardly.
- **Tier letters use fixed placement thresholds.** Percentile cutoffs would be better;
  a patch where everything clusters at 4.4 currently shows zero S-tiers.
- **Carry detection counts item slots.** A tank with three defensive items can win the
  heuristic. Weighting by item type from `tft-item.json` would fix it.
- **Data Dragon lags patches** by a day or two. `NameResolver.unresolved` tracks IDs it
  couldn't name.
- **No round-by-round data.** `tft-match-v1` returns an end-of-game snapshot only.
  Overlays showing HP curves read the game client, not the API — so every leak detector
  here works from end-state plus lobby comparison.

---

## Licence

MIT. Not endorsed by Riot Games. Riot Games and all associated properties are
trademarks or registered trademarks of Riot Games, Inc.
