"""
Per-comp build detail -- the "what do I actually build" layer.

WHAT THIS PRODUCES
------------------
For each comp, and again for each augment held with that comp:
  * unit roster      -- play rate within the comp, avg placement, star distribution
  * item builds      -- top complete item sets per carry, with placement
  * item count curve -- placement vs. number of items on the carry
  * level curve      -- final level distribution and placement per level
  * trait shape      -- typical breakpoints hit

The augment-conditional cut is the differentiator. Aggregate sites show you the
standard build for a comp. This shows how that build actually changes when you
hold a specific augment -- different carry, different item priority, different
level you end on.

WHAT IS NOT HERE, AND WHY
-------------------------
tft-match-v1's UnitDto is {character_id, itemNames, rarity, tier, name}. There
are no board coordinates, so POSITIONING CANNOT BE COMPUTED from this API.
Nor can round-by-round win rates, levelling timings (when you hit 8), or
carousel priority -- the API returns one end-of-game snapshot per player, not a
timeline. Sites that show those read the game client through an overlay.

Building a "positioning" panel from this data would mean inventing it, so there
isn't one.

SIZE
----
Detail is written to one file per comp rather than into the main stats payload,
and fetched on demand when a user opens a comp. The main payload stays ~5 KB.
"""

from __future__ import annotations

import hashlib
import json
import re
import statistics
from collections import defaultdict, Counter

from aggregate import comp_signature, carry_unit, is_legend_augment

# Sample floors. Below these the numbers are noise, so the row is dropped
# rather than shown with a caveat nobody reads.
MIN_UNIT_N = 25
MIN_BUILD_N = 12
MIN_AUG_COND_N = 80      # to compute a conditional cut at all
TOP_UNITS = 14
TOP_BUILDS_PER_UNIT = 4
TOP_CARRIES = 3
TOP_TRAITS = 12


def slug(sig: str) -> str:
    """Stable, filesystem-safe id for a comp signature."""
    clean = re.sub(r"[^a-zA-Z0-9]+", "-", sig).strip("-").lower()[:48]
    return f"{clean}-{hashlib.sha1(sig.encode()).hexdigest()[:6]}"


class _Acc:
    __slots__ = ("n", "sum")

    def __init__(self):
        self.n = 0
        self.sum = 0

    def add(self, p: int):
        self.n += 1
        self.sum += p

    @property
    def avg(self) -> float:
        return self.sum / self.n if self.n else 0.0


def _trait_rows(trait_acc: dict, total: int) -> list[dict]:
    """Per-trait breakpoint distribution: [{name, total_pct, levels:[...]}].

    A comp doesn't hit one fixed breakpoint -- the same board runs 2 of a trait
    on some games and 4 on others, and those place differently. Reporting only
    the most common count throws away the part a player can act on ("going from
    3 to 4 is worth a full placement").
    """
    by_name: dict[str, list[dict]] = defaultdict(list)
    seen: dict[str, int] = defaultdict(int)
    for (name, units), acc in trait_acc.items():
        if acc.n < MIN_BUILD_N:
            continue
        by_name[name].append({"units": units, "n": acc.n,
                              "pct": round(acc.n / total, 4),
                              "avg": round(acc.avg, 2)})
        seen[name] += acc.n

    rows = []
    for name, levels in by_name.items():
        levels.sort(key=lambda r: r["units"])
        modal = max(levels, key=lambda r: r["n"])
        rows.append({
            "name": name,
            "units": modal["units"],          # kept for the compact row view
            "pct": round(seen[name] / total, 3),
            "avg": modal["avg"],
            "levels": levels,
        })
    rows.sort(key=lambda r: -r["pct"])
    return rows[:TOP_TRAITS]


def _detail_from(boards: list[dict]) -> dict:
    """boards = [{placement, level, units, traits}] for one comp (optionally
    filtered to those holding a given augment)."""
    total = len(boards)
    if not total:
        return {}

    unit_acc: dict[str, _Acc] = defaultdict(_Acc)
    star_acc: dict[str, dict[int, _Acc]] = defaultdict(lambda: defaultdict(_Acc))
    build_acc: dict[str, dict[tuple, _Acc]] = defaultdict(lambda: defaultdict(_Acc))
    itemcount_acc: dict[int, _Acc] = defaultdict(_Acc)
    level_acc: dict[int, _Acc] = defaultdict(_Acc)
    trait_acc: dict[tuple[str, int], _Acc] = defaultdict(_Acc)
    carry_counter: Counter = Counter()
    item_acc: dict[str, _Acc] = defaultdict(_Acc)
    item_holder_acc: dict[tuple[str, str], _Acc] = defaultdict(_Acc)
    unit_itemcount_acc: dict[tuple[str, int], _Acc] = defaultdict(_Acc)
    placements: Counter = Counter()

    for b in boards:
        p = b["placement"]
        level_acc[b.get("level", 0)].add(p)
        placements[p] += 1

        seen_units = set()
        for u in b.get("units", []):
            cid = u.get("character_id")
            if not cid:
                continue
            if cid not in seen_units:      # a unit counts once per board
                unit_acc[cid].add(p)
                seen_units.add(cid)
            star_acc[cid][u.get("tier", 1)].add(p)

            items = tuple(sorted(u.get("itemNames") or []))
            for it in items:
                item_acc[it].add(p)
                item_holder_acc[(it, cid)].add(p)
            # Item count per unit, not just the carry: a support holding 2
            # items instead of 0 is a real decision the carry curve can't show.
            unit_itemcount_acc[(cid, min(len(items), 3))].add(p)
            if len(items) >= 2:
                build_acc[cid][items].add(p)

        c = carry_unit(b.get("units", []))
        if c:
            carry_counter[c] += 1
            for u in b.get("units", []):
                if u.get("character_id") == c:
                    itemcount_acc[min(len(u.get("itemNames") or []), 3)].add(p)
                    break

        for t in b.get("traits", []):
            if t.get("tier_current", 0) > 0:
                trait_acc[(t["name"], t.get("num_units", 0))].add(p)

    units = []
    for cid, acc in unit_acc.items():
        if acc.n < MIN_UNIT_N:
            continue
        stars = star_acc[cid]
        star_total = sum(a.n for a in stars.values()) or 1
        units.append({
            "id": cid,
            "n": acc.n,
            "play_rate": round(acc.n / total, 4),
            "avg_placement": round(acc.avg, 2),
            "stars": {
                str(s): {"pct": round(a.n / star_total, 4), "avg": round(a.avg, 2)}
                for s, a in sorted(stars.items()) if a.n >= 10
            },
            "builds": sorted(
                [{"items": list(k), "n": a.n, "avg": round(a.avg, 2)}
                 for k, a in build_acc[cid].items() if a.n >= MIN_BUILD_N],
                key=lambda r: r["avg"],
            )[:TOP_BUILDS_PER_UNIT],
            "item_counts": [
                {"items": n_items, "pct": round(a.n / acc.n, 4), "avg": round(a.avg, 2)}
                for (c2, n_items), a in sorted(unit_itemcount_acc.items(), key=lambda kv: kv[0][1])
                if c2 == cid and a.n >= 10
            ],
        })
    units.sort(key=lambda u: -u["play_rate"])

    return {
        "boards": total,
        "avg_placement": round(statistics.mean(b["placement"] for b in boards), 2),
        "units": units[:TOP_UNITS],
        "carries": [
            {"id": cid, "share": round(n / total, 3)}
            for cid, n in carry_counter.most_common(TOP_CARRIES)
        ],
        "item_count_curve": [
            {"items": k, "n": a.n, "avg": round(a.avg, 2)}
            for k, a in sorted(itemcount_acc.items()) if a.n >= MIN_BUILD_N
        ],
        "level_curve": [
            {"level": k, "pct": round(a.n / total, 4), "avg": round(a.avg, 2)}
            for k, a in sorted(level_acc.items()) if a.n >= MIN_BUILD_N
        ],
        # The comp's full synergy list, not just its headline traits: a board
        # running 4 of one trait also quietly runs several 2-breakpoints, and
        # those are part of what the player is actually building toward.
        "traits": _trait_rows(trait_acc, total),
        "top_items": sorted(
            [{"id": k, "n": a.n, "avg": round(a.avg, 2),
              "pct": round(a.n / total, 4),
              "holders": sorted(
                  [{"id": c2, "n": h.n, "avg": round(h.avg, 2),
                    "share": round(h.n / a.n, 4)}
                   for (i2, c2), h in item_holder_acc.items()
                   if i2 == k and h.n >= MIN_BUILD_N],
                  key=lambda r: r["avg"])[:6]}
             for k, a in item_acc.items() if a.n >= MIN_UNIT_N],
            key=lambda r: -r["n"],
        )[:20],
        # Full placement histogram. An average hides shape: two comps both
        # averaging 4.2 play very differently if one is bimodal (wins or
        # bottom-fours) and the other clusters at 4th.
        "placements": [
            {"place": i, "pct": round(placements.get(i, 0) / total, 4),
             "n": placements.get(i, 0)}
            for i in range(1, 9)
        ],
    }


def build_comp_details(conn, published_comps: dict, resolver=None, **filters) -> dict:
    """Returns {slug: detail_document}. One document per published comp."""
    from aggregate import iter_participants

    by_comp: dict[str, list[dict]] = defaultdict(list)
    for p in iter_participants(conn, **filters):
        placement = p.get("placement")
        if not placement:
            continue
        sig = comp_signature(p)
        if sig not in published_comps:
            continue
        by_comp[sig].append({
            "placement": placement,
            "level": p.get("level", 0),
            "units": p.get("units", []),
            "traits": p.get("traits", []),
            "augments": [a for a in (p.get("augments") or []) if not is_legend_augment(a)],
        })

    def name_unit(cid: str) -> str:
        return resolver.champion(cid) if resolver else cid

    def name_item(iid: str) -> str:
        return resolver.item(iid) if resolver else iid

    def icon_unit(cid: str) -> str | None:
        return resolver.champion_portrait(cid) if resolver else None

    def icon_item(iid: str) -> str | None:
        return resolver.item_icon(iid) if resolver else None

    def decorate(d: dict) -> dict:
        for u in d.get("units", []):
            u["name"] = name_unit(u["id"])
            u["icon"] = icon_unit(u["id"])
            for b in u["builds"]:
                b["names"] = [name_item(i) for i in b["items"]]
                b["icons"] = [icon_item(i) for i in b["items"]]
        for c in d.get("carries", []):
            c["name"] = name_unit(c["id"])
            c["icon"] = icon_unit(c["id"])
        for it in d.get("top_items", []):
            it["name"] = name_item(it["id"])
            it["icon"] = icon_item(it["id"])
            for h in it.get("holders", []):
                h["name"] = name_unit(h["id"])
                h["icon"] = icon_unit(h["id"])
        for t in d.get("traits", []):
            t["display"] = resolver.trait(t["name"]) if resolver else t["name"]
        return d

    out = {}
    for sig, boards in by_comp.items():
        base = decorate(_detail_from(boards))
        if not base:
            continue

        # Augment-conditional cuts: how the build changes when you hold X.
        aug_counts = Counter(a for b in boards for a in b["augments"])
        conditional = {}
        for aug, n in aug_counts.items():
            if n < MIN_AUG_COND_N:
                continue
            subset = [b for b in boards if aug in b["augments"]]
            cd = _detail_from(subset)
            if not cd:
                continue
            cd = decorate(cd)
            # Only keep what differs from the base -- shipping a near-identical
            # copy per augment would multiply the payload for no information.
            base_carry = base["carries"][0]["id"] if base["carries"] else None
            cd_carry = cd["carries"][0]["id"] if cd["carries"] else None
            cd["carry_changed"] = bool(base_carry and cd_carry and base_carry != cd_carry)
            conditional[aug] = cd

        out[slug(sig)] = {
            "sig": sig,
            "name": published_comps[sig].get("name", sig),
            "base": base,
            "by_augment": conditional,
            "notes": {
                "no_positioning": "Board positions are not exposed by tft-match-v1, "
                                  "so this tool does not show a positioning map.",
                "no_timeline": "The API returns one end-of-game snapshot per player. "
                               "Level shown is where players finished, not when they "
                               "levelled.",
            },
        }
    return out
