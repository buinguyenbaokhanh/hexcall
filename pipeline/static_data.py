"""
Static data from Data Dragon -- Riot's official, key-free CDN.

The match API gives you IDs like 'TFT17_Augment_RichGetRicher' and
'TFT17_Xayah'. Data Dragon turns those into display names and icon paths.
No API key needed, no rate limit, and it's the officially sanctioned source
for assets, so use it rather than scraping names off a stats site.

Note from Riot's docs: Data Dragon updates are a manual process on their side,
so it is "not always updated immediately after a patch." Cache what you get and
fall back to prettifying the raw ID when a brand-new augment is missing.

Community Dragon (raw.communitydragon.org) is the unofficial mirror that
updates faster and includes trait breakpoint values and augment description
text, which Data Dragon omits. Worth adding as a secondary source once you
need tooltip text -- just don't make it your only source.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

import requests

DDRAGON = "https://ddragon.leagueoflegends.com"
CACHE = Path("ddragon_cache")

# Community Dragon: unofficial but far more complete than Data Dragon for TFT.
# Data Dragon's tft-item.json is name + icon only -- no description, no stat
# values, no crafting recipe. CDragon's bundle has all three, keyed by the
# same "TFT_Item_..." apiName the match API and Data Dragon both use, so it
# joins cleanly onto the resolver without any fuzzy matching.
CDRAGON_TFT_URL = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json"
CDRAGON_CACHE = CACHE / "cdragon_tft.json"

# CDragon references game assets by their internal path ("ASSETS/Characters/
# .../Foo.tex"). The served copy is lowercased and transcoded to PNG under
# /latest/game/, so this turns an internal path into a fetchable URL. Used for
# champion ability icons, which Data Dragon does not publish at all.
CDRAGON_ASSET_BASE = "https://raw.communitydragon.org/latest/game/"

# Item description templates reference stat values as "@FieldName@" or
# "@FieldName*100@", where FieldName is a key in the item's own `effects`
# dict. This turns "Gain @BonusPercentHP*100@% max Health." into
# "Gain 18% max Health." using the item's actual numbers. Some templates
# also reference other transclusions we don't have data for (e.g.
# "@TFTUnitProperty.:TFT_Augment_TragicalBlade_TRAKey@") -- match any @...@
# span so those get stripped too, rather than only well-formed stat tokens
# and leaving the rest as literal template syntax in the rendered text.
_STAT_TOKEN = re.compile(r"@([^@]+)@")
_SIMPLE_FIELD = re.compile(r"^([A-Za-z0-9_]+)(?:\*(-?[\d.]+))?$")
_TAG = re.compile(r"<[^>]+>")
_ICON_TOKEN = re.compile(r"%i:[^%]*%")
_KEYWORD_BLOCK = re.compile(r"\{\{[^}]+\}\}")
_HASH_KEY = re.compile(r"^\{[0-9a-f]+\}$")
_EMPTY_PARENS = re.compile(r"\(\s*\)")
_MULTI_SPACE = re.compile(r"[ \t]{2,}")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([.,;:!?%])")

# Human labels for the most common effect keys. Anything not listed here
# falls back to a prettified version of the raw key -- good enough for the
# long tail of item-specific fields (e.g. "ShieldHealthPercent").
STAT_LABELS = {
    "AD": "Attack Damage", "AP": "Ability Power", "AS": "Attack Speed",
    "Armor": "Armor", "MagicResist": "Magic Resist", "Health": "Health",
    "Mana": "Mana", "CritChance": "Crit Chance", "CritDamageToGive": "Crit Damage",
    "LifeSteal": "Life Steal", "StatOmnivamp": "Omnivamp", "DodgeChance": "Dodge Chance",
    "BonusPercentHP": "Bonus Max Health",
}


def _fetch_cdragon_raw() -> dict:
    if CDRAGON_CACHE.exists():
        return json.loads(CDRAGON_CACHE.read_text())
    raw = requests.get(CDRAGON_TFT_URL, timeout=60).json()
    CACHE.mkdir(exist_ok=True)
    CDRAGON_CACHE.write_text(json.dumps(raw))
    return raw


def cdragon_asset(path: str | None) -> str | None:
    """Internal CDragon asset path -> fetchable PNG URL."""
    if not path:
        return None
    p = path.lower()
    for ext in (".tex", ".dds"):
        if p.endswith(ext):
            p = p[: -len(ext)] + ".png"
            break
    return CDRAGON_ASSET_BASE + p.lstrip("/")


def live_set(raw: dict, set_number: int | str | None = None) -> dict:
    """The setData block for one TFT set.

    Each set ships several mutator variants (base plus "_PVEMODE"/"_PAIRS" for
    side modes) that share a roster; only the plain "TFTSet17"-style mutator is
    the real one. Defaults to the highest-numbered set present, so this keeps
    working across a set rollover without a code change -- pass set_number to
    pin it to whatever set the match store actually holds.
    """
    sets = [s for s in raw.get("setData", [])
            if s.get("number") is not None and s.get("mutator") == f"TFTSet{s['number']}"]
    if not sets:
        return {}
    if set_number is not None:
        for s in sets:
            if str(s["number"]) == str(set_number):
                return s
    return max(sets, key=lambda s: int(s["number"]))


# Augment rarity is Silver/Gold/Prismatic, and CDragon does not publish it as a
# field. It is, however, encoded in the icon filename as a trailing numeral --
# "BodyguardsTraining_II.tex" is the Gold cut, "Exiles2.tex" the same idea in
# arabic. Some augments carry it only in their display name ("Exiles II").
# Checking all three resolves 270 of the 274 augments in the Set 17 pool; the
# remainder are malformed placeholder rows in CDragon's own data (their `name`
# is a description string) and degrade to an unlabelled rarity rather than a
# wrong one.
AUGMENT_RARITY = {1: "Silver", 2: "Gold", 3: "Prismatic"}

_ROMAN = {"I": 1, "II": 2, "III": 3}
_ICON_ROMAN = re.compile(r"[_-](I{1,3})$")
_ICON_ARABIC = re.compile(r"([123])$")
_NAME_ROMAN = re.compile(r"\s(I{1,3})$")


_FAMILY_SUFFIX = re.compile(r"(\s+I{1,3}|\++)$")


def _augment_family(name: str) -> str:
    """Strip the tier marker so variants of one augment group together.

    "Exiles I"/"Exiles II" and "Heroic Grab Bag"/"+"/"++" are the same augment
    at different rarities. Applied repeatedly because a name can carry both
    forms ("Band of Thieves II++").
    """
    prev = None
    while prev != name:
        prev = name
        name = _FAMILY_SUFFIX.sub("", name).strip()
    return name


def _augment_rarity(entry: dict) -> int | None:
    stem = (entry.get("icon") or "").split("/")[-1].rsplit(".", 1)[0]
    m = _ICON_ROMAN.search(stem)
    if m:
        return _ROMAN[m.group(1)]
    m = _ICON_ARABIC.search(stem)
    if m:
        return int(m.group(1))
    m = _NAME_ROMAN.search(entry.get("name") or "")
    if m:
        return _ROMAN[m.group(1)]
    return None


def _fetch_cdragon_items() -> dict[str, dict]:
    """{apiName: {name, desc, effects, composition}} for every TFT item CDragon
    knows about, across all sets (a component like B.F. Sword is set-agnostic,
    and a composition list may reference it regardless of what set is live)."""
    raw = _fetch_cdragon_raw()
    out = {}
    for it in raw.get("items", []):
        api_name = it.get("apiName")
        if not api_name or it.get("isAugment"):
            continue
        out[api_name] = {
            "name": it.get("name"),
            "desc": it.get("desc") or "",
            "effects": it.get("effects") or {},
            "composition": it.get("composition") or [],
            "icon": it.get("icon"),
        }
    return out


def _fmt_stat(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.2f}".rstrip("0").rstrip(".")


def render_description(desc: str, effects: dict) -> str:
    """Turn a CDragon description template into plain, readable text."""
    text = desc.replace("<br>", "\n").replace("<br/>", "\n")
    text = _KEYWORD_BLOCK.sub("", text)   # unresolvable glossary transclusions
    text = _TAG.sub("", text)             # <TFTKeyword>, <tftitemrules>, etc.
    text = _ICON_TOKEN.sub("", text)      # %i:scaleAD% inline-icon markers

    def sub(m: re.Match) -> str:
        field_match = _SIMPLE_FIELD.match(m.group(1))
        if not field_match:
            return ""
        field, mult = field_match.groups()
        val = effects.get(field)
        if val is None:
            return ""
        if mult:
            val = val * float(mult)
        return _fmt_stat(val)

    text = _STAT_TOKEN.sub(sub, text)

    # Tidy up after the substitutions. Riot's templates pair a value with a
    # scaling icon -- "@ModifiedDamage@&nbsp;(%i:scaleAP%)" -- and champion
    # abilities reference computed values that aren't in the variables table
    # at all, so stripping those leaves behind entity escapes, hollow "()"
    # pairs and doubled spaces. Without this the text reads
    # "dealing  () bonus true damage".
    text = html.unescape(text).replace("\xa0", " ")
    text = _EMPTY_PARENS.sub("", text)
    text = _MULTI_SPACE.sub(" ", text)
    text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
    return "\n".join(line.strip() for line in text.split("\n") if line.strip())


# Only the fixed set of "headline" stats TFT tooltips show as icon badges.
# Everything else in `effects` (HealthThreshold, ShieldDuration, ...) exists
# purely to be substituted into the passive-ability text, not shown standalone
# -- render_description() already inlines those, so listing them again here
# would just repeat the same number out of context.
#
# Riot's own data is inconsistent about scale for percent-based stats: some
# items store 35% as 0.35 (a fraction), others store it as 35.0 (already the
# percent number). PERCENT_STATS marks which keys are percent-based *in
# concept*; the <= 1 check below normalizes whichever scale Riot used for that
# particular item into one consistent display. AP, Armor, Health etc. are
# flat point values in TFT, not percentages, so they're deliberately excluded.
PERCENT_STATS = {"AD", "AS", "CritChance", "LifeSteal", "StatOmnivamp",
                  "DodgeChance", "BonusPercentHP"}


def stat_rows(effects: dict) -> list[dict]:
    """[{key, label, value}] for the headline stats this item grants.

    `key` is the raw effect name (AD, Armor, ...) and is what the client keys
    its per-stat colours off -- label text is display copy and would break the
    colour mapping the moment it were reworded or localised.
    """
    rows = []
    for key in STAT_LABELS:
        val = effects.get(key)
        if val is None:
            continue
        pct = key in PERCENT_STATS
        display = val * 100 if pct and val <= 1 else val
        rows.append({"key": key, "label": STAT_LABELS[key],
                     "value": f"{_fmt_stat(display)}{'%' if pct else ''}"})
    return rows


def latest_version() -> str:
    return requests.get(f"{DDRAGON}/api/versions.json", timeout=15).json()[0]


def _fetch(version: str, filename: str, locale: str = "en_US") -> dict:
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / f"{version}_{locale}_{filename}"
    if cached.exists():
        return json.loads(cached.read_text())
    url = f"{DDRAGON}/cdn/{version}/data/{locale}/{filename}"
    data = requests.get(url, timeout=30).json()
    cached.write_text(json.dumps(data))
    return data


def load_all(version: str | None = None, locale: str = "en_US") -> dict:
    v = version or latest_version()
    return {
        "version": v,
        "augments": _fetch(v, "tft-augments.json", locale).get("data", {}),
        "champions": _fetch(v, "tft-champion.json", locale).get("data", {}),
        "traits": _fetch(v, "tft-trait.json", locale).get("data", {}),
        "items": _fetch(v, "tft-item.json", locale).get("data", {}),
        # Base League of Legends roster, keyed by simple champion id ("Fiora",
        # "MasterYi"). TFT champion art is set-specific and Data Dragon only
        # publishes the *current* set -- if the pipeline's TFT set number is
        # ahead of what Data Dragon has shipped (e.g. a brand-new set, or the
        # synthetic demo data), tft-champion.json won't have a matching entry.
        # This gives every unit a real, recognizable portrait as a fallback,
        # since nearly every TFT champion is a reskinned LoL champion sharing
        # the same underlying id.
        "lol_champions": _fetch(v, "champion.json", locale).get("data", {}),
    }


def prettify_id(raw_id: str) -> str:
    """Fallback for IDs Data Dragon hasn't published yet.
    'TFT17_Augment_RichGetRicher' -> 'Rich Get Richer'
    """
    s = re.sub(r"^TFT\d*_?(Augment_|Item_)?", "", raw_id)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", s)
    return s.replace("_", " ").strip()


class NameResolver:
    """Maps raw API IDs -> display names, with a graceful fallback."""

    def __init__(self, static: dict):
        self.static = static
        self._misses: set[str] = set()
        self._lol_by_lower = {k.lower(): k for k in static.get("lol_champions", {})}
        # Loaded lazily by item_icon() on the first Data Dragon miss; None
        # means "not attempted yet", {} means "attempted and unavailable".
        self._cdragon_items: dict[str, dict] | None = None

    def _lookup(self, table: str, raw_id: str) -> str:
        entry = self.static.get(table, {}).get(raw_id)
        if entry and entry.get("name"):
            return entry["name"]
        self._misses.add(f"{table}:{raw_id}")
        return prettify_id(raw_id)

    def augment(self, raw_id: str) -> str:
        return self._lookup("augments", raw_id)

    def champion(self, raw_id: str) -> str:
        return self._lookup("champions", raw_id)

    def item(self, raw_id: str) -> str:
        return self._lookup("items", raw_id)

    def trait(self, raw_id: str) -> str:
        return self._lookup("traits", raw_id)

    def item_icon(self, raw_id: str) -> str | None:
        """Item icon, falling back to Community Dragon.

        Data Dragon's tft-item.json doesn't cover every id the match API
        returns -- Riot keeps legacy internal names for some items (Giant
        Slayer ships as TFT_Item_MadredsBloodrazor, Sunfire Cape as
        TFT_Item_RedBuff) and drops others between sets. A miss here renders
        as a blank grey square in the UI, so fall through to CDragon, which
        carries the same ids with its own art.
        """
        icon = self.icon_url("items", raw_id)
        if icon:
            return icon
        if self._cdragon_items is None:
            try:
                self._cdragon_items = _fetch_cdragon_items()
            except Exception:
                self._cdragon_items = {}
        cd = self._cdragon_items.get(raw_id)
        return cdragon_asset(cd.get("icon")) if cd else None

    def icon_url(self, table: str, raw_id: str) -> str | None:
        entry = self.static.get(table, {}).get(raw_id)
        if not entry:
            return None
        folder = {"augments": "tft-augment", "champions": "tft-champion",
                  "items": "tft-item", "traits": "tft-trait"}[table]
        return f"{DDRAGON}/cdn/{self.static['version']}/img/{folder}/{entry['image']['full']}"

    def champion_portrait(self, raw_id: str) -> str | None:
        """Real champion square icon, falling back to the base LoL roster.

        TFT champion art (tft-champion.json) only exists for whatever set
        Data Dragon currently has published. When the pipeline's data is for
        a set Data Dragon doesn't have yet, fall back to the plain LoL
        champion square icon -- same character, always available, and far
        better than a blank tile.
        """
        icon = self.icon_url("champions", raw_id)
        if icon:
            return icon
        name = re.sub(r"^TFT\d*_", "", raw_id)
        key = self._lol_by_lower.get(name.lower())
        if not key:
            return None
        full = self.static["lol_champions"][key]["image"]["full"]
        return f"{DDRAGON}/cdn/{self.static['version']}/img/champion/{full}"

    @property
    def unresolved(self) -> list[str]:
        """Check this after a run -- a spike means Data Dragon lags the patch."""
        return sorted(self._misses)


def build_item_meta(resolver: NameResolver) -> dict[str, dict]:
    """Tooltip content for every item the pipeline knows an icon for: name,
    description, headline stats, and crafting recipe.

    Names and icons come from Data Dragon (via resolver, already the source
    of truth elsewhere in this app); description/stats/recipe come from
    Community Dragon, since Data Dragon's tft-item.json omits all three. A
    CDragon miss (rate-limited, network down, item not in their bundle yet)
    degrades that one item to icon-only rather than failing the whole build.
    """
    try:
        cdragon = _fetch_cdragon_items()
    except Exception:
        cdragon = {}

    # Union of both catalogues, not just Data Dragon's. Match data contains
    # items Data Dragon's tft-item.json never lists -- Radiant variants
    # (TFT5_Item_*Radiant), Artifacts, and set-specific items like Set 17's
    # Anima Squad tier-2s. Iterating Data Dragon alone left those with no name,
    # icon or description, so they surfaced in the UI as prettified ids
    # ("Anima Squad Item Tier2 Annihilator") with blank tooltips.
    out = {}
    for item_id in set(resolver.static.get("items", {})) | set(cdragon):
        entry = {
            "name": resolver.item(item_id),
            "icon": resolver.item_icon(item_id),
        }
        cd = cdragon.get(item_id)
        if cd and cd.get("name"):
            # CDragon is the better name source for anything Data Dragon lacks,
            # where resolver.item() can only fall back to prettifying the id.
            if item_id not in resolver.static.get("items", {}):
                entry["name"] = cd["name"]
        if cd:
            entry["description"] = render_description(cd["desc"], cd["effects"])
            entry["stats"] = stat_rows(cd["effects"])
            entry["recipe"] = [
                {"id": c, "name": resolver.item(c), "icon": resolver.item_icon(c)}
                for c in cd["composition"]
            ]
        out[item_id] = entry
    return out


# CDragon's per-champion `role` combines a damage type prefix (AD/AP/H, the
# last for "hybrid") with a combat archetype (Carry/Fighter/Tank/Caster/
# Reaper/Specialist). Data Dragon has neither -- tft-champion.json is name +
# icon only -- so this is CDragon-only data, joined onto the roster by the
# same "TFT17_..." apiName the match API uses. Bucket to the archetype and
# drop the damage-type prefix: players filtering "show me the tanks" don't
# care whether it's an AD or AP tank.
ROLE_GROUPS = {
    "Carry": "Carry", "Fighter": "Fighter", "Tank": "Tank",
    "Caster": "Caster", "Reaper": "Reaper", "Specialist": "Specialist",
}


def _role_group(raw_role: str | None) -> str | None:
    if not raw_role:
        return None
    for suffix, group in ROLE_GROUPS.items():
        if raw_role.endswith(suffix):
            return group
    return None


def build_trait_meta(resolver: NameResolver, set_number: int | str | None = None) -> dict[str, dict]:
    """Trait icons and breakpoints for the live set.

    Keyed by BOTH the internal apiName and the display name, pointing at the
    same record. The match API reports traits by apiName ("TFT17_AnimaSquad"),
    but a comp signature is built from whatever `name` the participant carried,
    and the demo generator uses display names -- so a single-keying scheme
    would leave one of the two callers unable to find an icon. Aliasing costs
    a few KB and removes the lookup problem entirely.

    `breakpoints` is [{units, style}] where style is Riot's tier ramp
    (1 bronze, 2 silver, 3 gold, 4 prismatic). The client picks the highest
    breakpoint a board actually hit to colour the badge the way the game does.
    """
    try:
        raw = _fetch_cdragon_raw()
    except Exception:
        raw = {}

    cd_traits = {t["apiName"]: t for t in live_set(raw, set_number).get("traits", [])
                 if t.get("apiName")}
    dd_traits = resolver.static.get("traits", {})

    out: dict[str, dict] = {}
    for api_name, cd in cd_traits.items():
        dd = dd_traits.get(api_name)
        name = (dd or {}).get("name") or cd.get("name")
        icon = resolver.icon_url("traits", api_name) or cdragon_asset(cd.get("icon"))
        breakpoints = sorted(
            ({"units": e["minUnits"], "style": e.get("style", 0)}
             for e in cd.get("effects", []) if e.get("minUnits")),
            key=lambda b: b["units"],
        )
        record = {"name": name, "icon": icon, "breakpoints": breakpoints,
                  "description": render_description(cd.get("desc") or "", {})}
        out[api_name] = record
        if name:
            out.setdefault(name, record)
    return out


def build_augment_meta(resolver: NameResolver, set_number: int | str | None = None) -> dict[str, dict]:
    """Every augment in the live set's pool -- name, icon, rarity, description
    and associated traits.

    This is the full catalogue (274 augments for Set 17), deliberately not
    limited to the ones the crawl happened to observe. A stats slice only
    contains augments that cleared the sample floor, so driving the augment
    list off the stats alone silently hides most of the game -- an augment you
    were just offered is missing precisely because it is rare. The client
    joins measured stats onto this and shows the rest as unmeasured.

    Note the pool spans past sets: TFT reuses augments, so a Set 17 lobby
    offers plenty of "TFT10_..."/"TFT11_..." ids. Reading setData's own
    augment list rather than filtering ids by set prefix is what keeps those.
    """
    try:
        raw = _fetch_cdragon_raw()
    except Exception:
        raw = {}

    pool = live_set(raw, set_number).get("augments") or []
    by_api = {i["apiName"]: i for i in raw.get("items", [])
              if i.get("isAugment") and i.get("apiName")}

    live = live_set(raw, set_number)
    champ_names = {c["name"]: c["apiName"] for c in live.get("champions", [])
                   if c.get("name") and c.get("traits")}
    trait_names = {t["name"]: t["apiName"] for t in live.get("traits", []) if t.get("name")}

    out = {}
    for aug_id in pool:
        entry = {
            "name": resolver.augment(aug_id),
            "icon": resolver.icon_url("augments", aug_id),
        }
        cd = by_api.get(aug_id)
        if cd:
            rank = _augment_rarity(cd)
            entry["rarity"] = AUGMENT_RARITY.get(rank)
            entry["rarity_rank"] = rank
            entry["description"] = render_description(cd.get("desc") or "", cd.get("effects") or {})
            entry["traits"] = cd.get("associatedTraits") or []
            if not entry["icon"]:
                entry["icon"] = cdragon_asset(cd.get("icon"))

        # What this augment is actually tied to. Riot publishes
        # associatedTraits for only 6 of the 274 augments in the pool, so the
        # rest is recovered by matching the effect text against the live set's
        # champion and trait names -- "Gain a Nasus" is an unambiguous
        # reference, and matching against an authoritative name list avoids the
        # guesswork a keyword heuristic would involve. Augments with no such
        # reference get nothing rather than an invented pairing.
        text = f"{entry.get('name') or ''} {entry.get('description') or ''}"
        entry["refs"] = {
            "champions": sorted({cid for name, cid in champ_names.items()
                                 if re.search(rf"\b{re.escape(name)}\b", text)}),
            "traits": sorted({tid for name, tid in trait_names.items()
                              if re.search(rf"\b{re.escape(name)}\b", text)}
                             | set(entry.get("traits") or [])),
        }
        out[aug_id] = entry

    # Tiered variants of the same augment ("Exiles I"/"Exiles II",
    # "Heroic Grab Bag"/"+"/"++"). Knowing the Silver you were offered has a
    # Prismatic version is real, useful context the effect text never states.
    families: dict[str, list[str]] = {}
    for aug_id, entry in out.items():
        families.setdefault(_augment_family(entry.get("name") or aug_id), []).append(aug_id)
    for aug_id, entry in out.items():
        fam = families.get(_augment_family(entry.get("name") or aug_id), [])
        entry["variants"] = sorted(a for a in fam if a != aug_id)
    return out


# Base stats worth surfacing, mapped to the same stat keys items use so one
# colour scheme covers both. CDragon also carries critChance/critMultiplier,
# which are identical across nearly the whole roster and so say nothing useful
# in a comparison view.
CHAMPION_STAT_KEYS = {
    "hp": "Health", "damage": "AD", "attackSpeed": "AS",
    "armor": "Armor", "magicResist": "MagicResist", "mana": "Mana",
}


def _ability_effects(variables: list[dict], star: int = 2) -> dict:
    """{name: value} for an ability's variables at one star level.

    CDragon stores each variable as a per-star array indexed from 0, so a
    2-star value is index 2 in practice (index 0 is an unused placeholder in
    Riot's data, index 1 is 1-star). Values that don't go that deep fall back
    to the last entry rather than dropping the variable.
    """
    out = {}
    for v in variables or []:
        name, values = v.get("name"), v.get("value") or []
        if not name or not values:
            continue
        out[name] = values[star] if star < len(values) else values[-1]
    return out


def build_champion_meta(resolver: NameResolver, set_number: int | str | None = None) -> dict[str, dict]:
    """The live set's playable roster -- name, portrait, cost, role, traits,
    base stats and ability text.

    Scoped to one set on purpose. CDragon's file spans every set ever shipped,
    so an unscoped roster is ~925 entries of mostly retired champions; a player
    browsing "the champions" means the ~63 they can actually be offered.

    Non-playable units (Training Dummy, the various PvE monsters, board props)
    have no traits and are filtered out on that basis -- they carry a cost and
    a role like real champions, so cost alone doesn't separate them.

    Name/portrait come from Data Dragon via the resolver, which already handles
    the case where Data Dragon lags a new set; CDragon's own name is the
    fallback so a champion Data Dragon hasn't published still reads correctly
    rather than as a prettified id.
    """
    try:
        raw = _fetch_cdragon_raw()
    except Exception:
        raw = {}

    out = {}
    for c in live_set(raw, set_number).get("champions", []):
        champ_id = c.get("apiName")
        if not champ_id or not c.get("traits"):
            continue

        known_to_ddragon = champ_id in resolver.static.get("champions", {})
        role = c.get("role")
        stats = c.get("stats") or {}
        entry = {
            "name": resolver.champion(champ_id) if known_to_ddragon else c.get("name"),
            "icon": resolver.champion_portrait(champ_id),
            "cost": c.get("cost"),
            "role": role,
            "role_group": _role_group(role),
            "traits": c.get("traits") or [],
            "stats": {
                key: round(stats[src], 2)
                for src, key in CHAMPION_STAT_KEYS.items()
                if stats.get(src) is not None
            },
        }

        ability = c.get("ability") or {}
        if ability.get("name"):
            entry["ability"] = {
                "name": ability["name"],
                "icon": cdragon_asset(ability.get("icon")),
                "description": render_description(
                    ability.get("desc") or "", _ability_effects(ability.get("variables"))),
            }
        out[champ_id] = entry
    return out


if __name__ == "__main__":
    # Requires network access to ddragon.leagueoflegends.com (no key needed).
    static = load_all()
    r = NameResolver(static)
    print(f"Data Dragon version {static['version']}")
    print(f"  {len(static['augments'])} augments, {len(static['champions'])} champions, "
          f"{len(static['traits'])} traits, {len(static['items'])} items")
    for k in list(static["augments"])[:5]:
        print(f"  {k} -> {r.augment(k)}")
