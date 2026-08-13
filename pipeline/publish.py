"""
Publisher: turns the raw match store into the versioned, sliceable artifacts
the client actually fetches.

WHY THIS LAYER EXISTS
---------------------
The client must never call the Riot API directly:
  * your key would ship in the bundle (against Riot's security policy)
  * rate limits are per-key, so all your users share one 100-req/2min budget
  * a tier list needs thousands of matches -- minutes of crawling, not a
    request/response cycle

So the flow is: crawl on a schedule -> aggregate -> publish immutable JSON ->
client fetches the published file. Every stats site works this way.

SLICES
------
Users want different cuts: "Challenger NA" vs "all ranks EUW". Each cut is a
separate pre-computed file rather than a live query, because aggregation over
a large match table is too slow to do per request. The manifest tells the
client which slices exist.

ATOMIC PUBLISH
--------------
Each build writes to build/<timestamp>/ then flips a `current` symlink. A
client mid-fetch never sees a half-written file, and rolling back is one
symlink change.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import time
from collections import Counter
from pathlib import Path

from aggregate import build_stats, puuids_for_tiers
from comp_detail import build_comp_details, slug

log = logging.getLogger("publish")

PUBLIC_DIR = Path("public")
BUILD_DIR = PUBLIC_DIR / "builds"
CURRENT = PUBLIC_DIR / "current"

# Which cuts to precompute. Add rows as your match volume supports them --
# a slice with too few matches produces noisy stats, so check sample_size
# in the manifest before exposing a new one in the UI.
SLICES = [
    {"id": "global-all",     "label": "All regions, all ranks",  "platform": None, "tiers": None},
    {"id": "global-apex",    "label": "Challenger + GM",         "platform": None, "tiers": ["CHALLENGER", "GRANDMASTER"]},
    {"id": "na1-apex",       "label": "NA Challenger + GM",      "platform": "na1", "tiers": ["CHALLENGER", "GRANDMASTER"]},
    {"id": "euw1-apex",      "label": "EUW Challenger + GM",     "platform": "euw1", "tiers": ["CHALLENGER", "GRANDMASTER"]},
    {"id": "kr-apex",        "label": "KR Challenger + GM",      "platform": "kr", "tiers": ["CHALLENGER", "GRANDMASTER"]},
]

MIN_SAMPLE_TO_PUBLISH = 4000  # participants; below this the slice is noise

# Units summarised onto each comp row in the slice payload. A TFT board caps at
# 10ish, and the row only needs enough to be recognisable.
BOARD_UNITS = 10


# game_version is free-form and its shape differs by platform. Live matches
# report the full build banner:
#     "Linux Version 16.16.804.9184 (Aug 10 2026/16:13:14) [PUBLIC] <Releases/16.16>"
# while the synthetic fixtures use the older short form "Version 17.8.700.1234".
# Stripping a literal "Version " prefix and splitting on dots only works for the
# second, and silently yields "Linux 16.16" for the first -- which then builds a
# LIKE pattern matching no rows at all, so a crawl of real matches publishes
# nothing and any leftover fixture data takes over the build. Pull the first
# major.minor pair out instead, which both forms contain.
_PATCH_RE = re.compile(r"(\d+)\.(\d+)")


def current_patch(conn: sqlite3.Connection) -> str | None:
    """The NEWEST patch present in the store, e.g. '16.16'.

    Newest rather than most-sampled on purpose. A store that spans a patch
    boundary holds more matches from the OLD patch for a day or two after it
    flips -- picking by volume would keep publishing a tier list for a patch
    nobody is playing any more. The cost is a thin sample immediately after a
    patch lands, which publish() logs so it's visible rather than silent.
    """
    best = None
    for (gv,) in conn.execute(
            "SELECT DISTINCT game_version FROM matches WHERE game_version IS NOT NULL"):
        m = _PATCH_RE.search(gv)
        if not m:
            continue
        key = (int(m.group(1)), int(m.group(2)))
        if best is None or key > best:
            best = key
    return f"{best[0]}.{best[1]}" if best else None


def patch_filter(patch: str) -> str:
    """LIKE pattern matching a patch in either game_version shape."""
    return f"%Version {patch}.%"


def auto_comp_name(shape: dict, resolver) -> str | None:
    """A readable comp name derived from its defining trait and carry.

    "TFT17_DRX5_TFT17_ASTrait2_TFT17_HPTank2 :: TFT17_Kindred" -> "5 DRX Kindred".

    Without this every comp renders as its raw signature, because COMP_NAMES in
    providers.py ships empty and community names change every patch. The unit
    count is kept because it distinguishes comps that share a trait and carry
    but play completely differently ("5 DRX Kindred" vs "2 DRX Kindred").
    Hand-written entries always win over this.
    """
    if not resolver:
        return None
    traits, carry = shape.get("traits") or [], shape.get("carry")
    if not traits:
        return None
    trait_id, units = traits[0]
    trait_name = resolver.trait(trait_id)
    carry_name = resolver.champion(carry) if carry else ""
    return " ".join(x for x in (str(units), trait_name, carry_name) if x).strip()


# A unit is treated as a reroll target when it hits 3-star on at least this
# share of the comp's boards. Well below half on purpose: a comp only manages
# the 3-star some of the time, but rerolling for it is still the plan.
REROLL_STAR_SHARE = 0.30


def comp_profile(base: dict) -> dict:
    """The measured characteristics an augment can be matched against.

    Everything here comes from the aggregation, not from judgement: the level
    the comp actually finishes on, the units it actually 3-stars, how many
    items its carry actually ends up holding. The client pairs these with what
    an augment says it does, which is the only honest way to answer "does this
    augment fit this comp" when the match API records no augments at all.
    """
    levels = base.get("level_curve") or []
    modal_level = max(levels, key=lambda r: r["pct"])["level"] if levels else None

    three_stars = [u.get("name") or u["id"] for u in base.get("units", [])
                   if float((u.get("stars") or {}).get("3", {}).get("pct") or 0) >= REROLL_STAR_SHARE]

    counts = base.get("item_count_curve") or []
    carry_items = max(counts, key=lambda r: r["n"])["items"] if counts else None

    carry = (base.get("carries") or [{}])[0]
    return {
        "finish_level": modal_level,
        "reroll": bool(three_stars),
        "three_stars": three_stars,
        "carry_items": carry_items,
        "carry": carry.get("id"),
        "trait_ids": [t["name"] for t in base.get("traits", [])],
        "champion_ids": [u["id"] for u in base.get("units", [])],
    }


def name_comps(shapes: dict, overrides: dict | None, resolver) -> dict:
    """{signature: display name}, hand-written entries winning over derived ones.

    Two genuinely different comps often share a headline trait and carry --
    "5 Space Groove Nami" built around Timebreaker places 4.73, the one built
    around Sorcerer places 6.00 -- so a name from the top trait alone can
    collide and put two very different rows under one label. Collisions get
    their second trait appended to tell them apart.
    """
    names = dict(overrides or {})
    derived: dict[str, str] = {}
    for sig, shape in shapes.items():
        if sig in names:
            continue
        name = auto_comp_name(shape, resolver)
        if name:
            derived[sig] = name

    counts = Counter(derived.values())
    for sig, name in derived.items():
        if counts[name] > 1:
            traits = shapes[sig].get("traits") or []
            if len(traits) > 1 and resolver:
                name = f"{name} ({resolver.trait(traits[1][0])})"
        names[sig] = name
    return names


def build_slice(conn: sqlite3.Connection, slice_def: dict, patch: str | None,
                tft_set: int | None, resolver=None, comp_names: dict | None = None) -> dict:
    filters: dict = {"tft_set": tft_set}
    if patch:
        filters["game_version_like"] = patch_filter(patch)
    if slice_def.get("platform"):
        filters["platform"] = slice_def["platform"]

    # Tier filtering works on PARTICIPANTS, not matches. A Challenger game
    # contains seven opponents who may be lower tier -- counting their boards
    # would quietly contaminate an "apex only" slice with Master/Diamond play.
    if slice_def.get("tiers"):
        filters["puuid_filter"] = puuids_for_tiers(
            conn, slice_def["tiers"], slice_def.get("platform"))

    stats = build_stats(conn, **filters)

    stats["slice_id"] = slice_def["id"]
    stats["slice_label"] = slice_def["label"]
    stats["patch"] = patch
    stats["generated_at"] = int(time.time())
    stats["comp_names"] = name_comps(stats.get("comp_shapes", {}), comp_names, resolver)
    carry_ids = {sig.partition(" :: ")[2] for sig in stats["comps"]} - {""}
    # Union with stats["champions"]/unit_items keys: a champion can be common
    # enough to have its own stat line (or item builds) without ever being the
    # detected carry of a published comp -- most enablers and off-meta units.
    champ_ids = carry_ids | set(stats["champions"]) | set(stats["unit_items"])
    # Champions referenced by the item-holder rows too, so the Items tab can
    # draw a portrait for every "best holder" it lists.
    champ_ids |= {h["champion"] for rows in stats["item_holders"].values() for h in rows}
    item_ids = set(stats["items"]) | {i for b in stats["unit_items"].values()
                                      for r in b for i in r["items"]}

    if resolver:
        stats["augment_names"] = {a: resolver.augment(a) for a in stats["augments"]}
        stats["augment_icons"] = {a: resolver.icon_url("augments", a) for a in stats["augments"]}
        stats["champion_names"] = {c: resolver.champion(c) for c in champ_ids}
        stats["champion_icons"] = {c: resolver.champion_portrait(c) for c in champ_ids}
        stats["item_names"] = {i: resolver.item(i) for i in item_ids}
        stats["item_icons"] = {i: resolver.item_icon(i) for i in item_ids}
        for cid, builds in stats["unit_items"].items():
            for b in builds:
                b["names"] = [resolver.item(i) for i in b["items"]]
                b["icons"] = [resolver.item_icon(i) for i in b["items"]]
    else:
        from static_data import prettify_id
        stats["augment_names"] = {a: prettify_id(a) for a in stats["augments"]}
        stats["augment_icons"] = {}
        stats["champion_names"] = {c: prettify_id(c) for c in champ_ids}
        stats["champion_icons"] = {}
        stats["item_names"] = {i: prettify_id(i) for i in item_ids}
        stats["item_icons"] = {}
        for cid, builds in stats["unit_items"].items():
            for b in builds:
                b["names"] = [prettify_id(i) for i in b["items"]]
                b["icons"] = [None for _ in b["items"]]
    return stats


def _write(path: Path, payload: dict) -> dict:
    """Writes both plain and gzipped copies; returns size/hash metadata."""
    raw = json.dumps(payload, separators=(",", ":")).encode()
    path.write_bytes(raw)
    with gzip.open(path.with_suffix(".json.gz"), "wb", compresslevel=9) as f:
        f.write(raw)
    return {
        "bytes": len(raw),
        "gzip_bytes": path.with_suffix(".json.gz").stat().st_size,
        "etag": hashlib.sha256(raw).hexdigest()[:16],
    }


def publish(db_path: str = "tft.db", tft_set: int | None = None,
            comp_names: dict | None = None, keep_builds: int = 5,
            patch: str | None = None) -> Path:
    conn = sqlite3.connect(db_path)
    patch = patch or current_patch(conn)
    if patch:
        # Right after a patch flips, the newest patch can hold very few games.
        # Log the split so a thin build is obvious instead of quietly shipping.
        n_patch = conn.execute("SELECT COUNT(*) FROM matches WHERE game_version LIKE ?",
                               (patch_filter(patch),)).fetchone()[0]
        n_all = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        log.info("building for patch %s: %d of %d stored matches (%.0f%%)",
                 patch, n_patch, n_all, 100 * n_patch / max(n_all, 1))
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out = BUILD_DIR / stamp
    out.mkdir(parents=True, exist_ok=True)

    try:
        from static_data import load_all, NameResolver
        resolver = NameResolver(load_all())
    except Exception as e:  # noqa: BLE001
        log.warning("Data Dragon unavailable (%s); falling back to ID prettifier", e)
        resolver = None

    manifest = {"generated_at": int(time.time()), "patch": patch,
                "tft_set": tft_set, "slices": []}

    for sd in SLICES:
        filters = {"tft_set": tft_set}
        if patch:
            filters["game_version_like"] = patch_filter(patch)
        if sd.get("platform"):
            filters["platform"] = sd["platform"]
        if sd.get("tiers"):
            filters["puuid_filter"] = puuids_for_tiers(conn, sd["tiers"], sd.get("platform"))
        try:
            stats = build_slice(conn, sd, patch, tft_set, resolver, comp_names)
        except Exception as e:  # noqa: BLE001
            log.exception("slice %s failed: %s", sd["id"], e)
            continue

        if stats["sample_size"] < MIN_SAMPLE_TO_PUBLISH:
            log.warning("skipping %s: only %d participants (need %d)",
                        sd["id"], stats["sample_size"], MIN_SAMPLE_TO_PUBLISH)
            continue

        # Per-comp build detail lives in its own file and is fetched on demand,
        # so the main slice payload stays small.
        detail_filters = {k: v for k, v in filters.items()}
        published = {sig: {"name": (comp_names or {}).get(sig, sig)} for sig in stats["comps"]}
        try:
            details = build_comp_details(conn, published, resolver, **detail_filters)
        except Exception:
            log.exception("comp detail failed for %s; publishing without it", sd["id"])
            details = {}
        if details:
            ddir = out / "comps" / sd["id"]
            ddir.mkdir(parents=True, exist_ok=True)
            for cslug, doc in details.items():
                _write(ddir / f"{cslug}.json", doc)
            stats["comp_slugs"] = {sig: slug(sig) for sig in stats["comps"]}

            # Lift a compact board summary into the slice payload so the comp
            # LIST can show its units and traits without fetching one detail
            # file per row. The full detail stays on demand; this is only what
            # a row needs to be recognisable at a glance.
            for sig in stats["comps"]:
                doc = details.get(slug(sig))
                if not doc:
                    continue
                base = doc.get("base", {})
                carry_id = (base.get("carries") or [{}])[0].get("id")
                stats["comps"][sig]["board"] = [
                    {"id": u["id"], "name": u.get("name"), "icon": u.get("icon"),
                     "play_rate": u.get("play_rate"),
                     "carry": u["id"] == carry_id,
                     # Most common star level reached, so a row can show 2* vs
                     # 3* the way the game does -- it's the difference between
                     # a reroll board and a standard one.
                     "star": max(u.get("stars", {}).items(),
                                 key=lambda kv: kv[1]["pct"], default=("2", None))[0],
                     "items": (u.get("builds") or [{}])[0].get("items", [])[:3],
                     "item_icons": (u.get("builds") or [{}])[0].get("icons", [])[:3]}
                    for u in base.get("units", [])[:BOARD_UNITS]
                ]
                stats["comps"][sig]["traits"] = base.get("traits", [])[:6]
                stats["comps"][sig]["levels"] = base.get("level_curve", [])
                stats["comps"][sig]["profile"] = comp_profile(base)
            log.info("  %d comp detail docs for %s", len(details), sd["id"])

        meta = _write(out / f"{sd['id']}.json", stats)
        manifest["slices"].append({
            "id": sd["id"], "label": sd["label"],
            "sample_size": stats["sample_size"],
            "comps": len(stats["comps"]),
            "augments": len(stats["augments"]),
            "pairs": len(stats["augment_comp_pairs"]),
            "url": f"/data/{sd['id']}.json",
            **meta,
        })
        log.info("published %s: %d participants, %.1f KB gzipped",
                 sd["id"], stats["sample_size"], meta["gzip_bytes"] / 1024)

    if not manifest["slices"]:
        shutil.rmtree(out)
        raise RuntimeError("nothing published -- is the match store empty?")

    manifest["default_slice"] = manifest["slices"][0]["id"]
    _write(out / "manifest.json", manifest)

    # Item tooltip content (description, stats, crafting recipe). This is set
    # reference data, not match-derived, so it's the same across every slice
    # and gets written once rather than duplicated per slice.
    if resolver:
        try:
            from static_data import build_item_meta
            item_meta = build_item_meta(resolver)
            meta = _write(out / "item-meta.json", item_meta)
            log.info("published item-meta: %d items, %.1f KB gzipped",
                     len(item_meta), meta["gzip_bytes"] / 1024)
        except Exception:
            log.exception("item metadata build failed; item tooltips will be icon-only")

        # Champion and augment catalogues (cost, role, traits, rarity, ability
        # text). Also set reference data -- same treatment as item-meta above.
        #
        # These are full catalogues, not just what the crawl observed: a stats
        # slice only holds entries that cleared the sample floor, so a client
        # driven purely by stats would show a fraction of the real roster and
        # augment pool. The client joins measured stats onto these.
        try:
            from static_data import build_champion_meta
            champion_meta = build_champion_meta(resolver, tft_set)
            meta = _write(out / "champion-meta.json", champion_meta)
            log.info("published champion-meta: %d champions, %.1f KB gzipped",
                     len(champion_meta), meta["gzip_bytes"] / 1024)
        except Exception:
            log.exception("champion metadata build failed; the Champions tab will degrade to stats-only")

        try:
            from static_data import build_augment_meta
            augment_meta = build_augment_meta(resolver, tft_set)
            meta = _write(out / "augment-meta.json", augment_meta)
            log.info("published augment-meta: %d augments, %.1f KB gzipped",
                     len(augment_meta), meta["gzip_bytes"] / 1024)
        except Exception:
            log.exception("augment metadata build failed; the Augments tab will degrade to stats-only")

        try:
            from static_data import build_trait_meta
            trait_meta = build_trait_meta(resolver, tft_set)
            meta = _write(out / "trait-meta.json", trait_meta)
            log.info("published trait-meta: %d trait keys, %.1f KB gzipped",
                     len(trait_meta), meta["gzip_bytes"] / 1024)
        except Exception:
            log.exception("trait metadata build failed; trait badges will render without icons")

    # Atomic swap: build fully, then flip the pointer.
    tmp = PUBLIC_DIR / f".current.{stamp}"
    if tmp.exists() or tmp.is_symlink():
        tmp.unlink()
    tmp.symlink_to(out.resolve(), target_is_directory=True)
    os.replace(tmp, CURRENT)
    log.info("current -> %s", out)

    builds = sorted(BUILD_DIR.iterdir(), reverse=True)
    for old in builds[keep_builds:]:
        shutil.rmtree(old, ignore_errors=True)
        log.info("pruned old build %s", old.name)

    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="tft.db")
    ap.add_argument("--set", type=int, dest="tft_set")
    ap.add_argument("--comp-names", help="JSON file mapping signature -> display name")
    ap.add_argument("--patch", help="override the auto-detected patch, e.g. 16.16")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    names = json.loads(Path(args.comp_names).read_text()) if args.comp_names else None
    publish(args.db, args.tft_set, names, patch=args.patch)
