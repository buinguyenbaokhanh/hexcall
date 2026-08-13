# Going live: from hardcoded stats to a real feed

## The constraint that shapes everything

**The client must never call the Riot API.** Three independent reasons:

1. Your API key would ship inside the client bundle. Riot's security policy:
   *"Your API key may not be included in your code, especially if you plan on
   distributing a binary."*
2. Rate limits are **per key, not per user**. A personal key gets ~100 requests
   per 2 minutes — shared across your entire userbase. You'd die at ten players.
3. Building a tier list requires thousands of matches. That's minutes of
   crawling, not a request/response cycle.

So "dynamic" doesn't mean "fetch on demand." It means:

```
  scheduler.py  (holds the key, runs every 6h)
       │
       ├─ ingest.py    ladder → puuids → matches → SQLite
       ├─ aggregate.py matches → comp/augment/pair statistics
       └─ publish.py   statistics → immutable JSON, atomic symlink swap
                              │
                              ▼
                       public/current/
                       ├── manifest.json      ← what slices exist
                       ├── global-apex.json
                       ├── na1-apex.json
                       └── *.json.gz
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        server.py (Flask)              static CDN (S3/R2/Netlify)
        ETag, CORS, filtering          cheaper, faster, no ops
              │                               │
              └───────────────┬───────────────┘
                              ▼
                         React client
                    fetch manifest → fetch slice
                    refresh every 15 min
```

## Run it

```bash
export RIOT_API_KEY=RGAPI-...

# one cycle (use this from cron)
python scheduler.py --platforms na1 --interval-hours 6 --once

# or run continuously
python scheduler.py --platforms na1 euw1 kr --interval-hours 6

# serve
python server.py            # dev
gunicorn -w 2 server:app -b 0.0.0.0:8787    # production
```

Cron alternative:

```cron
0 */6 * * * cd /srv/tft && RIOT_API_KEY=... /usr/bin/python3 scheduler.py --once >> crawl.log 2>&1
```

## Point the client at it

In `tft-comp-advisor-v3.jsx`:

```js
const API_BASE = "http://localhost:8787/api";   // or "https://cdn.you/data"
const STATIC_MODE = false;                       // true for the CDN shape
```

The client fetches `manifest` → picks `default_slice` → fetches that slice, and
re-checks every 15 minutes. If the feed is unreachable it keeps the bundled
snapshot and shows an amber banner saying the numbers aren't current — silently
serving stale stats is worse than admitting the gap.

## Recommendation: skip the server

`publish.py` writes plain static files. Pushing `public/current/` to S3+CloudFront,
Cloudflare R2, or Netlify gets you edge caching, TLS, and effectively free
hosting with no process to keep alive. Use `server.py` only when you want
request-time filtering or usage metrics.

```bash
aws s3 sync public/current/ s3://your-bucket/data/ --delete \
  --cache-control "public, max-age=900, stale-while-revalidate=86400"
```

Payloads are ~5 KB gzipped per slice, so bandwidth cost is negligible even at
scale. With ETags, repeat fetches transfer **zero bytes** (verified: 36,390 →
0 on conditional request).

## Design decisions worth knowing

**Slices are precomputed, not queried.** Users want "Challenger NA" vs "all
ranks EUW". Aggregating over the whole match table per request is too slow, so
each cut is built ahead of time and listed in the manifest.

**Tier filtering applies to participants, not matches.** A Challenger game
contains seven opponents who may be Master or Diamond. Filtering by match would
quietly contaminate an "apex only" slice with lower-tier boards. `puuids_for_tiers()`
filters individual participants against the ladder crawl.

**Under-sampled slices are dropped, not published.** `MIN_SAMPLE_TO_PUBLISH`
(4,000 participants) — a slice below that produces noise dressed up as a tier
list. In testing, EUW and KR were correctly withheld at ~3,850.

**Old patches are deleted, not archived.** After a balance patch the old data
describes a game that no longer exists. Keeping it inflates sample size while
degrading accuracy. `prune_old_patches()` detects the version change and clears
the window.

**Publishing is atomic.** Each build writes to `builds/<timestamp>/`, then flips
a `current` symlink. A client mid-fetch never sees a half-written file, and
rollback is one symlink change. The last 5 builds are retained.

**Crawl failure never takes down serving.** If one region's crawl throws, the
others continue and the previous build stays live. Stale data beats no data.

## Capacity planning

| Key type | Realistic scope |
|---|---|
| Personal (20/s, 100/2min, expires daily) | one region, shallow crawl, dev only |
| Production | multi-region, 6h cadence, what you actually ship on |

Getting a production key requires Riot to review a working prototype — the UI
you already have is what you show them. Note their approved use case list
includes *"aggregate player stats (no specific players)"* without RSO, which is
exactly what this pipeline does.

## Still to build

- `COMP_NAMES` in `providers.py` needs hand-editing each patch; community comp
  names shift and auto-generated labels from trait signatures read awkwardly.
- Browse-tab tier letters use fixed placement thresholds. Percentile-based
  cutoffs would be better once you see real distributions — a patch where
  everything clusters at 4.4 currently shows zero S-tiers.
- Data Dragon lags patches by a day or two. `NameResolver.unresolved` tracks
  IDs it couldn't name; watch it spike after each patch.
