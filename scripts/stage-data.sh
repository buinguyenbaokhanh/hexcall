#!/usr/bin/env bash
# Copy the current published build into data/ so it can be committed and
# deployed by .github/workflows/deploy.yml.
#
# Only the plain .json files are staged. Each one has a .json.gz sibling that
# publish.py writes for a CDN that serves pre-compressed assets; GitHub Pages
# compresses on the fly, so committing both would double the repo size for no
# benefit.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="pipeline/public/current"
DEST="data"

[ -e "$SRC" ] || { echo "no published build at $SRC -- run the publish step first"; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"
# -L follows the `current` symlink into the timestamped build directory.
(cd "$SRC" && find -L . -name "*.json" -print0) \
  | while IFS= read -r -d '' f; do
      mkdir -p "$DEST/$(dirname "$f")"
      cp "$SRC/$f" "$DEST/$f"
    done

patch=$(python3 -c "import json;print(json.load(open('$DEST/manifest.json'))['patch'])" 2>/dev/null || echo "?")
slices=$(python3 -c "import json;print(len(json.load(open('$DEST/manifest.json'))['slices']))" 2>/dev/null || echo "?")
echo "staged patch $patch, $slices slices, $(find "$DEST" -name '*.json' | wc -l | tr -d ' ') files, $(du -sh "$DEST" | cut -f1)"
echo "now: git add data && git commit && git push"
