# TFT Comp Advisor — data pipeline

Turns Riot's TFT match API into the comp/augment statistics the advisor UI consumes.

```
ladder (tft-league-v1) → puuids → match ids (tft-match-v1) → match json
        → SQLite (raw, replayable) → aggregate.py → stats.json → StatsSource → UI
```

## Setup

```bash
pip install requests
export RIOT_API_KEY=RGAPI-...          # developer.riotgames.com
python ingest.py --platform na1 --tiers challenger grandmaster --lookback-days 3
python aggregate.py --db tft.db --set 17 --out stats.json
```

Personal keys expire every 24 hours and are rate limited to ~20 req/s and
100 req/2min. `riot_client.py` enforces those budgets and backs off on 429s.
For continuous crawling you need a production key, which requires Riot to
review a working prototype — the UI you already have is what you show them.

## Files

| File | Does |
|---|---|
| `riot_client.py` | Rate-limited API client, retry/backoff, routing tables |
| `ingest.py` | Ladder crawl → raw match store (checkpointed, resumable) |
| `aggregate.py` | Comp clustering, augment stats, augment→comp lift |
| `static_data.py` | Data Dragon names/icons, key-free, with ID fallback |
| `providers.py` | `StatsSource` interface + Riot / licensed-provider adapters |
| `test_pipeline.py` | Validates aggregation against synthetic matches with known ground truth |

`python test_pipeline.py` runs without an API key and confirms the aggregation
recovers planted comp strengths, augment strengths, and augment×comp synergies,
and that Legend augments are filtered.

## Compliance constraints baked in

From Riot's TFT game policy — these shape the product, not just the code:

1. **No Legend augment win rates.** Filtered in `aggregate.py`
   (`LEGEND_AUGMENT_PREFIXES`). Verify the ID pattern each set.
2. **No real-time game-state recommendations.** Static pre-game guidance is
   explicitly allowed; recommendations that "adjust in real time based on the
   player's actions in game and give direct prescriptions" are not. Keep augment
   entry manual and player-driven. Do not read game state.
3. **No opponent/lobby scouting during gameplay**, including aggregate stats on
   other players in the lobby.
4. **Register the product** with Riot regardless of whether it uses official
   APIs, and keep a free tier if you monetize.

The practical line: you are shipping a *reference tool the player consults*, not
an *assistant that watches the game and tells them what to do*.

## Why self-aggregation over a stats provider

I originally offered "use an existing provider" as the easy path. On checking,
that's shakier than it sounded — the major TFT stats sites have no public
developer API, only internal endpoints, and MetaTFT's ToS claims ownership of
their platform data. Riot separately requires monetized products to be
"transformative," which reselling someone else's numbers is not.

So: aggregate it yourself (`RiotDerivedSource`), use Data Dragon for static
assets, and approach a provider for a *licensed* feed only if you want one —
`LicensedProviderSource` is the adapter shell for that. Several of these sites
are 1–2 person teams and are reachable if you just ask.

## Where the actual product differentiation is

Every stats site shows "augment X averages 4.1." Few show it *conditionally*:

```
RichGetRicher → Stargazer/Fast9 comps   avg 2.79   lift -0.88   n=2176
RichGetRicher → Reroll comps            avg 5.40   lift +0.31   n=1474
```

That conditional table is what makes "given these augments, build this" a real
recommendation instead of a restated tier list. It falls straight out of
`augment_comp_pairs` and it's what the UI's fit score should be weighted on
once you swap the placeholder tags for real numbers.

## Next steps

- Wire `RiotDerivedSource` into the UI, replacing the hardcoded `COMPS`/`AUGMENTS`
  arrays; scoring becomes `lift_vs_comp` lookups instead of tag matching.
- Fill `COMP_NAMES` in `providers.py` with community comp names per patch.
- Add a nightly job: crawl → aggregate → publish `stats.json` behind a CDN.
- Add rank-tier splits (Challenger vs Emerald) — comps that need tight execution
  look very different at each, and that's genuinely useful to surface.
- Improve `carry_unit()` by weighting offensive vs defensive items from
  `tft-item.json` rather than counting item slots.
