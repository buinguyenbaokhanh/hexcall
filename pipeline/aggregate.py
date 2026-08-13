"""
Aggregation: raw match JSON -> comp / augment statistics.

This is the layer that produces everything the advisor UI consumes:
  * comp tier list        (avg placement, top-4 rate, play rate)
  * augment tier list     (avg placement, top-4 rate, play rate)
  * augment -> comp lift  (how much better a comp does WHEN you hold augment X)

The last one is the actual product. "Rich Get Richer has a 3.9 average placement"
is table stakes that every site shows. "Rich Get Richer played into Fast 9 comps
averages 3.4, but into reroll comps averages 4.6" is the recommendation signal,
and it falls straight out of a conditional aggregation.

POLICY CONSTRAINT (Riot TFT game policy):
    "Products cannot display win rates for Legends and Legend-based Augments.
     This applies to all websites, applications, and overlays."
LEGEND_AUGMENT_PREFIXES below filters these out of every public-facing stat.
Verify the ID patterns against the current tft-augments.json before shipping --
Riot's naming has changed between sets.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections import defaultdict, Counter
from dataclasses import dataclass, field, asdict

# Augment IDs matching these are excluded from all published stats.
LEGEND_AUGMENT_PREFIXES = ("TFT_Augment_Legend", "TFT9_Augment_Legend", "Legend_")

# A comp is only reported if it appears at least this many times -- below this,
# placement averages are noise. Raise it as your match volume grows.
#
# MIN_SAMPLES_COMP was 40, which let a 43-board comp top the ranking above one
# measured on 7,886 boards: at n=40 the standard error on a placement average
# is roughly +/-0.35, wide enough to invent a chart-topper out of variance.
# That's exactly the failure the confidence indicator exists to warn about, and
# a floor is a better fix than a warning nobody reads. 200 keeps the error near
# +/-0.15 -- small relative to the gaps the ranking is claiming to show.
MIN_SAMPLES_COMP = 200
MIN_SAMPLES_AUGMENT = 60
MIN_SAMPLES_PAIR = 25
MIN_SAMPLES_CHAMPION = 40

# Comps listed per champion on the champion page. Enough to show the real
# spread of where a unit gets played without turning into a second tier list.
TOP_COMPS_PER_CHAMPION = 4
TOP_HOLDERS_PER_ITEM = 8

MIN_SAMPLES_ITEM = 40
MIN_SAMPLES_TRAIT = 40
MIN_SAMPLES_SLOT = 40

# Head-to-head needs a floor of its own: two comps only meet in the subset of
# lobbies where both were played, which is far smaller than either comp's own
# sample.
MIN_SAMPLES_VERSUS = 30
TOP_COUNTERS_PER_COMP = 6

# Traits used to IDENTIFY a comp, versus traits kept for describing it. The
# signature uses the first; comp_shapes keeps SHAPE_TRAITS of them so the
# publisher can disambiguate two comps that resolve to the same display name.
SIGNATURE_TRAITS = 1
SHAPE_TRAITS = 3

# A standard TFT game offers three augments, at stages 2-1, 3-2 and 4-2.
# tft-match-v1 returns the `augments` array in PICK ORDER, so the index is the
# slot: 0 = the 2-1 pick, 1 = 3-2, 2 = 4-2. This is the basis for every
# per-slot statistic below. Anything past index 2 is a mode with extra
# augments (or a data anomaly) and is counted in the overall augment stats but
# not attributed to a slot.
AUGMENT_SLOTS = 3
SLOT_STAGES = {0: "2-1", 1: "3-2", 2: "4-2"}


# --------------------------------------------------------------------------
# Comp identification
# --------------------------------------------------------------------------

# Item classification for carry detection. A unit holding three defensive items
# is a tank, not a carry -- counting item slots alone splits one comp into two
# (e.g. "...:: Fiora" and "...:: Rell" for the same board shape), which
# fragments your samples and produces duplicate entries in the tier list.
DEFENSIVE_ITEM_HINTS = (
    "Warmog", "BrambleVest", "DragonsClaw", "Redemption", "GargoyleStoneplate",
    "SunfireCape", "Zephyr", "IonicSpark", "Shroud", "ProtectorsVow",
    "SteraksGage", "TitansResolve", "Evenshroud", "CrownguardTFT_Item_",
)
OFFENSIVE_ITEM_HINTS = (
    "InfinityEdge", "Deathblade", "GuinsoosRageblade", "LastWhisper",
    "JeweledGauntlet", "BlueBuff", "GiantSlayer", "Bloodthirster",
    "SpearOfShojin", "HextechGunblade", "RabadonsDeathcap", "ArchangelsStaff",
    "RunaansHurricane", "StatikkShiv", "Morellonomicon", "NashorsTooth",
)


def _item_weight(item_id: str) -> float:
    if any(h in item_id for h in OFFENSIVE_ITEM_HINTS):
        return 1.0
    if any(h in item_id for h in DEFENSIVE_ITEM_HINTS):
        return 0.15
    return 0.5  # unknown or utility -- counts, but not as strongly


def carry_unit(units: list[dict]) -> str | None:
    """The unit most likely being played as the carry.

    Scores by offensive item weight rather than raw slot count, then breaks ties
    on unit cost and star level. Still a heuristic -- a Titan's Resolve bruiser
    carry will read as a tank -- but far better than counting slots.
    """
    if not units:
        return None

    def score(u: dict) -> tuple:
        items = u.get("itemNames") or []
        return (sum(_item_weight(i) for i in items),
                u.get("rarity", 0),
                u.get("tier", 1))

    best = max(units, key=score)
    items = best.get("itemNames") or []
    if len(items) >= 2 and sum(_item_weight(i) for i in items) >= 1.2:
        return best.get("character_id")

    # No confident itemised carry (early elimination, or items on a tank). Fall
    # back to the most expensive high-star unit so the board still clusters with
    # its comp. Returning None here instead would create a separate "no carry"
    # bucket for every trait signature, splitting one comp into two entries.
    fallback = max(units, key=lambda u: (u.get("rarity", 0), u.get("tier", 1)))
    return fallback.get("character_id")


def comp_parts(participant: dict, top_n_traits: int = 3) -> tuple[list[tuple[str, int]], str | None]:
    """The structured pieces behind a comp signature: [(trait_id, units)], carry.

    Returned separately because the signature string cannot be parsed back
    apart: live trait ids contain underscores themselves
    ("TFT17_DRX5_TFT17_MeleeTrait2 :: TFT17_Vex"), so splitting on "_" gives
    nonsense. Anything that needs the components -- display names above all --
    has to take them from here rather than from the joined string.
    """
    traits = [t for t in participant.get("traits", []) if t.get("tier_current", 0) > 0]
    traits.sort(key=lambda t: (t.get("tier_current", 0), t.get("num_units", 0)),
                reverse=True)
    parts = [(t["name"], t.get("num_units", 0)) for t in traits[:top_n_traits]]
    return parts, carry_unit(participant.get("units", []))


def comp_signature(participant: dict, top_n_traits: int = SIGNATURE_TRAITS) -> str:
    """Cluster a board into a named comp.

    Signature = the strongest active trait (by breakpoint tier reached, then by
    unit count) plus the carry, producing labels like
        'TFT17_Stargazer :: TFT17_Xayah'
    which publish.py turns into "4 Stargazer Xayah", taking the breakpoint from
    the shape rather than the signature.

    The unit count is deliberately NOT in the signature either. A deck that
    runs 3 of its trait early and 5 late is one comp, and baking the count in
    split it by depth on top of the permutation problem -- dropping it took
    live signatures from 338 to 233 while raising the largest sample.

    Only ONE trait, deliberately. Using the top three splits a single real comp
    across every incidental trait permutation its flex slots happen to hit:
        TFT17_DRX5_TFT17_ASTrait2_TFT17_HPTank2   :: TFT17_Kindred
        TFT17_DRX5_TFT17_HPTank2_TFT17_MeleeTrait2 :: TFT17_Kindred
    are the same deck under two labels. On live data that produced 827 distinct
    signatures from 1,648 boards, the largest holding 64 -- so no comp ever
    cleared the sample floor no matter how much was crawled, because the labels
    fragment as fast as the data grows. One trait plus the carry is also how
    comps are named in practice ("Conduit Miss Fortune").

    The cost is real: two genuinely different builds around the same carry now
    share a row. comp_shapes still carries the next traits, so the publisher
    can tell near-collisions apart in the display name.
    """
    trait_parts, carry = comp_parts(participant, top_n_traits)
    parts = [name for name, _units in trait_parts]
    sig = "_".join(parts) if parts else "NoTraits"
    return f"{sig} :: {carry}" if carry else sig


def is_legend_augment(aug_id: str) -> bool:
    return any(aug_id.startswith(p) for p in LEGEND_AUGMENT_PREFIXES)


# --------------------------------------------------------------------------
# Accumulator
# --------------------------------------------------------------------------

@dataclass
class Stat:
    n: int = 0
    placement_sum: int = 0
    top4: int = 0
    first: int = 0
    _sq: float = 0.0

    def add(self, placement: int) -> None:
        self.n += 1
        self.placement_sum += placement
        self._sq += placement * placement
        if placement <= 4:
            self.top4 += 1
        if placement == 1:
            self.first += 1

    @property
    def avg(self) -> float:
        return self.placement_sum / self.n if self.n else 0.0

    @property
    def top4_rate(self) -> float:
        return self.top4 / self.n if self.n else 0.0

    @property
    def win_rate(self) -> float:
        return self.first / self.n if self.n else 0.0

    @property
    def stderr(self) -> float:
        """Standard error of the mean placement. Use this to build confidence
        intervals -- a comp at 3.9 +/- 0.4 is not meaningfully better than one
        at 4.1, and showing a ranked list without this is how stats sites
        mislead people."""
        if self.n < 2:
            return float("nan")
        var = (self._sq - self.placement_sum ** 2 / self.n) / (self.n - 1)
        return math.sqrt(max(var, 0.0) / self.n)

    def to_dict(self) -> dict:
        return {
            "n": self.n,
            "avg_placement": round(self.avg, 3),
            "top4_rate": round(self.top4_rate, 4),
            "win_rate": round(self.win_rate, 4),
            "stderr": round(self.stderr, 3) if self.n >= 2 else None,
        }


def puuids_for_tiers(conn: sqlite3.Connection, tiers: list[str] | None,
                     platform: str | None = None) -> set[str] | None:
    """PUUIDs from the ladder crawl matching the given tiers.

    Returns None when no tier filter is requested, which callers treat as
    'no filtering' -- distinct from an empty set, which means 'filter matched
    nobody' and should legitimately produce zero results.
    """
    if not tiers:
        return None
    q = f"SELECT puuid FROM players WHERE tier IN ({','.join('?' * len(tiers))})"
    params: list = [t.upper() for t in tiers]
    if platform:
        q += " AND platform = ?"
        params.append(platform)
    return {r[0] for r in conn.execute(q, params)}


def iter_participants(conn: sqlite3.Connection, game_version_like: str | None = None,
                      tft_set: int | None = None, queue_id: int | None = 1100,
                      platform: str | None = None,
                      puuid_filter: set[str] | None = None):
    """queue_id 1100 = Ranked TFT. Filtering to ranked keeps normals/hyper roll
    from polluting your placement distributions.

    puuid_filter restricts to specific players (used for rank slices). Note this
    filters PARTICIPANTS, not matches -- a Challenger match contains seven other
    players who may be Master or GM, and counting their boards would silently
    contaminate a 'Challenger only' slice.
    """
    sql = "SELECT raw FROM matches WHERE 1=1"
    params: list = []
    if game_version_like:
        sql += " AND game_version LIKE ?"
        params.append(game_version_like)
    if tft_set is not None:
        sql += " AND tft_set = ?"
        params.append(tft_set)
    if platform:
        sql += " AND platform = ?"
        params.append(platform)
    for lobby in _iter_lobbies_sql(conn, sql, params, queue_id, puuid_filter):
        yield from lobby


def _iter_lobbies_sql(conn, sql, params, queue_id, puuid_filter):
    for (raw,) in conn.execute(sql, params):
        m = json.loads(raw)
        info = m.get("info", {})
        if queue_id is not None and info.get("queue_id") not in (queue_id, None):
            continue
        lobby = [p for p in info.get("participants", [])
                 if puuid_filter is None or p.get("puuid") in puuid_filter]
        if lobby:
            yield lobby


def iter_lobbies(conn: sqlite3.Connection, game_version_like: str | None = None,
                 tft_set: int | None = None, queue_id: int | None = 1100,
                 platform: str | None = None, puuid_filter: set[str] | None = None):
    """Same filtering as iter_participants, but yields each match's participants
    together.

    Grouping matters for anything comparative: "which comp beats which" can
    only be answered by looking at boards that actually shared a lobby, and a
    flat participant stream has thrown that away.
    """
    sql = "SELECT raw FROM matches WHERE 1=1"
    params: list = []
    if game_version_like:
        sql += " AND game_version LIKE ?"
        params.append(game_version_like)
    if tft_set is not None:
        sql += " AND tft_set = ?"
        params.append(tft_set)
    if platform:
        sql += " AND platform = ?"
        params.append(platform)
    yield from _iter_lobbies_sql(conn, sql, params, queue_id, puuid_filter)


def build_stats(conn: sqlite3.Connection, **filters) -> dict:
    comp_stats: dict[str, Stat] = defaultdict(Stat)
    aug_stats: dict[str, Stat] = defaultdict(Stat)
    pair_stats: dict[tuple[str, str], Stat] = defaultdict(Stat)
    unit_items: dict[str, dict[str, Stat]] = defaultdict(lambda: defaultdict(Stat))
    champ_stats: dict[str, Stat] = defaultdict(Stat)
    champ_comp_stats: dict[tuple[str, str], Stat] = defaultdict(Stat)
    aug_slot_stats: dict[tuple[str, int], Stat] = defaultdict(Stat)
    slot_pair_stats: dict[tuple[str, int, str], Stat] = defaultdict(Stat)
    item_stats: dict[str, Stat] = defaultdict(Stat)
    item_holder_stats: dict[tuple[str, str], Stat] = defaultdict(Stat)
    trait_stats: dict[tuple[str, int], Stat] = defaultdict(Stat)
    comp_shapes: dict[str, dict] = {}
    comp_breakpoints: dict[str, Counter] = defaultdict(Counter)
    versus: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    contested: dict[str, Counter] = defaultdict(Counter)
    total = 0

    for lobby in iter_lobbies(conn, **filters):
      # Signatures for the whole lobby first, so head-to-head can be recorded
      # between boards that actually played each other.
      seats = []
      for p in lobby:
          if p.get("placement"):
              seats.append((comp_signature(p), p["placement"]))
      # How many OTHER boards in this lobby ran the same comp -- the honest
      # measure of "contested", and only visible because we kept the lobby
      # grouping. A comp that averages well but is usually contested by two
      # others is a different proposition from one you get to yourself.
      lobby_counts = Counter(sig for sig, _ in seats)
      for sig, _ in seats:
          contested[sig][lobby_counts[sig] - 1] += 1

      for i, (sig_a, place_a) in enumerate(seats):
          for sig_b, place_b in seats[i + 1:]:
              if sig_a == sig_b or place_a == place_b:
                  continue
              key = (sig_a, sig_b) if sig_a < sig_b else (sig_b, sig_a)
              first_wins = (place_a < place_b) if sig_a < sig_b else (place_b < place_a)
              versus[key][0 if first_wins else 1] += 1

      for p in lobby:
        placement = p.get("placement")
        if not placement:
            continue
        total += 1
        # Shape keeps several traits for naming; the signature uses only the
        # first, so incidental flex traits don't split one comp into many.
        trait_parts, carry = comp_parts(p, SHAPE_TRAITS)
        sig = "_".join(n for n, _ in trait_parts[:SIGNATURE_TRAITS]) or "NoTraits"
        if carry:
            sig = f"{sig} :: {carry}"
        # Kept so the publisher can build a readable name without trying to
        # parse the signature back apart. The breakpoint shown in that name is
        # the MODAL one across the comp's boards, not whichever board happened
        # to be seen first -- the signature no longer carries a count, so
        # without this the displayed "5 Space Groove" would be arbitrary.
        comp_shapes.setdefault(sig, {"traits": trait_parts, "carry": carry})
        if trait_parts:
            comp_breakpoints[sig][trait_parts[0][1]] += 1
        comp_stats[sig].add(placement)

        # Slot is the index in the ORIGINAL array -- Legend augments have to be
        # skipped in place rather than filtered out first, because compacting
        # the list would shift every later augment into the wrong slot and
        # silently mislabel 3rd picks as 2nd.
        raw_augs = p.get("augments") or []
        for slot, a in enumerate(raw_augs):
            if is_legend_augment(a):
                continue
            aug_stats[a].add(placement)
            pair_stats[(a, sig)].add(placement)
            if slot < AUGMENT_SLOTS:
                aug_slot_stats[(a, slot)].add(placement)
                slot_pair_stats[(a, slot, sig)].add(placement)

        # A champion counts once per board even in the rare case it appears as
        # two entries, so play_rate stays "share of boards fielding this unit"
        # rather than drifting above the number of boards.
        seen_units: set[str] = set()
        seen_items: set[str] = set()
        for u in p.get("units", []):
            cid = u.get("character_id")
            if not cid:
                continue
            if cid not in seen_units:
                champ_stats[cid].add(placement)
                champ_comp_stats[(cid, sig)].add(placement)
                seen_units.add(cid)
            unit_item_list = u.get("itemNames") or []
            for it in unit_item_list:
                # Same once-per-board rule as champions, so an item equipped on
                # two units doesn't inflate its own play rate.
                if it not in seen_items:
                    item_stats[it].add(placement)
                    seen_items.add(it)
                item_holder_stats[(it, cid)].add(placement)
            items = tuple(sorted(unit_item_list))
            if len(items) >= 2:
                unit_items[cid]["+".join(items)].add(placement)

        for t in p.get("traits", []):
            name, units = t.get("name"), t.get("num_units", 0)
            if name and t.get("tier_current", 0) > 0 and units:
                trait_stats[(name, units)].add(placement)

    baseline = sum(s.placement_sum for s in comp_stats.values()) / max(total, 1)

    comps = {
        sig: {**s.to_dict(), "play_rate": round(s.n / max(total, 1), 4)}
        for sig, s in comp_stats.items() if s.n >= MIN_SAMPLES_COMP
    }
    augments = {
        a: {**s.to_dict(), "play_rate": round(s.n / max(total, 1), 4)}
        for a, s in aug_stats.items() if s.n >= MIN_SAMPLES_AUGMENT
    }

    # The recommendation signal: how much a comp improves when you hold an augment.
    # Negative lift = better, because lower placement is better in TFT.
    pairs = []
    for (aug, sig), s in pair_stats.items():
        if s.n < MIN_SAMPLES_PAIR or sig not in comps:
            continue
        comp_avg = comps[sig]["avg_placement"]
        pairs.append({
            "augment": aug,
            "comp": sig,
            **s.to_dict(),
            "lift_vs_comp": round(s.avg - comp_avg, 3),
            "lift_vs_field": round(s.avg - baseline, 3),
        })
    pairs.sort(key=lambda r: r["lift_vs_comp"])

    items = {
        cid: sorted(
            [{"items": k.split("+"), **st.to_dict()} for k, st in builds.items() if st.n >= MIN_SAMPLES_PAIR],
            key=lambda r: r["avg_placement"],
        )[:10]
        for cid, builds in unit_items.items()
    }

    # Global per-champion placement, independent of comp or build -- "how good
    # is this unit on average, across every comp it shows up in." Distinct
    # from unit_items (which only covers boards with 2+ items on the unit):
    # this counts every appearance, so a support that's rarely itemised still
    # gets a real sample instead of being invisible.
    champions = {
        cid: {**s.to_dict(), "play_rate": round(s.n / max(total, 1), 4)}
        for cid, s in champ_stats.items() if s.n >= MIN_SAMPLES_CHAMPION
    }

    # "Which comps do I actually play this unit in" -- the question a champion
    # page has to answer, and the one thing a per-champion average can't. A
    # unit sitting at 4.2 overall may be excellent in one comp and filler in
    # three others; `share` is the fraction of that champion's boards in each.
    champion_comps: dict[str, list[dict]] = defaultdict(list)
    for (cid, sig), s in champ_comp_stats.items():
        if s.n < MIN_SAMPLES_PAIR or sig not in comps or cid not in champions:
            continue
        champion_comps[cid].append({
            "comp": sig,
            **s.to_dict(),
            "share": round(s.n / champions[cid]["n"], 4),
        })
    for rows in champion_comps.values():
        rows.sort(key=lambda r: -r["n"])
        del rows[TOP_COMPS_PER_CHAMPION:]

    # Per-slot augment performance. The same augment is a different decision
    # depending on when it's offered -- an econ augment taken at 2-1 has six
    # more rounds to compound than the same augment taken at 4-2 -- and the
    # slot is recoverable because Riot returns `augments` in pick order.
    augment_slots = {}
    for (aug, slot), s in aug_slot_stats.items():
        if s.n < MIN_SAMPLES_SLOT:
            continue
        augment_slots.setdefault(aug, {})[str(slot)] = {
            **s.to_dict(),
            "play_rate": round(s.n / max(total, 1), 4),
        }

    # Comp lift conditioned on WHICH slot the augment came in. This is what
    # lets the advisor answer "I took this at 2-1, what do I build" separately
    # from "I was offered it at 4-2, is it worth pivoting for".
    slot_pairs = []
    for (aug, slot, sig), s in slot_pair_stats.items():
        if s.n < MIN_SAMPLES_PAIR or sig not in comps:
            continue
        slot_pairs.append({
            "augment": aug, "slot": slot, "comp": sig,
            **s.to_dict(),
            "lift_vs_comp": round(s.avg - comps[sig]["avg_placement"], 3),
        })
    slot_pairs.sort(key=lambda r: r["lift_vs_comp"])

    item_rows = {
        iid: {**s.to_dict(), "play_rate": round(s.n / max(total, 1), 4)}
        for iid, s in item_stats.items() if s.n >= MIN_SAMPLES_ITEM
    }

    # Which champions actually perform with each item -- the "who should hold
    # this" question, which the per-champion view can't answer in reverse.
    item_holders: dict[str, list[dict]] = defaultdict(list)
    for (iid, cid), s in item_holder_stats.items():
        if s.n < MIN_SAMPLES_PAIR or iid not in item_rows:
            continue
        item_holders[iid].append({"champion": cid, **s.to_dict(),
                                  "share": round(s.n / item_rows[iid]["n"], 4)})
    for rows in item_holders.values():
        rows.sort(key=lambda r: r["avg_placement"])
        del rows[TOP_HOLDERS_PER_ITEM:]

    # Trait performance per breakpoint: 4 of a trait and 6 of it are different
    # decisions, and averaging them together hides which one is worth playing.
    traits: dict[str, list[dict]] = defaultdict(list)
    for (name, units), s in trait_stats.items():
        if s.n < MIN_SAMPLES_TRAIT:
            continue
        traits[name].append({"units": units, **s.to_dict(),
                             "play_rate": round(s.n / max(total, 1), 4)})
    for rows in traits.values():
        rows.sort(key=lambda r: r["units"])

    # Head-to-head: of the lobbies where both comps were present, how often did
    # each finish ahead. This is the one comparative statistic the match API
    # genuinely supports -- placements within a shared lobby are directly
    # comparable in a way two independent averages are not, because both boards
    # faced the same eight players.
    counters: dict[str, list[dict]] = defaultdict(list)
    for (sig_a, sig_b), (wins_a, wins_b) in versus.items():
        games = wins_a + wins_b
        if games < MIN_SAMPLES_VERSUS or sig_a not in comps or sig_b not in comps:
            continue
        counters[sig_a].append({"comp": sig_b, "games": games,
                                "win_rate": round(wins_a / games, 4)})
        counters[sig_b].append({"comp": sig_a, "games": games,
                                "win_rate": round(wins_b / games, 4)})
    for rows in counters.values():
        rows.sort(key=lambda r: r["win_rate"])
        del rows[TOP_COUNTERS_PER_COMP:]

    return {
        "sample_size": total,
        "baseline_placement": round(baseline, 3),
        "comps": comps,
        "augments": augments,
        "augment_comp_pairs": pairs,
        "augment_slots": augment_slots,
        "augment_slot_pairs": slot_pairs,
        "unit_items": {k: v for k, v in items.items() if v},
        "champions": champions,
        "champion_comps": dict(champion_comps),
        "comp_shapes": {sig: _with_modal_breakpoint(comp_shapes[sig], comp_breakpoints[sig])
                        for sig in comps},
        "comp_versus": counters,
        "comp_contested": {
            sig: [{"others": k, "pct": round(v / sum(c.values()), 4)}
                  for k, v in sorted(c.items())]
            for sig, c in contested.items() if sig in comps
        },
        "items": item_rows,
        "item_holders": dict(item_holders),
        "traits": dict(traits),
    }


def export(conn: sqlite3.Connection, out_path: str = "stats.json", **filters) -> dict:
    stats = build_stats(conn, **filters)
    with open(out_path, "w") as f:
        json.dump(stats, f, indent=2)
    return stats


if __name__ == "__main__":
    import argparse, logging
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="tft.db")
    ap.add_argument("--out", default="stats.json")
    ap.add_argument("--patch", help="e.g. 'Version 17.8%%' to filter game_version")
    ap.add_argument("--set", type=int, dest="tft_set")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    conn = sqlite3.connect(args.db)
    s = export(conn, args.out, game_version_like=args.patch, tft_set=args.tft_set)
    print(f"{s['sample_size']} participants -> {len(s['comps'])} comps, "
          f"{len(s['augments'])} augments, {len(s['augment_comp_pairs'])} pairs, "
          f"{len(s['champions'])} champions")


def _with_modal_breakpoint(shape: dict, counts) -> dict:
    """Replace the headline trait's unit count with the comp's modal one."""
    traits = list(shape.get("traits") or [])
    if traits and counts:
        name, _ = traits[0]
        traits[0] = (name, counts.most_common(1)[0][0])
    return {**shape, "traits": traits}
