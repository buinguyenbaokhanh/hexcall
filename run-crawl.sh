#!/usr/bin/env bash
# Crawl the ladder and publish a stats build.
set -euo pipefail

# Load .env if present, so the key lives in a gitignored file rather than
# having to be re-exported in every new shell. An already-exported
# RIOT_API_KEY wins, which is what CI relies on.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${RIOT_API_KEY:-}" ]; then
  echo "RIOT_API_KEY is not set."
  echo "Copy .env.example to .env and put your key in it, or:  export RIOT_API_KEY=RGAPI-..."
  echo "Get one at https://developer.riotgames.com (development keys expire every 24h)."
  exit 1
fi

PLATFORM="${1:-na1}"
SET_NUM="${2:-17}"

cd pipeline
../.venv/bin/python scheduler.py --once \
  --platforms "$PLATFORM" \
  --tiers challenger grandmaster \
  --players-per-tier 60 \
  --matches-per-player 20 \
  --lookback-days 3 \
  --set "$SET_NUM"

echo
echo "Published slices:"
../.venv/bin/python -c "
import json,pathlib
m=json.loads(pathlib.Path('public/current/manifest.json').read_text())
for s in m['slices']:
    print(f\"  {s['id']:16s} {s['sample_size']:>7,} boards  {s['comps']} comps\")
"
