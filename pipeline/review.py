"""
Personal match review -- find the mistakes you repeat.

This is post-game analysis, which Riot's TFT policy explicitly encourages:
"Products that help players improve their skills over time are encouraged.
Pre-game best practices or post-game analysis are great spaces for this."

It looks at YOUR last N ranked games and compares them against the aggregate
statistics the pipeline already publishes, to surface leaks you can't see from
a single game. Most players lose LP to the same two or three mistakes over and
over and have no idea which ones.

WHAT match-v1 ACTUALLY GIVES YOU
--------------------------------
An end-of-game snapshot per participant: placement, level, last_round,
gold_left, augments, traits, units, items, players_eliminated,
total_damage_to_players. There is NO round-by-round history -- overlays that
show your HP curve get it from the game client, not this API. So every leak
below is derived from end-state data plus lobby comparison, which is honest
about what's measurable rather than inventing a narrative.

THE LEAKS
---------
1. Augment fit       -- did you take augments that suit the comp you played?
                        Uses the augment->comp lift table. This is the one the
                        big sites don't really do.
2. Gold hoarding     -- gold left when you were eliminated.
3. Level tempo       -- your level vs. lobby peers who reached the same round.
4. Comp flexibility  -- are you forcing one comp regardless of what you're given?
5. Comp skill gap    -- which comps do you underperform the field in?
6. Exit timing       -- where your bottom-4 games actually end.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from aggregate import comp_signature, is_legend_augment

log = logging.getLogger("review")

# Thresholds. These are judgement calls, not physics -- tune them once you've
# looked at your own data. Each is stated in the output so the user can argue.
GOLD_HOARD_THRESHOLD = 25       # gold left at elimination
LEVEL_BEHIND_THRESHOLD = 0.4    # levels behind lobby peers at same round
FORCE_RATE_THRESHOLD = 0.45     # share of games in one comp
MIN_GAMES_FOR_COMP_VERDICT = 4
MIN_GAMES = 10                  # below this, say so rather than guess


RANKED_QUEUE = 1100

# Queue ids seen in the wild. Riot publishes no queue catalogue through the TFT
# API, and new limited-time modes appear with ids nothing documents -- one real
# account's history held 6100 and 6120, which match no published list. So this
# is a display-name table only, and anything missing falls back to the
# `tft_game_type` the match itself carries rather than rendering as a bare
# number.
QUEUE_NAMES = {
    1090: "Normal",
    1100: "Ranked",
    1110: "Tutorial",
    1130: "Hyper Roll",
    1150: "Double Up",
    1160: "Double Up",
    1210: "Choncc's Treasure",
    1220: "Tacticians Trials",
}

GAME_TYPE_NAMES = {
    "standard": "Standard", "pairs": "Double Up",
    "turbo": "Hyper Roll", "pve": "PvE", "tutorial": "Tutorial",
}

# Queues the published statistics can be compared against.
#
# aggregate.py builds every slice from queue 1100 only, so "vs. the field" is a
# ranked claim and nothing else. Leaks that compare you against your OWN lobby
# -- level, board value, upgrades -- stay valid in any 8-player standard queue,
# because the comparison population is in the match. Double Up is excluded from
# both: it is played in pairs, so a "lobby peer" is not an opponent playing the
# same game you are.
FIELD_COMPARABLE = {1100}

# Lobby comparison is decided by the GAME TYPE, not by a queue id allowlist.
# Any `standard` mode is eight solo players on a 1-8 placement scale, so "how
# did my board compare with the players who went out when I did" means the same
# thing in all of them -- including limited-time modes whose ids nothing
# documents. An id list would silently deny those the checks they can support,
# which is exactly what happened to queues 6100 and 6120.
LOBBY_COMPARABLE_TYPES = {"standard", None}


def queue_label(queue_id, game_type=None) -> str:
    """Display name for a queue, falling back to its game type."""
    if queue_id in QUEUE_NAMES:
        return QUEUE_NAMES[queue_id]
    if game_type in GAME_TYPE_NAMES:
        return f"{GAME_TYPE_NAMES[game_type]} ({queue_id})"
    return f"Queue {queue_id}"

# How many recent matches to look through to find `count` ranked ones.
#
# match-v1 can't filter by queue, so the only way to know a match is ranked is
# to fetch it. Asking for exactly `count` ids and discarding the rest is what
# this used to do, and for anyone who mixes queues it silently produced a tiny
# sample -- a real account here returned 2 ranked games out of 20 fetched,
# because only 27% of its recent matches were ranked (the rest Double Up,
# Choncc's Treasure, normals). Over-fetching and stopping early costs nothing
# for a ranked-only player and rescues the feature for everyone else.
DEFAULT_LOOKBACK = 100


def fetch_history(client, platform: str, game_name: str, tag_line: str,
                  count: int = 20, lookback: int = DEFAULT_LOOKBACK,
                  queue: int | None = RANKED_QUEUE) -> tuple[str, list[dict]]:
    """Resolve a Riot ID and pull their recent matches.

    Returns EVERY match fetched, not just the target queue. match-v1 can't
    filter by queue, so a match's queue is only knowable by fetching it -- which
    means the other queues have already been paid for by the time they're
    identified, and discarding them would throw away the whole queue breakdown
    for nothing. `queue` only decides when to stop early.

    The region is derived here rather than passed in: account-v1 and match-v1
    use different cluster sets, and every caller that passed one region for both
    silently broke SEA lookups. `platform` is the only thing a caller actually
    knows, so it's the only thing this asks for.
    """
    from riot_client import account_region
    region = account_region(platform)
    acct = client.account_by_riot_id(region, game_name, tag_line)
    if not acct:
        raise RuntimeError(f"No account found for {game_name}#{tag_line} in {region}")
    puuid = acct["puuid"]

    ids = client.match_ids(platform, puuid, count=max(count, lookback)) or []
    matches, hits, examined = [], 0, 0
    for mid in ids:
        m = client.match(platform, mid)
        if not m:
            continue
        examined += 1
        matches.append(m)
        # `None` keeps the synthetic fixtures in test_pipeline.py working, which
        # carry no queue_id.
        q = m.get("info", {}).get("queue_id")
        if queue is None or q in (queue, None):
            hits += 1
            if hits >= count:
                break
    log.info("%d matches examined, %d in the target queue", examined, hits)
    return puuid, matches


# Cross-set name and art resolution, built once and reused.
#
# The published slice only names the CURRENT set, because that is all a tier
# list needs. A player's history is not so tidy: twenty ranked games reach back
# months, and a Set 15 unit resolves to nothing, so its name falls through to
# the raw id and the portrait falls back to the id's first letter -- rendering
# a whole board as "T" for TFT15_*. On a real account 168 of 437 units came
# back that way.
#
# NameResolver already handles this: champion_portrait() drops to the plain LoL
# champion square for ids Data Dragon has no TFT art for, which is the same
# character and always available. It was simply unreachable from here.
_RESOLVER: object | None = None
_RESOLVER_TRIED = False


def _resolver():
    """The shared NameResolver, or None if Data Dragon is unreachable.

    Built on first use rather than at import: the server should start without
    the network, and a review degrades to prettified ids rather than failing.
    """
    global _RESOLVER, _RESOLVER_TRIED
    if not _RESOLVER_TRIED:
        _RESOLVER_TRIED = True
        try:
            from static_data import load_all, NameResolver
            _RESOLVER = NameResolver(load_all())
        except Exception as e:  # noqa: BLE001
            log.warning("Data Dragon unavailable (%s); older-set units will show "
                        "prettified ids without art", e)
            _RESOLVER = None
    return _RESOLVER


def champion_name(cid: str, stats: dict) -> str:
    """Display name for a champion id from any set."""
    named = (stats.get("champion_names") or {}).get(cid)
    if named:
        return named
    r = _resolver()
    if r:
        try:
            return r.champion(cid)
        except Exception:  # noqa: BLE001
            pass
    from static_data import prettify_id
    return prettify_id(cid)


def champion_icon(cid: str, stats: dict) -> str | None:
    """Portrait for a champion id from any set, or None if there is genuinely
    no art -- summons and minions have none in any source."""
    icon = (stats.get("champion_icons") or {}).get(cid)
    if icon:
        return icon
    r = _resolver()
    if r:
        try:
            return r.champion_portrait(cid)
        except Exception:  # noqa: BLE001
            pass
    return None


def comp_label(sig: str, stats: dict) -> str:
    """A readable name for a comp signature.

    stats["comp_names"] only covers comps that cleared the publish sample
    floor, and a player's own games routinely land outside it -- an off-meta
    board is exactly the kind a tier list won't have. Falling through to the
    raw signature put "TFT17_ShieldTank :: TFT17_AurelionSol" in front of the
    user, so unnamed comps get assembled from the same trait and carry the
    signature already carries.
    """
    named = (stats.get("comp_names") or {}).get(sig)
    if named:
        return named
    traits, _, carry = sig.partition(" :: ")
    try:
        from static_data import prettify_id
    except Exception:  # noqa: BLE001
        prettify_id = lambda x: x  # noqa: E731
    trait_names = stats.get("trait_names") or {}
    champion_names = stats.get("champion_names") or {}
    parts = [trait_names.get(t) or prettify_id(t) for t in traits.split("_") if t] if traits else []
    # The signature joins trait ids with "_", but the ids contain underscores
    # themselves ("TFT17_ShieldTank"), so a split can't recover them reliably.
    # When the whole string resolves as one id, that's the trait; otherwise
    # fall back to prettifying the lot.
    whole = trait_names.get(traits)
    label = whole or (prettify_id(traits) if len(parts) > 1 else (parts[0] if parts else ""))
    if carry:
        label = f"{label} {champion_names.get(carry) or prettify_id(carry)}".strip()
    return label or sig


def _me(match: dict, puuid: str) -> dict | None:
    for p in match.get("info", {}).get("participants", []):
        if p.get("puuid") == puuid:
            return p
    return None


# --- individual leak detectors -------------------------------------------

def leak_augment_fit(games: list[dict], stats: dict) -> dict | None:
    """Did your augments suit the comp you actually played?

    For each game: sum the measured lift of your augments in the comp you ended
    on, and compare against the best available alternative you could have taken
    from that same choice set. We can't see the choices you declined -- the API
    doesn't record them -- so this measures fit, not decision quality, and the
    output says so.
    """
    pair = {(p["augment"], p["comp"]): p for p in stats["augment_comp_pairs"]}
    rows, total_lift, measured = [], 0.0, 0

    for g in games:
        sig = g["sig"]
        per_aug = []
        for a in g["augments"]:
            rec = pair.get((a, sig))
            if rec:
                per_aug.append({
                    "augment": a,
                    "name": stats["augment_names"].get(a, a),
                    "lift": rec["lift_vs_comp"],
                    "n": rec["n"],
                })
        if not per_aug:
            continue
        game_lift = sum(x["lift"] for x in per_aug)
        total_lift += game_lift
        measured += 1
        worst = min(per_aug, key=lambda x: -x["lift"])
        if worst["lift"] > 0.25:
            rows.append({
                "comp": comp_label(sig, stats),
                "augment": worst["name"],
                "lift": round(worst["lift"], 2),
                "placement": g["placement"],
            })

    if measured < 3:
        return None

    avg = total_lift / measured
    rows.sort(key=lambda r: -r["lift"])
    return {
        "id": "augment_fit",
        "title": "Augment fit with your comp",
        "severity": "high" if avg > 0.25 else "medium" if avg > 0.1 else "ok",
        "metric": f"{avg:+.2f} avg placement from augment/comp fit",
        "detail": (
            "Positive means your augments historically make the comp you played "
            "perform worse than its baseline. Negative means they suit it."
            if avg > 0 else
            "Your augments generally suit the comps you commit to."
        ),
        "examples": rows[:4],
        "caveat": "Measures fit only. The API doesn't record the augments you declined, "
                  "so this can't tell you whether a better option was on offer.",
    }


def leak_gold_hoarding(games: list[dict]) -> dict | None:
    golds = [g["gold_left"] for g in games if g["gold_left"] is not None]
    if len(golds) < MIN_GAMES // 2:
        return None
    avg = statistics.mean(golds)
    bad = [g for g in games
           if (g["gold_left"] or 0) >= GOLD_HOARD_THRESHOLD and g["placement"] >= 5]
    return {
        "id": "gold_hoarding",
        "title": "Gold left when eliminated",
        "severity": "high" if avg >= GOLD_HOARD_THRESHOLD else "medium" if avg >= 15 else "ok",
        "metric": f"{avg:.0f} gold on average",
        "detail": (
            f"You died holding {GOLD_HOARD_THRESHOLD}+ gold in {len(bad)} of your "
            f"bottom-4 games. Gold banked at elimination is gold that never became "
            f"board strength."
            if bad else
            "You're generally spending down before you die."
        ),
        "examples": [{"placement": g["placement"], "gold": g["gold_left"],
                      "round": g["last_round"]} for g in bad[:4]],
    }


def leak_level_tempo(games: list[dict]) -> dict | None:
    """Your level vs. lobby peers who survived to the same round."""
    diffs = []
    for g in games:
        peers = [p for p in g["lobby"]
                 if abs((p.get("last_round") or 0) - (g["last_round"] or 0)) <= 1
                 and p.get("puuid") != g["puuid"]]
        if len(peers) >= 2:
            diffs.append(g["level"] - statistics.mean(p["level"] for p in peers))
    if len(diffs) < MIN_GAMES // 2:
        return None
    avg = statistics.mean(diffs)
    behind = avg < -LEVEL_BEHIND_THRESHOLD
    ahead = avg > LEVEL_BEHIND_THRESHOLD
    return {
        "id": "level_tempo",
        "title": "Level relative to your lobby",
        "severity": "medium" if (behind or ahead) else "ok",
        "metric": f"{avg:+.2f} levels vs. peers at the same round",
        "detail": (
            "You're consistently behind the lobby on level. That usually means "
            "over-saving or rolling too early, and it costs you board slots at "
            "the moment fights get decided."
            if behind else
            "You're leveling ahead of your lobby. That's fine with a strong econ "
            "start, but it's how boards end up weak and uncontested at 8."
            if ahead else
            "Your leveling tracks the lobby."
        ),
    }


def leak_comp_flexibility(games: list[dict], stats: dict) -> dict | None:
    if len(games) < MIN_GAMES:
        return None
    counts = Counter(g["sig"] for g in games)
    top_sig, top_n = counts.most_common(1)[0]
    rate = top_n / len(games)
    # Shannon entropy normalised by the max for this many games.
    total = sum(counts.values())
    ent = -sum((c / total) * math.log2(c / total) for c in counts.values())
    max_ent = math.log2(len(counts)) if len(counts) > 1 else 1
    return {
        "id": "comp_flexibility",
        "title": "Comp flexibility",
        "severity": "high" if rate > 0.6 else "medium" if rate > FORCE_RATE_THRESHOLD else "ok",
        "metric": f"{len(counts)} distinct comps in {len(games)} games",
        "detail": (
            f"You played {comp_label(top_sig, stats)} in "
            f"{top_n} of {len(games)} games ({rate*100:.0f}%). Forcing one line "
            f"caps you at how often the lobby lets you have it."
            if rate > FORCE_RATE_THRESHOLD else
            "You're playing what the game gives you rather than forcing one line."
        ),
        "diversity_score": round(ent / max_ent, 2) if max_ent else 0,
    }


def leak_comp_skill_gap(games: list[dict], stats: dict) -> dict | None:
    """Which comps do you underperform the field in?"""
    by_comp: dict[str, list[int]] = defaultdict(list)
    for g in games:
        by_comp[g["sig"]].append(g["placement"])

    rows = []
    for sig, places in by_comp.items():
        field = stats["comps"].get(sig)
        if not field or len(places) < MIN_GAMES_FOR_COMP_VERDICT:
            continue
        mine = statistics.mean(places)
        rows.append({
            "comp": comp_label(sig, stats),
            "games": len(places),
            "your_avg": round(mine, 2),
            "field_avg": field["avg_placement"],
            "gap": round(mine - field["avg_placement"], 2),
        })
    if not rows:
        return None
    rows.sort(key=lambda r: -r["gap"])
    worst = rows[0]
    return {
        "id": "comp_skill_gap",
        "title": "Comps you underperform in",
        "severity": "high" if worst["gap"] > 0.7 else "medium" if worst["gap"] > 0.3 else "ok",
        "metric": f"{worst['comp']}: {worst['gap']:+.2f} vs. field",
        "detail": (
            f"You average {worst['your_avg']} in {worst['comp']} where the field "
            f"averages {worst['field_avg']}. Either drop it or work out what the "
            f"field knows that you don't -- positioning and item priority are the "
            f"usual answers."
            if worst["gap"] > 0.3 else
            "You're performing at or above field average in the comps you play enough to judge."
        ),
        "table": rows,
    }


def leak_exit_timing(games: list[dict]) -> dict | None:
    bot4 = [g for g in games if g["placement"] >= 5]
    if len(bot4) < 3:
        return None
    rounds = [g["last_round"] for g in bot4 if g["last_round"]]
    if not rounds:
        return None
    avg = statistics.mean(rounds)
    early = sum(1 for r in rounds if r <= 26)  # roughly stage 4 or earlier
    return {
        "id": "exit_timing",
        "title": "Where your bad games end",
        "severity": "high" if early / len(rounds) > 0.5 else "medium" if early else "ok",
        "metric": f"round {avg:.0f} average in bottom-4 games",
        "detail": (
            f"{early} of your {len(rounds)} bottom-4 games ended by stage 4. Dying "
            f"that early is an early-game or stabilisation problem, not a late-game "
            f"one -- you're losing before your comp exists."
            if early / len(rounds) > 0.3 else
            "Your losses come late, which means you're stabilising and then losing "
            "the endgame. Look at positioning and item allocation rather than econ."
        ),
    }


# --- board reconstruction -------------------------------------------------
#
# match-v1 encodes cost as `rarity` on a non-obvious scale -- 0,1,2,4,6 rather
# than 0..4 -- and star level as `tier`. Verified against the store: rarity 0
# is Aatrox/Lissandra (1-cost), 6 is Shen/Bard (5-cost). 9 is the summon and
# PVE pseudo-unit class, which has no shop cost and is excluded rather than
# guessed at.
RARITY_COST = {0: 1, 1: 2, 2: 3, 4: 4, 6: 5}
# A star level costs three copies of the one below it, which is what makes
# board value roughly linear in gold rather than in unit count.
STAR_MULT = {1: 1, 2: 3, 3: 9, 4: 27}
COMPLETED_ITEM_VALUE = 3.0   # two components plus the tempo of holding them

# How far apart two boards' exit rounds can be and still be compared. Board
# value climbs with every round survived, so comparing a stage-4 death against
# a stage-6 one measures when you died, not how well you built.
PEER_ROUND_WINDOW = 1

# Peers needed before a game contributes to a lobby comparison. Two is the same
# floor leak_level_tempo uses; three discards roughly half the games, because a
# typical lobby only has two or three boards going out within a round of each
# other.
MIN_PEERS = 2


def board_value(p: dict) -> float:
    """Gold-equivalent value of a finished board.

    Deliberately a shop-cost model rather than a combat-strength one: nothing
    in match-v1 reports damage dealt by a unit, so any "strength" number would
    be a simulation dressed as a measurement. What this does measure is whether
    you converted your economy into board, which is the actual question behind
    "why did I lose with 40 gold in the bank".
    """
    total = 0.0
    for u in p.get("units", []):
        cost = RARITY_COST.get(u.get("rarity"))
        if cost is None:          # summons and PVE units aren't bought
            continue
        total += cost * STAR_MULT.get(u.get("tier"), 1)
        total += COMPLETED_ITEM_VALUE * len(u.get("itemNames") or [])
    return total


def _peers(g: dict) -> list[dict]:
    """Lobby boards that ended within PEER_ROUND_WINDOW of yours."""
    return [p for p in g["lobby"]
            if p.get("puuid") != g["puuid"]
            and abs((p.get("last_round") or 0) - (g["last_round"] or 0)) <= PEER_ROUND_WINDOW]


# --- mid-game diagnostics -------------------------------------------------

def leak_board_strength(games: list[dict]) -> dict | None:
    """Did your gold become board, compared with players who died when you did?

    This is the closest honest answer to "what went wrong mid-game". There is
    no round timeline in match-v1, so the collapse itself is not observable --
    but the state you were in when it happened is, and a board worth less than
    your lobby's at the same round is the fingerprint of every mid-game
    mistake that matters: rolling with nothing to hit, saving through a loss
    streak, holding components you never combined.
    """
    pcts = []
    for g in games:
        peers = _peers(g)
        if len(peers) < MIN_PEERS:
            continue
        mine = board_value(g["participant"])
        beaten = sum(1 for p in peers if board_value(p) < mine)
        pcts.append(beaten / len(peers))
    if len(pcts) < MIN_GAMES // 2:
        return None

    avg = statistics.mean(pcts)
    return {
        "id": "board_strength",
        "title": "Board value when you were eliminated",
        "severity": "high" if avg < 0.35 else "medium" if avg < 0.45 else "ok",
        "metric": f"{avg*100:.0f}th percentile vs. players who died with you",
        "detail": (
            "Your board is consistently worth less than the boards of players "
            "knocked out around the same round. That gap is gold that never "
            "became units or items -- rolling without hitting, saving through a "
            "lose streak, or holding components you never combined."
            if avg < 0.45 else
            "You're converting your economy into board as well as the players "
            "you go out with. When you lose, it isn't because your board was cheap."
        ),
        "caveat": "Shop cost, not combat strength -- the API reports no per-unit damage. "
                  "Compared only against boards that ended within a round of yours, "
                  "since board value climbs with every round survived.",
    }


def leak_itemisation(games: list[dict], stats: dict) -> dict | None:
    """Your carry's items against the best measured set for that unit.

    The single most actionable comparison available, because it names the fix:
    not "itemise better" but "you built Deathcap second on Bard; the field's
    best set places 0.4 better".
    """
    rows, gaps = [], []
    for g in games:
        carry = g["sig"].partition(" :: ")[2]
        if not carry:
            continue
        builds = stats.get("unit_items", {}).get(carry) or []
        if not builds:
            continue
        mine = next((u for u in g["participant"].get("units", [])
                     if u.get("character_id") == carry), None)
        held = sorted(mine.get("itemNames") or []) if mine else []
        if len(held) < 2:
            continue

        best = min(builds, key=lambda b: b["avg_placement"])
        match = next((b for b in builds if sorted(b["items"]) == held), None)
        # An unmeasured set is not automatically bad -- it may just be rare --
        # so it's reported separately rather than scored as a gap.
        gap = (match["avg_placement"] - best["avg_placement"]) if match else None
        if gap is not None:
            gaps.append(gap)
        if (gap is None and len(held) >= 3) or (gap is not None and gap > 0.2):
            rows.append({
                "carry": stats.get("champion_names", {}).get(carry, carry),
                "yours": [stats.get("item_names", {}).get(i, i) for i in held],
                "yours_icons": [stats.get("item_icons", {}).get(i) for i in held],
                "best": best.get("names") or best["items"],
                "best_icons": best.get("icons") or [],
                "gap": round(gap, 2) if gap is not None else None,
                "best_place": best["avg_placement"],
                "placement": g["placement"],
            })

    if not gaps and not rows:
        return None
    avg = statistics.mean(gaps) if gaps else 0.0
    rows.sort(key=lambda r: -(r["gap"] if r["gap"] is not None else 0))
    return {
        "id": "itemisation",
        "title": "Carry itemisation vs. the best measured build",
        "severity": "high" if avg > 0.35 else "medium" if avg > 0.15 else "ok",
        "metric": f"{avg:+.2f} placement vs. the best set" if gaps else "no measured overlap",
        "detail": (
            "The item sets you put on your carries place worse than the best "
            "measured set for the same unit. This is the cheapest fix on this "
            "page -- it needs no change to how you play, only to what you slam."
            if avg > 0.15 else
            "Your carry itemisation tracks the best measured builds."
        ),
        "builds": rows[:5],
        "caveat": "Compares only the set you finished holding. What components dropped, "
                  "and when, is not in the data.",
    }


def leak_star_tempo(games: list[dict]) -> dict | None:
    """Upgrades on board against the players who went out with you."""
    diffs = []
    for g in games:
        peers = _peers(g)
        if len(peers) < MIN_PEERS:
            continue
        def upgrades(p):
            return sum(1 for u in p.get("units", []) if (u.get("tier") or 1) >= 2)
        diffs.append(upgrades(g["participant"]) - statistics.mean(upgrades(p) for p in peers))
    if len(diffs) < MIN_GAMES // 2:
        return None
    avg = statistics.mean(diffs)
    return {
        "id": "star_tempo",
        "title": "2-star units relative to your lobby",
        "severity": "high" if avg < -1.2 else "medium" if avg < -0.5 else "ok",
        "metric": f"{avg:+.1f} upgraded units vs. peers",
        "detail": (
            "You finish with fewer upgrades than the players who go out around "
            "the same time. A board of 1-stars loses fights it looks like it "
            "should win, and it usually traces back to rolling for a unit the "
            "lobby is also holding rather than taking what's open."
            if avg < -0.5 else
            "You hit your upgrades at the same rate as your lobby."
        ),
    }


def leak_empty_slots(games: list[dict]) -> dict | None:
    """Item slots you died with unfilled."""
    empties = []
    for g in games:
        units = [u for u in g["participant"].get("units", [])
                 if RARITY_COST.get(u.get("rarity")) is not None]
        if not units:
            continue
        held = sum(len(u.get("itemNames") or []) for u in units)
        # Three slots per unit is the cap, but only the strongest few units are
        # ever meant to carry items -- comparing against the whole board would
        # call every normal game a failure. Five item-holding units is the
        # practical ceiling a real board reaches.
        expected = min(len(units), 5) * 3
        empties.append(max(expected - held, 0))
    if len(empties) < MIN_GAMES // 2:
        return None
    avg = statistics.mean(empties)
    return {
        "id": "empty_slots",
        "title": "Item slots left empty",
        "severity": "high" if avg >= 6 else "medium" if avg >= 4 else "ok",
        "metric": f"{avg:.1f} unfilled slots on your top 5 units",
        "detail": (
            "You're finishing games with items uncombined or unassigned. Slammed "
            "items win fights now; perfect items win fights you never reach."
            if avg >= 4 else
            "You're getting your items onto the board."
        ),
        "caveat": "Counts completed items only. Loose components in your bench inventory "
                  "aren't reported by the API, so the real gap can be larger.",
    }


def leak_contested(games: list[dict], stats: dict) -> dict | None:
    """How often you fought over your comp, and what it cost you."""
    contested, free = [], []
    n_contested = 0
    for g in games:
        others = sum(1 for p in g["lobby"]
                     if p.get("puuid") != g["puuid"] and comp_signature(p) == g["sig"])
        (contested if others >= 1 else free).append(g["placement"])
        if others >= 1:
            n_contested += 1
    if len(contested) < 3 or len(free) < 3:
        return None
    c_avg, f_avg = statistics.mean(contested), statistics.mean(free)
    rate = n_contested / len(games)
    cost = c_avg - f_avg
    return {
        "id": "contested",
        "title": "Playing contested",
        "severity": "high" if cost > 1.0 and rate > 0.4 else "medium" if cost > 0.5 else "ok",
        "metric": f"{rate*100:.0f}% of games contested · {cost:+.2f} placement when they are",
        "detail": (
            f"You average {c_avg:.2f} when someone else in the lobby is on your comp "
            f"and {f_avg:.2f} when you have it to yourself. Scouting at 2-1 and 3-2 "
            f"costs nothing and decides which of those games you're in."
            if cost > 0.5 else
            "Being contested doesn't cost you much, which usually means you're "
            "already pivoting off rather than fighting for units."
        ),
        "caveat": "Contested is measured from final boards, so a player who contested you "
                  "early and pivoted away doesn't show up here.",
    }


# --- playstyle profile ----------------------------------------------------

def player_tags(games: list[dict], stats: dict) -> list[dict]:
    """Descriptive labels for how this player actually plays.

    Every tag states the number behind it and the threshold it cleared, so it
    reads as a measurement rather than a horoscope. Tags are not judgements --
    "Forcer" isn't worse than "Flexible" -- they exist to make the leak advice
    below them specific to how you play.
    """
    tags = []
    n = len(games)

    # Unit overlap between consecutive games: are you rebuilding each game or
    # replaying one?
    overlaps = []
    for a, b in zip(games, games[1:]):
        ua = {u.get("character_id") for u in a["participant"].get("units", [])}
        ub = {u.get("character_id") for u in b["participant"].get("units", [])}
        if ua and ub:
            overlaps.append(len(ua & ub) / len(ua | ub))
    if overlaps:
        ov = statistics.mean(overlaps)
        tags.append({
            "id": "flexibility",
            "label": "Flexible" if ov < 0.30 else "Forcer" if ov > 0.5 else "Balanced",
            "tone": "good" if ov < 0.30 else "neutral",
            "detail": f"{ov*100:.0f}% of your units carry over between consecutive games",
            "criteria": "Flexible under 30% overlap, Forcer over 50%",
        })

    elims = [g["participant"].get("players_eliminated") or 0 for g in games]
    if elims:
        e = statistics.mean(elims)
        tags.append({
            "id": "aggression",
            "label": "Pacifist" if e < 0.8 else "Executioner" if e > 1.4 else "Balanced",
            "tone": "neutral",
            "detail": f"You eliminate {e:.1f} players per game",
            "criteria": "Pacifist under 0.8, Executioner over 1.4",
        })

    mid = sum(1 for g in games if 3 <= g["placement"] <= 6) / n
    tags.append({
        "id": "variance",
        "label": "Consistent" if mid > 0.6 else "Swingy" if mid < 0.35 else "Balanced",
        "tone": "neutral",
        "detail": f"You placed 3rd–6th in {round(mid*n)} of {n} games",
        "criteria": "Consistent over 60% of games in 3rd–6th",
    })

    golds = [g["gold_left"] or 0 for g in games]
    if golds:
        gl = statistics.mean(golds)
        tags.append({
            "id": "economy",
            "label": "Spends Down" if gl < 12 else "Hoarder" if gl > 25 else "Balanced",
            "tone": "good" if gl < 12 else "bad" if gl > 25 else "neutral",
            "detail": f"You die holding {gl:.0f} gold on average",
            "criteria": "Spends Down under 12 gold, Hoarder over 25",
        })

    # The trait you actually main, by units fielded rather than by comps played
    # -- a trait you splash three of in every game is more your identity than
    # one headline trait you hit twice.
    trait_units = Counter()
    for g in games:
        for t in g["participant"].get("traits", []):
            if t.get("tier_current", 0) > 0:
                trait_units[t["name"]] += t.get("num_units", 0)
    if trait_units:
        top, units = trait_units.most_common(1)[0]
        tags.append({
            "id": "main_trait",
            "label": stats.get("trait_names", {}).get(top, top),
            "tone": "accent",
            "detail": f"You field {units/n:.1f} {stats.get('trait_names', {}).get(top, top)} units per game",
            "criteria": "Most-played trait by unit count across all games",
        })

    return tags


def playstyle_axes(games: list[dict]) -> list[dict]:
    """Two measured axes. Deliberately not the four a client-side overlay can
    show -- damage type and board role need per-unit combat data that match-v1
    doesn't return, and inventing them from unit names would be a guess."""
    axes = []

    overlaps = []
    for a, b in zip(games, games[1:]):
        ua = {u.get("character_id") for u in a["participant"].get("units", [])}
        ub = {u.get("character_id") for u in b["participant"].get("units", [])}
        if ua and ub:
            overlaps.append(len(ua & ub) / len(ua | ub))
    if overlaps:
        axes.append({"id": "flex", "left": "Flexible", "right": "Forcer",
                     "value": round(min(max(statistics.mean(overlaps) / 0.7, 0), 1), 3)})

    golds = [g["gold_left"] or 0 for g in games]
    if golds:
        axes.append({"id": "econ", "left": "Spends down", "right": "Hoards",
                     "value": round(min(max(statistics.mean(golds) / 45, 0), 1), 3)})

    return axes


# --- advice ---------------------------------------------------------------

# What to actually do about each leak, phrased as a habit you can hold in your
# head for one game rather than a principle. The second entry in each pair is
# used when the player's own tags say the generic advice would push them the
# wrong way -- telling a Hoarder to "save through the loss streak" is worse
# than saying nothing.
FIXES = {
    "itemisation": (
        "Before you queue, open the Units tab and read the top item set for the two "
        "carries you play most. Slam toward that set instead of holding for perfect.",
        None,
    ),
    "board_strength": (
        "Pick one round -- 4-1 is the usual one -- and make a rule that you leave it "
        "with an empty bench and no more than 20 gold. Board first, econ second.",
        ("economy", "Hoarder",
         "You bank more than most players and it isn't converting. Spend to 30 at 4-1 "
         "rather than rolling from 50 at 4-5, when the units that would fix your board "
         "are already gone from the pool."),
    ),
    "augment_fit": (
        "Read your 2-1 augment as a commitment, then use the Advisor tab to see which "
        "comps it actually supports before you start buying units for a different one.",
        None,
    ),
    "comp_skill_gap": (
        "You have a comp you play often and place badly in. Open it in Comps, compare "
        "its levelling curve and item priority against how you actually play it, and "
        "fix the one that differs most.",
        None,
    ),
    "contested": (
        "Scout at 2-1 and again at 3-2. If two other boards are on your units, the comp "
        "is not available to you at the price you want to pay -- take the open line.",
        ("flexibility", "Forcer",
         "You repeat the same units game to game, which makes being contested much more "
         "expensive for you than for the lobby. Learn a second line off the same early "
         "units so scouting has somewhere to send you."),
    ),
    "star_tempo": (
        "Buy the units in front of you rather than rolling for the ones you want. A "
        "2-star off-comp unit beats a 1-star on-comp one in every fight that matters.",
        None,
    ),
    "gold_hoarding": (
        "Set a floor: if you are below 50 HP, you are not saving. Roll it down that "
        "round rather than the next one.",
        None,
    ),
    "empty_slots": (
        "Slam your components by 3-2 unless you are one component from a clear BiS. "
        "The placement you lose from a wrong item is smaller than the one you lose "
        "from an empty slot.",
        None,
    ),
    "level_tempo": (
        "Fix your level checkpoints. Write down the level you intend to be at 3-2, 4-1 "
        "and 4-5 for the comp you play most, then hold to them for a set of games.",
        None,
    ),
    "comp_flexibility": (
        "Play the augments and the units the game gives you for ten games. Your "
        "placement will drop before it rises; you are buying the ability to take "
        "whatever is open.",
        None,
    ),
    "exit_timing": (
        "Your bad games end early, so the fix is early. Buy a stronger 2-1 and 2-5 "
        "board even off-comp, and stop taking the greedy econ option on a lose streak "
        "you are not committed to.",
        None,
    ),
}


def improvement_plan(leaks: list[dict], tag_labels: dict[str, str]) -> list[dict]:
    """The two or three things worth changing, in order, tailored by playstyle.

    Ordered by the leak severity rather than by what's easy to say, and capped
    at three: a list of eleven things to fix is a list of nothing to fix. Leaks
    already reading "ok" are excluded entirely -- there is no advice to give
    about something that isn't happening.
    """
    plan = []
    for leak in leaks:
        if leak["severity"] == "ok" or leak["id"] not in FIXES:
            continue
        generic, override = FIXES[leak["id"]]
        text = generic
        tailored = False
        if override:
            tag_id, label, alt = override
            if tag_labels.get(tag_id) == label:
                text, tailored = alt, True
        plan.append({
            "leak": leak["id"],
            "title": leak["title"],
            "severity": leak["severity"],
            "metric": leak["metric"],
            "do": text,
            "tailored": tailored,
        })
        if len(plan) == 3:
            break
    return plan


# --- orchestration --------------------------------------------------------

def _split(puuid: str, matches: list[dict]) -> tuple[list[dict], list[dict]]:
    """Flatten raw matches into this player's games, plus the queue breakdown."""
    all_games = []
    for m in matches:
        me = _me(m, puuid)
        if not me:
            continue
        info = m.get("info", {})
        q = info.get("queue_id")
        all_games.append({
            "match_id": m.get("metadata", {}).get("match_id"),
            "puuid": puuid,
            "placement": me.get("placement"),
            "level": me.get("level", 0),
            "last_round": me.get("last_round"),
            "gold_left": me.get("gold_left"),
            "played_at": info.get("game_datetime"),
            "queue_id": q,
            "queue": queue_label(q, info.get("tft_game_type")),
            "game_type": info.get("tft_game_type"),
            "augments": [a for a in (me.get("augments") or []) if not is_legend_augment(a)],
            "sig": comp_signature(me),
            # The whole participant record, kept so the board diagnostics can
            # read units, items and traits without re-walking the match.
            "participant": me,
            "lobby": info.get("participants", []),
        })

    # Newest first, which is the order Riot returns and the order the tags
    # assume when they compare consecutive games.
    all_games.sort(key=lambda g: g.get("played_at") or 0, reverse=True)

    # Counts cover everything fetched, which is a window rather than the whole
    # account -- labelled as such by the client so "3 Double Up" doesn't read as
    # a lifetime total.
    queue_counts = Counter((g["queue_id"], g["queue"], g["game_type"]) for g in all_games)
    queues = [{"id": qid, "label": label, "games": n, "game_type": gt,
               "field_comparable": qid in FIELD_COMPARABLE,
               "lobby_comparable": gt in LOBBY_COMPARABLE_TYPES}
              for (qid, label, gt), n in sorted(queue_counts.items(), key=lambda kv: -kv[1])]

    return all_games, queues


def analyse(puuid: str, matches: list[dict], stats: dict,
            queue: int | None = RANKED_QUEUE) -> dict:
    """Summarise and diagnose one player's history for a single queue.

    Kept for the CLI and for callers that want one queue. The web endpoint uses
    analyse_all, which returns every queue from the same fetch.
    """
    all_games, queues = _split(puuid, matches)

    if queue is None:
        # "All queues" cannot mean literally all of them. Placement doesn't
        # carry the same meaning across game types: Tacticians Trials is a
        # one-player PvE mode where placement is always 1, so averaging it in
        # silently improves your record, and Double Up is scored in pairs.
        # Aggregating only `standard` keeps the 1-8 scale meaning one thing,
        # and uses the game type the match reports rather than an id list that
        # would miss every new limited-time mode.
        games = [g for g in all_games if g["game_type"] in ("standard", None)]
    else:
        games = [g for g in all_games if g["queue_id"] in (queue, None)]

    view = _queue_view(games, stats, queue)
    if view is None:
        label = queue_label(queue) if queue is not None else "any standard"
        return {"error": f"no {label} games found in this account's recent history",
                "queues": queues, "examined": len(all_games)}

    return {
        **view,
        "recent": _recent(all_games, stats),
        "patch": stats.get("patch"),
        "compared_against": stats.get("slice_label", "published stats"),
        "queues": queues,
        "examined": len(all_games),
    }


def analyse_all(puuid: str, matches: list[dict], stats: dict) -> dict:
    """Every queue's view from a single fetch.

    Tabs re-analysing on click meant a fresh Riot round-trip per tab -- about a
    minute each under a development key's rate limit, for data already sitting
    in memory. The matches are fetched once; slicing them by queue is pure
    arithmetic, so all views are computed together and the client switches
    between them without touching the network.
    """
    all_games, queues = _split(puuid, matches)
    views = {}
    std = [g for g in all_games if g["game_type"] in ("standard", None)]
    v = _queue_view(std, stats, None)
    if v:
        views["all"] = v
    for q in {g["queue_id"] for g in all_games}:
        v = _queue_view([g for g in all_games if g["queue_id"] in (q, None)], stats, q)
        if v:
            views[str(q)] = v
    return {
        "views": views,
        "recent": _recent(all_games, stats),
        "patch": stats.get("patch"),
        "compared_against": stats.get("slice_label", "published stats"),
        "queues": queues,
        "examined": len(all_games),
    }


def _queue_view(games: list[dict], stats: dict, queue: int | None) -> dict | None:
    """Summary, leaks, tags and plan for one queue's games."""
    if not games:
        return None

    placements = [g["placement"] for g in games]
    summary = {
        "games": len(games),
        "avg_placement": round(statistics.mean(placements), 2),
        "top4_rate": round(sum(1 for p in placements if p <= 4) / len(placements), 3),
        "win_rate": round(sum(1 for p in placements if p == 1) / len(placements), 3),
        "field_avg": stats["baseline_placement"],
        "placement_counts": {str(i): placements.count(i) for i in range(1, 9)},
        "low_sample": len(games) < MIN_GAMES,
    }

    # Which comparisons the selected queue actually supports. Running the
    # field-relative detectors on Double Up would compare a paired game against
    # a ranked solo tier list and report the mismatch as the player's mistake.
    # "vs. the field" is a ranked claim and only a ranked claim, so the
    # aggregate view never makes it -- it spans normals and limited-time modes
    # the tier list was not built from. Lobby-relative checks still hold there,
    # because the comparison population is inside each match.
    field_ok = queue in FIELD_COMPARABLE
    lobby_ok = games[0]["game_type"] in LOBBY_COMPARABLE_TYPES

    detectors = []
    if field_ok:
        detectors += [
            leak_itemisation(games, stats),
            leak_augment_fit(games, stats),
            leak_comp_skill_gap(games, stats),
        ]
    if lobby_ok:
        detectors += [
            leak_board_strength(games),
            leak_contested(games, stats),
            leak_star_tempo(games),
            leak_level_tempo(games),
        ]
    # Self-referential: these read only your own boards, so they hold in any
    # queue that has placements at all.
    detectors += [
        leak_gold_hoarding(games),
        leak_empty_slots(games),
        leak_comp_flexibility(games, stats),
        leak_exit_timing(games),
    ]
    leaks = [d for d in detectors if d]
    order = {"high": 0, "medium": 1, "ok": 2}
    leaks.sort(key=lambda d: order.get(d["severity"], 3))

    tags = player_tags(games, stats)
    names = {t["id"]: t["label"] for t in tags}

    return {
        "summary": summary,
        "leaks": leaks,
        "tags": tags,
        "axes": playstyle_axes(games),
        "plan": improvement_plan(leaks, names),
        "queue": queue,
        "queue_label": games[0]["queue"] if queue is not None else "All 8-player queues",
        "field_comparable": field_ok,
        "lobby_comparable": lobby_ok,
    }


def _recent(all_games: list[dict], stats: dict) -> list[dict]:
    """Every fetched game, tagged with its queue so the client can tab locally."""
    return [
        {"placement": g["placement"], "comp": comp_label(g["sig"], stats),
         "queue": g["queue"], "queue_id": g["queue_id"],
         "level": g["level"], "round": g["last_round"], "gold": g["gold_left"],
         "played_at": g["played_at"],
         "board_value": round(board_value(g["participant"])),
         "eliminations": g["participant"].get("players_eliminated"),
         "damage": g["participant"].get("total_damage_to_players"),
         "augments": [stats["augment_names"].get(a, a) for a in g["augments"]],
         "traits": [
             {"name": t["name"], "units": t.get("num_units", 0), "style": t.get("style", 0)}
             for t in sorted(g["participant"].get("traits", []),
                             key=lambda t: (-t.get("style", 0), -t.get("num_units", 0)))
             if t.get("tier_current", 0) > 0
         ][:6],
         "units": [
             {"id": u.get("character_id"),
              "name": champion_name(u.get("character_id"), stats),
              "icon": champion_icon(u.get("character_id"), stats),
              "cost": RARITY_COST.get(u.get("rarity")),
              "star": u.get("tier"),
              "items": [stats.get("item_names", {}).get(i, i) for i in (u.get("itemNames") or [])],
              "item_icons": [stats.get("item_icons", {}).get(i) for i in (u.get("itemNames") or [])]}
             for u in sorted(g["participant"].get("units", []),
                             key=lambda u: -(RARITY_COST.get(u.get("rarity")) or 0))
             if RARITY_COST.get(u.get("rarity")) is not None
         ],
        }
        for g in all_games
    ]


def main() -> None:
    import argparse
    from riot_client import RiotTFTClient

    ap = argparse.ArgumentParser(description="Review your own recent TFT games.")
    ap.add_argument("riot_id", help="GameName#TAG")
    ap.add_argument("--platform", default="na1")
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--stats", default="public/current/global-apex.json")
    ap.add_argument("--out", default="review.json")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    if "#" not in args.riot_id:
        raise SystemExit("Riot ID must look like GameName#TAG")
    name, tag = args.riot_id.rsplit("#", 1)

    stats = json.loads(Path(args.stats).read_text())
    client = RiotTFTClient()

    log.info("resolving %s#%s ...", name, tag)
    puuid, matches = fetch_history(client, args.platform, name, tag, args.count)
    log.info("pulled %d ranked games", len(matches))

    result = analyse(puuid, matches, stats)
    Path(args.out).write_text(json.dumps(result, indent=2))

    s = result["summary"]
    print(f"\n{args.riot_id} -- last {s['games']} ranked games")
    print(f"  avg placement {s['avg_placement']}  (field {s['field_avg']})")
    print(f"  top 4 {s['top4_rate']*100:.0f}%   firsts {s['win_rate']*100:.0f}%\n")
    for leak in result["leaks"]:
        mark = {"high": "!!", "medium": "! ", "ok": "  "}[leak["severity"]]
        print(f"{mark} {leak['title']}: {leak['metric']}")
        print(f"     {leak['detail']}\n")
    print(f"written to {args.out}")


if __name__ == "__main__":
    main()
