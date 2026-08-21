"""
Natural-language front door to the published stats.

WHY TOOLS RATHER THAN A STUFFED PROMPT
--------------------------------------
The obvious build is to paste a slice into the system prompt and ask nicely.
That fails this project specifically. Every number on this site carries its
sample size and its caveat -- the augment tab says there are no augment win
rates, slices are withheld when they cannot support a tier list, and a
structural 4.5 is labelled as an identity rather than a measurement. A model
recalling numbers from a wall of JSON will eventually state one that is close
but wrong, and a confidently wrong stat undoes all of that.

So the model gets no statistics in its context. It gets TOOLS that read the
published files, and every tool returns the sample behind what it reports. The
model can only say numbers it actually retrieved, and it inherits the
pipeline's existing refusals for free: ask about augment win rates and the tool
returns an explanation of why none exist, because none do.

It is also what makes this affordable. A slice is ~400 KB of JSON, about 100K
tokens, which would cost roughly $0.50 a question. A tool call returns a few
hundred tokens.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

log = logging.getLogger("chat")

CURRENT = Path("public/current")
MODEL = "claude-opus-5"

# Non-streaming, so this stays under the SDK's HTTP timeout. Answers here are
# short by design -- the tools do the retrieval, the model does the phrasing.
MAX_TOKENS = 4000

# How many turns of prior conversation to replay. Enough for "what about the
# other one" to resolve, short enough that the cost stays flat.
HISTORY_TURNS = 8


# --- data access ----------------------------------------------------------

_cache: dict[str, dict] = {}


def _slice(slice_id: str = "global-all") -> dict:
    """One published slice, memoised. Published files are immutable per build."""
    if slice_id not in _cache:
        path = CURRENT / f"{slice_id}.json"
        if not path.exists():
            raise FileNotFoundError(slice_id)
        _cache[slice_id] = json.loads(path.read_text())
    return _cache[slice_id]


def _manifest() -> dict:
    return json.loads((CURRENT / "manifest.json").read_text())


def _resolve(name: str, names: dict[str, str]) -> tuple[str, str] | None:
    """Player-typed name -> (id, display name).

    Match exactly, then by prefix, then by substring. Riot ids are
    "TFT17_TwistedFate" and players type "twisted fate", so spaces and case are
    stripped on both sides before comparing.
    """
    want = name.lower().replace(" ", "").replace("'", "")
    norm = {i: (n or "").lower().replace(" ", "").replace("'", "") for i, n in names.items()}
    for match in (lambda a, b: a == b,
                  lambda a, b: b.startswith(a),
                  lambda a, b: a in b):
        for cid, n in norm.items():
            if n and match(want, n):
                return cid, names[cid]
    return None


def _stat_line(s: dict) -> dict:
    """A stat row with its sample attached, always. Never return a placement
    without the n it was measured over."""
    return {
        "avg_placement": s.get("avg_placement"),
        "top4_rate": s.get("top4_rate"),
        "win_rate": s.get("win_rate"),
        "games": s.get("n"),
        "play_rate": s.get("play_rate"),
    }


# --- tools ----------------------------------------------------------------
#
# Each one reads the published files and returns the sample behind whatever it
# reports. Docstrings are the tool descriptions the model sees, so they say what
# the number MEANS, not just what the field is called.

from anthropic import beta_tool  # noqa: E402


@beta_tool
def list_slices() -> str:
    """List the data cuts available, with how many boards each holds.

    A slice is a population, not a filter applied on the fly. Use this first if
    the player asks about a region or rank, or if you need to know what is
    actually published before answering.
    """
    m = _manifest()
    return json.dumps({
        "patch": m.get("patch_label") or m.get("patch"),
        "client_build": m.get("patch"),
        "slices": [{"id": s["id"], "label": s["label"], "boards": s["sample_size"],
                    "comps": s["comps"]} for s in m["slices"]],
        "note": ("Slices are withheld when they cannot support a ranking, so a "
                 "region missing here has too little data this patch rather than "
                 "no players."),
    })


@beta_tool
def get_unit(name: str, slice_id: str = "global-all") -> str:
    """Stats for one champion: placement, win rate, how often it is played, and
    the item sets measured on it.

    Item sets are the FULL three-slot build a board finished with, ranked by the
    placement of boards that ran them -- not "most popular item".

    The ranking has no sample floor, so a set played 30 times can sit above one
    played 50 times. Each carries `games` and `stderr`; when the top set has a
    small sample, say so instead of presenting it as settled. "Empty Bag" is how
    the API reports a slot Thief's Gloves filled randomly, not an item a player
    chose to build.

    Args:
        name: Champion name as a player would type it, e.g. "Jhin".
        slice_id: Data cut. Use list_slices to see the options.
    """
    try:
        d = _slice(slice_id)
    except FileNotFoundError:
        return json.dumps({"error": f"no slice '{slice_id}'"})
    hit = _resolve(name, d.get("champion_names", {}))
    if not hit:
        return json.dumps({"error": f"no champion matching '{name}' in this set"})
    cid, display = hit
    s = d["champions"].get(cid)
    if not s:
        return json.dumps({"champion": display,
                           "error": "in the set but below the sample floor in this slice"})
    # Ranked by placement with no sample floor, which lets a 33-board set
    # outrank a 50-board one. stderr rides along so the answer can say which
    # rankings are actually separable -- and "Empty Bag" is what the API reports
    # for the slots Thief's Gloves fills randomly, not a real item.
    builds = [{"items": b.get("names") or b["items"],
               "avg_placement": b["avg_placement"], "games": b["n"],
               "stderr": b.get("stderr")}
              for b in (d.get("unit_items", {}).get(cid) or [])[:6]]
    change = (d.get("place_change", {}).get("units") or {}).get(cid)
    return json.dumps({
        "champion": display, "slice": d.get("slice_label"),
        **_stat_line(s),
        "item_sets_ranked_by_placement": builds,
        "change_since_last_window": change,
        "field_average_placement": 4.5,
    })


@beta_tool
def get_item(name: str, slice_id: str = "global-all") -> str:
    """Stats for one item, plus which champions hold it best.

    Args:
        name: Item name, e.g. "Blue Buff".
        slice_id: Data cut. Use list_slices to see the options.
    """
    try:
        d = _slice(slice_id)
    except FileNotFoundError:
        return json.dumps({"error": f"no slice '{slice_id}'"})
    hit = _resolve(name, d.get("item_names", {}))
    if not hit:
        return json.dumps({"error": f"no item matching '{name}'"})
    iid, display = hit
    s = d["items"].get(iid)
    if not s:
        return json.dumps({"item": display, "error": "below the sample floor in this slice"})
    holders = [{"champion": d["champion_names"].get(h["champion"], h["champion"]),
                "avg_placement": h["avg_placement"], "games": h["n"],
                "share_of_holders": h["share"]}
               for h in (d.get("item_holders", {}).get(iid) or [])[:6]]
    return json.dumps({
        "item": display, "slice": d.get("slice_label"),
        **_stat_line(s),
        "best_holders": holders,
        "change_since_last_window": (d.get("place_change", {}).get("items") or {}).get(iid),
    })


@beta_tool
def get_trait(name: str, slice_id: str = "global-all") -> str:
    """Stats for one trait, broken down by breakpoint.

    Breakpoints matter more than the trait: 4-of and 6-of cost different amounts
    and pay differently, so report the breakpoint rather than a blended average.

    Args:
        name: Trait name, e.g. "Dark Star".
        slice_id: Data cut.
    """
    try:
        d = _slice(slice_id)
    except FileNotFoundError:
        return json.dumps({"error": f"no slice '{slice_id}'"})
    names = d.get("trait_names") or {t: t for t in d.get("traits", {})}
    hit = _resolve(name, names)
    if not hit:
        return json.dumps({"error": f"no trait matching '{name}'"})
    tid, display = hit
    rows = d.get("traits", {}).get(tid)
    if not rows:
        return json.dumps({"trait": display, "error": "below the sample floor in this slice"})
    return json.dumps({
        "trait": display, "slice": d.get("slice_label"),
        "breakpoints": [{"units": r["units"], "avg_placement": r["avg_placement"],
                         "win_rate": r.get("win_rate"), "games": r["n"]} for r in rows],
        "change_since_last_window": (d.get("place_change", {}).get("traits") or {}).get(tid),
    })


@beta_tool
def tier_list(kind: str = "units", slice_id: str = "global-all", limit: int = 10) -> str:
    """The best-performing entries of a kind, ranked by average placement.

    Args:
        kind: One of "units", "items", "traits", "comps".
        slice_id: Data cut.
        limit: How many to return, at most 25.
    """
    try:
        d = _slice(slice_id)
    except FileNotFoundError:
        return json.dumps({"error": f"no slice '{slice_id}'"})
    limit = max(1, min(limit, 25))
    if kind == "comps":
        rows = [{"name": d.get("comp_names", {}).get(sig, sig), **_stat_line(s)}
                for sig, s in d.get("comps", {}).items()]
    elif kind == "traits":
        rows = []
        for tid, brs in d.get("traits", {}).items():
            best = min(brs, key=lambda r: r["avg_placement"])
            rows.append({"name": (d.get("trait_names") or {}).get(tid, tid),
                         "at_units": best["units"], **_stat_line(best)})
    elif kind == "items":
        rows = [{"name": d["item_names"].get(i, i), **_stat_line(s)}
                for i, s in d.get("items", {}).items()]
    else:
        rows = [{"name": d["champion_names"].get(c, c), **_stat_line(s)}
                for c, s in d.get("champions", {}).items()]
    rows.sort(key=lambda r: r["avg_placement"] if r["avg_placement"] is not None else 9)
    return json.dumps({"kind": kind, "slice": d.get("slice_label"),
                       "boards_in_slice": d.get("sample_size"), "ranked": rows[:limit]})


@beta_tool
def biggest_movers(kind: str = "units", slice_id: str = "global-all", limit: int = 8) -> str:
    """What got better or worse since the previous window.

    A negative delta is an IMPROVEMENT -- placement is inverted, 1st is best.
    Entries without enough sample on both sides of the comparison are absent
    rather than reported as unchanged.

    Args:
        kind: One of "units", "items", "traits", "comps".
        slice_id: Data cut.
        limit: How many in each direction.
    """
    try:
        d = _slice(slice_id)
    except FileNotFoundError:
        return json.dumps({"error": f"no slice '{slice_id}'"})
    changes = (d.get("place_change") or {}).get(kind) or {}
    if not changes:
        return json.dumps({"error": f"no measured change for {kind} in this slice"})
    label = {"units": d.get("champion_names", {}), "items": d.get("item_names", {}),
             "traits": d.get("trait_names") or {}, "comps": d.get("comp_names", {})}[kind]
    rows = [{"name": label.get(k, k), "delta": v["delta"], "from": v["prev"],
             "to": v["curr"], "games_before": v["n_prev"], "games_after": v["n_curr"]}
            for k, v in changes.items()]
    rows.sort(key=lambda r: r["delta"])
    return json.dumps({"kind": kind, "window": d.get("trend_window"),
                       "improved": rows[:limit], "worsened": rows[-limit:][::-1]})


@beta_tool
def augment_data_availability() -> str:
    """Why this site has no augment win rates. Call this for ANY question about
    augment strength, tier lists, or which augment to pick on stats."""
    return json.dumps({
        "augment_statistics": "none exist",
        "reason": ("Riot's tft-match-v1 returns no augments on a participant. The "
                   "field is absent from every match in the store, so no augment "
                   "win rate, placement or tier can be measured here -- by anyone "
                   "using this API. Sites that show augment stats collect them "
                   "client-side through their own desktop app."),
        "what_exists": ("The Advisor pairs Riot's augment effect text with measured "
                        "comp characteristics to suggest which comps an augment "
                        "supports. That is reasoning about effects, not a win rate."),
    })


TOOLS = [list_slices, get_unit, get_item, get_trait, tier_list,
         biggest_movers, augment_data_availability]


# --- the assistant --------------------------------------------------------

SYSTEM = """You answer questions about Teamfight Tactics using HexCall's measured data.

WHERE YOUR NUMBERS COME FROM
You have no statistics in your context. Every number you state must come from a
tool call you just made. If you did not retrieve it, you do not know it -- say
so and offer to look up something you can retrieve instead. Never estimate a
placement, win rate or play rate, never round one you half-remember from
training, and never describe a unit as strong or weak without having looked.

ALWAYS CARRY THE SAMPLE
Tools return the games behind every stat. Quote it. "Jhin averages 3.72 over
2,570 boards" is the shape; "Jhin is S tier" without a number is not. When a
sample is small, say the number is soft rather than presenting it flatly.

PLACEMENT IS INVERTED
Lower is better; 1st is the best outcome. 4.5 is the average of an eight-player
lobby by construction, so it is the midpoint to sit above or below rather than a
benchmark anything was measured against. A NEGATIVE change is an improvement.

WHAT THIS DATA CANNOT DO
Augments have no statistics at all -- call augment_data_availability and explain
why rather than guessing. There is no round-by-round history, so you cannot say
what happened during a game, only what state a board ended in. Item sets are
whole three-slot builds, not individual item popularity.

SCOPE
Post-game analysis and planning between games. If asked what to play right now
in a live game, say you are built for planning and review rather than live
advice, and answer the planning version of the question.

STYLE
Answer in prose, briefly. Lead with the answer, then the number that supports
it. No preamble, no restating the question. Two or three sentences is usually
right; use a short list only when comparing several things."""


class NoKey(RuntimeError):
    """Raised when no Anthropic credential is configured."""


def answer(question: str, history: list[dict] | None = None,
           slice_id: str = "global-all") -> dict:
    """Answer one question. Returns the text plus which tools were consulted.

    The tools consulted are returned so the UI can show what was actually read
    -- the point of the whole design is that the answer is traceable to files,
    and a chat bubble that cannot be checked is worth less than the tier list
    it is sitting next to.
    """
    import anthropic

    # Credentials resolve from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
    # `ant auth login` profile. Fail with something actionable rather than
    # letting the SDK raise on the first request.
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            or Path(os.path.expanduser("~/.config/anthropic")).exists()):
        raise NoKey("No Anthropic credential. Set ANTHROPIC_API_KEY, or run `ant auth login`.")

    client = anthropic.Anthropic()

    messages: list[dict] = []
    for turn in (history or [])[-HISTORY_TURNS:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({
        "role": "user",
        "content": f"[default data cut: {slice_id}]\n{question}",
    })

    runner = client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM,
        tools=TOOLS,
        messages=messages,
    )

    used: list[str] = []
    text_parts: list[str] = []
    for message in runner:
        for block in message.content:
            if block.type == "tool_use":
                used.append(block.name)
            elif block.type == "text" and block.text.strip():
                text_parts.append(block.text.strip())

    return {
        "answer": text_parts[-1] if text_parts else
                  "I couldn't find that in the published data.",
        "tools_used": used,
        "model": MODEL,
    }


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    ap = argparse.ArgumentParser(description="Ask the published stats a question.")
    ap.add_argument("question")
    ap.add_argument("--slice", default="global-all")
    args = ap.parse_args()
    try:
        out = answer(args.question, slice_id=args.slice)
    except NoKey as e:
        raise SystemExit(str(e))
    print(out["answer"])
    if out["tools_used"]:
        print(f"\n[read: {', '.join(dict.fromkeys(out['tools_used']))}]")
