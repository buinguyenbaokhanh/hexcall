# Putting this on GitHub

## 1. Check nothing sensitive is staged

The `.gitignore` covers keys, the match database, and generated stats. Verify before
your first push:

```bash
git init
git add -A
git status              # scan this list — no .env, no *.db, no RGAPI- strings
git diff --cached | grep -i "RGAPI" && echo "STOP: key found" || echo "clean"
```

If a key ever does get committed, rotating it at developer.riotgames.com is faster and
safer than rewriting history. Do both.

## 2. First commit

```bash
git commit -m "HexCall: TFT decision-assist tool with conditional comp statistics"
git branch -M main
git remote add origin git@github.com:YOU/hexcall.git
git push -u origin main
```

## 3. Repo presentation

**Description:** `TFT decision-assist tool — conditional comp statistics from the Riot API, plus personal leak detection`

**Topics:** `teamfight-tactics` `riot-api` `react` `python` `data-pipeline` `game-analytics` `vite` `sqlite`

**Add screenshots.** A README with images gets read; one without gets skimmed. Capture:
1. The recommender with augments selected, showing the ranking reorder
2. The review tab with leaks detected

```bash
mkdir -p docs/img
# save screenshots there, then reference in README.md:
# ![Recommender](docs/img/recommender.png)
```

Put them near the top, right after the intro paragraph.

## 4. What to say about it

The parts worth leading with in an interview or portfolio blurb, roughly in order of
how much they differentiate you:

- **The statistical model.** Conditional lift with empirical-Bayes shrinkage, and the
  reasoning for why unshrunk lifts produce a misleading leaderboard. Most data projects
  stop at "I computed averages."
- **Testing without live data.** Synthetic matches with planted ground truth let the
  aggregation and leak detection be validated with no API key and no network. That's a
  real engineering answer to "how do you test a data pipeline."
- **Constraints as design input.** Riot's policy forbids real-time in-game
  recommendations; the architecture treats that as a product decision rather than
  something to work around. Being able to explain a constraint you *didn't* fight is
  more interesting than a feature list.
- **Honest failure modes.** The UI distinguishes live data from a stale snapshot,
  withholds under-sampled slices, and surfaces confidence. Knowing when not to show a
  number is a senior instinct.

## 5. Enable the automated crawl

`.github/workflows/crawl.yml` crawls once a day, commits the refreshed `data/`, and
dispatches `deploy.yml` to redeploy Pages. The schedule is on.

1. Settings → Secrets and variables → Actions → New secret: `RIOT_API_KEY`, set to
   the registered product key from the app's page in the developer portal
2. Settings → Pages → Source: **GitHub Actions**
3. Actions → crawl-and-publish → **Run workflow** to publish without waiting a day

It needs the registered key, which doesn't expire. A development key would fail
the schedule from day two, and a workflow with a long red failure history looks
worse on a portfolio repo than no workflow at all. If the secret is missing or
the key stops working, the run fails loudly rather than going green with nothing
crawled.

When a new TFT set launches, change `TFT_SET` at the top of `crawl.yml`. The match
store's cache key follows it, so the new set starts from a clean store.
