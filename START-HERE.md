# HexCall — how to run it

Everything below has been run end-to-end. The build is clean (58 KB gzipped),
the demo path works without an API key, and the dev stack serves real published
stats through a proxy so you never touch CORS.

---

## Read this first

**If your goal is climbing, building this is the slow path.** MetaTFT,
tactics.tools, and Mobalytics already do comp and augment stats well, for free,
with in-game overlays. Build this if you want the product, the portfolio piece,
or the engineering practice — not because it's the fastest route to LP. See
"Actually improving your rank" at the bottom for the honest version of that.

---

## Step 0 — Prerequisites

| Need | Check | If missing |
|---|---|---|
| Python 3.10+ | `python3 --version` | python.org |
| Node 18+ | `node --version` | nodejs.org |
| Riot account | — | for the API key |

## Step 1 — Setup (2 minutes)

```bash
cd hexcall
./setup.sh
```

Creates a Python venv, installs pipeline deps, runs `npm install`.

## Step 2 — See the UI before committing to anything

```bash
./run-demo.sh     # generates sample data, no API key needed
./run-dev.sh      # opens http://localhost:5173
```

This is the interface running on realistic-shaped data. Click around: pick
augments on the left, watch the comp ranking reorder. If the product doesn't
feel useful here, stop before spending effort on the crawl.

**What you should see:** with no augments, 5 Anima on top. Add econ augments and
Fast 9 comps jump the list. That reordering is the whole point of the tool.

## Step 3 — Get a Riot API key

1. Go to https://developer.riotgames.com and sign in
2. Copy your **Development API Key** from the dashboard

⚠️ **Development keys expire every 24 hours.** You'll regenerate it daily until
you get a production key. This is the single most annoying part of the process
and it catches everyone.

```bash
export RIOT_API_KEY=RGAPI-your-key-here
```

Put it in your shell profile so you're not re-typing it, but **never commit it**.

## Step 4 — Crawl real data

```bash
./run-crawl.sh na1 17        # platform, TFT set number
```

Regions: `na1 euw1 eun1 kr jp1 br1 oc1 sg2 tw2 vn2 th2 ph2 la1 la2 tr1 ru`
(Singapore is `sg2` — worth using if that's your ladder, since the meta differs
by region.)

**First run takes 10–30 minutes** on a development key. The rate limiter is
doing its job, not hanging. You'll see progress every 10 players.

When it finishes it prints what got published:

```
Published slices:
  global-all         48,000 boards  9 comps
  global-apex        11,938 boards  9 comps
```

Slices with under 4,000 boards are deliberately withheld — a tier list built on
900 games is noise wearing a costume.

## Step 5 — Run it

```bash
./run-dev.sh
```

Stats API on :8787, app on :5173. Vite proxies `/api` so there's no CORS setup.

Re-run `./run-crawl.sh` whenever you want fresher data. Each crawl adds to the
existing match store rather than replacing it, so stats sharpen over a few days.

---

## Making it an app you'll actually use

Three options, easiest first.

### Option A — Deploy it as a web app (recommended start)

Free hosting, works on your phone and second monitor, nothing to install.

```bash
cd app && npm run build       # outputs to app/dist/
```

Then either:

**Netlify / Vercel:** drag `app/dist` onto their dashboard, or connect the repo.
Set `VITE_API_BASE` to wherever your stats live.

**GitHub Pages, fully automated:** the included
`.github/workflows/crawl.yml` crawls every 6 hours, builds the app, and deploys
both to Pages. Setup:

1. Push the repo to GitHub
2. Settings → Secrets and variables → Actions → add `RIOT_API_KEY`
3. Settings → Pages → Source: "GitHub Actions"

⚠️ This needs a **production key**. Development keys expire daily, so the
scheduled job will fail on day two. Run crawls by hand until you're approved.

### Option B — Overlay on top of the game (Overwolf)

Overwolf is Riot's sanctioned route for in-game overlays — it's how MetaTFT and
Mobalytics ship theirs. It handles the hard parts (rendering over a fullscreen
game, hotkeys, game-launch detection) and it's what keeps you compliant.

Rough shape: register at overwolf.com/developers, scaffold an app, point its
webview at your built `dist/`, declare TFT (game id 5426) in the manifest,
and bind a hotkey to toggle the window.

Two things to hold onto:
- Your app must still be registered with Riot as a product.
- Riot's policy forbids overlays that "include any real-time data that would
  improve a player's performance immediately by altering player behavior."
  Manual augment entry stays on the right side of that line. Auto-detecting the
  player's board does not.

### Option C — Electron desktop app

Only if you want a standalone window and don't need true overlay behavior.
Electron windows sit *behind* fullscreen games — you'd need borderless windowed
mode. Overwolf is the better tool for the actual job.

---

## Getting a production key

You'll want one for: no daily expiry, higher rate limits, multi-region crawling,
and automation.

Apply at developer.riotgames.com → Register Product → Personal or Production.
Riot wants to see the user flow, so link your deployed app from Option A. Their
approved use cases explicitly include *"aggregate player stats (no specific
players)"* without RSO — which is exactly what this pipeline does.

Approval takes days to weeks. Ship the web app first; that *is* your application.

---

## Actually improving your rank

Honest part. The tool you're building helps in two places, and neither is
during the game:

**Before you queue.** Look at the augment tier list and the augment→comp
pairings for the current patch. Learn *why* Diamond Hands points at reroll and
econ augments point at Fast 9. That knowledge transfers into the game; reading
it off a screen mid-match doesn't build it.

**After you finish.** This is the one that moves LP and the one the tool doesn't
do yet. Review your own last 20 games: where did you actually lose HP? Was it
stage 2 because you played a weak board, or stage 4 because you didn't pivot?
Most players lose ranked LP to the same two or three mistakes repeatedly and
have no idea which ones.

That's also the highest-value feature you could build next, and it's fully
within policy — Riot explicitly encourages post-game analysis. You already have
`tft-match-v1` by-puuid wired up in `riot_client.py`. A "your last 20 games"
view that flags your recurring leaks would be more useful to you than the comp
tier list, and more differentiated as a product.

The thing that won't help: checking a tier list mid-game. It's also the thing
Riot's policy is specifically written to prevent, which is a decent signal that
it isn't where the skill is.

---

## Troubleshooting

**`401`/`403` from Riot** — key expired. Regenerate it; they last 24 hours.

**`429` everywhere** — you're sharing the key with another process. Only one
crawler at a time; `scheduler.py` has a lock file to enforce this.

**"No stats published yet"** — `./run-crawl.sh` hasn't succeeded. Check that
`RIOT_API_KEY` is exported in *this* shell.

**All slices skipped for low sample** — crawl more: raise
`--players-per-tier`, or run several times over a few days.

**Comps show raw signatures like `Anima5_Duelist2 :: TFT17_Fiora`** — expected
until you populate `COMP_NAMES` in `providers.py`. Community comp names shift
every patch, so this stays a hand-edited map.

**Data Dragon warning in logs** — harmless. It lags patches by a day or two;
the ID prettifier covers the gap.
