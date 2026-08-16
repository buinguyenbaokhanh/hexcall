#!/usr/bin/env bash
# Starts the stats API and the web app together.
set -euo pipefail

# Same .env load as run-crawl.sh. Without it the stats API starts fine and
# every tab works, but "Review My Games" fails with "No API key" -- it's the
# one feature that calls Riot at request time. Exporting the key by hand in
# the right shell is not a step anyone remembers.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ ! -d pipeline/public/current ]; then
  echo "No stats published yet. Run ./run-crawl.sh first."
  echo "(Or ./run-demo.sh to preview the UI with generated sample data.)"
  exit 1
fi

if [ -z "${RIOT_API_KEY:-}" ]; then
  echo "Note: RIOT_API_KEY is not set, so 'Review My Games' will not work."
  echo "      Every other tab reads published files and is unaffected."
fi

cleanup() { kill 0; }
trap cleanup EXIT

(cd pipeline && ../.venv/bin/python server.py) &
sleep 2
(cd app && npm run dev)
