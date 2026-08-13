#!/usr/bin/env bash
# One-time setup. Run from the repo root.
set -euo pipefail

echo "==> Python pipeline"
python3 -m venv .venv
./.venv/bin/pip install -q -r pipeline/requirements.txt
echo "    ok"

echo "==> Web app"
(cd app && npm install --silent)
echo "    ok"

echo
echo "Next:"
echo "  1. Get an API key at https://developer.riotgames.com (Personal keys expire every 24h)"
echo "  2. export RIOT_API_KEY=RGAPI-..."
echo "  3. ./run-crawl.sh      # pulls matches, builds stats (takes 10-30 min first time)"
echo "  4. ./run-dev.sh        # starts the stats server + web app"
