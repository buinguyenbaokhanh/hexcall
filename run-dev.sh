#!/usr/bin/env bash
# Starts the stats API and the web app together.
set -euo pipefail

if [ ! -d pipeline/public/current ]; then
  echo "No stats published yet. Run ./run-crawl.sh first."
  echo "(Or ./run-demo.sh to preview the UI with generated sample data.)"
  exit 1
fi

cleanup() { kill 0; }
trap cleanup EXIT

(cd pipeline && ../.venv/bin/python server.py) &
sleep 2
(cd app && npm run dev)
