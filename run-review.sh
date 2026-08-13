#!/usr/bin/env bash
# Review your own recent ranked games.
set -euo pipefail

if [ -z "${RIOT_API_KEY:-}" ]; then
  echo "RIOT_API_KEY is not set. export RIOT_API_KEY=RGAPI-..."
  exit 1
fi
if [ $# -lt 1 ]; then
  echo "Usage: ./run-review.sh 'YourName#TAG' [platform]"
  echo "Example: ./run-review.sh 'Faker#KR1' kr"
  exit 1
fi

cd pipeline
../.venv/bin/python review.py "$1" --platform "${2:-na1}" --count "${3:-20}"
