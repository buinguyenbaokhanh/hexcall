"""
Pluggable stats sources for the advisor front-end.

READ THIS BEFORE ADDING A THIRD-PARTY PROVIDER
----------------------------------------------
When I first sketched the roadmap I listed "use an existing stats provider" as
an easy alternative to self-aggregation. Having checked, that framing was too
optimistic and you should treat it with caution:

* The major TFT stats sites (MetaTFT, tactics.tools, TFT Academy, lolchess) do
  not publish an official public developer API. What exists are internal JSON
  endpoints their own front-ends call.
* MetaTFT's Terms of Service assert ownership over the data on their platform.
  Pulling their internal endpoints or a third-party scraper wrapper of them into
  a product you ship is a terms problem, and it is also a fragility problem --
  undocumented endpoints change without notice and take your app down with them.
* Riot's own policy adds a second layer: your product must be registered, and
  if you monetize it your content must be "transformative." Reselling another
  site's numbers is the opposite of transformative.

So the honest ordering is:

  1. RiotDerivedSource  -- your own aggregation. Slower to start, but it is
     yours, it is compliant, and the augment-conditional stats it produces are
     something the big sites mostly do not surface well. This is the moat.
  2. DataDragonSource   -- official static data (names, icons). Always use this.
  3. LicensedProviderSource -- only after you have written to a provider and
     been granted access in writing. Several of these sites are 1-2 person
     teams and are reachable; a partnership is realistic if you ask. The class
     below is a working adapter shell for when you have that.

Do not fill in option 3 by pointing it at an undocumented endpoint.
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import requests


class StatsSource(ABC):
    """Everything the recommender needs, regardless of where numbers come from."""

    @abstractmethod
    def comps(self) -> list[dict]:
        """[{id, name, avg_placement, top4_rate, play_rate, n, traits, carry}]"""

    @abstractmethod
    def augments(self) -> list[dict]:
        """[{id, name, avg_placement, top4_rate, play_rate, n}]"""

    @abstractmethod
    def augment_comp_pairs(self) -> list[dict]:
        """[{augment, comp, avg_placement, lift_vs_comp, n}]"""

    def meta(self) -> dict:
        return {}


class RiotDerivedSource(StatsSource):
    """Reads stats.json produced by aggregate.py. Your primary source."""

    def __init__(self, path: str | Path = "stats.json", resolver=None):
        self.data = json.loads(Path(path).read_text())
        self.resolver = resolver

    def _name(self, kind: str, raw: str) -> str:
        if not self.resolver:
            return raw
        return getattr(self.resolver, kind)(raw)

    def comps(self) -> list[dict]:
        out = []
        for sig, s in self.data["comps"].items():
            traits_part, _, carry = sig.partition(" :: ")
            out.append({
                "id": sig,
                "name": COMP_NAMES.get(sig) or _auto_comp_name(traits_part, carry, self.resolver),
                "traits": traits_part.split("_"),
                "carry": carry or None,
                **s,
            })
        return sorted(out, key=lambda c: c["avg_placement"])

    def augments(self) -> list[dict]:
        return sorted(
            [{"id": a, "name": self._name("augment", a), **s}
             for a, s in self.data["augments"].items()],
            key=lambda a: a["avg_placement"],
        )

    def augment_comp_pairs(self) -> list[dict]:
        return self.data["augment_comp_pairs"]

    def meta(self) -> dict:
        return {"sample_size": self.data["sample_size"],
                "baseline_placement": self.data["baseline_placement"],
                "source": "riot-api-self-aggregated"}


# Hand-curated overrides so your UI shows "Stargazer Xayah" instead of a raw
# trait signature. Community comp names shift every patch; keeping this as a
# small editable map is less work than trying to auto-generate good names.
COMP_NAMES: dict[str, str] = {
    # "Stargazer4_Vanguard2 :: TFT17_Xayah": "Stargazer Xayah",
}


# Display names for patches, keyed by the client build the match API reports.
#
# The API gives no TFT patch number. Every match carries the LEAGUE client
# build in game_version ("Linux Version 16.16.804.9184") plus the set number,
# and nothing else -- so a build is all this pipeline can key on, and 16.16 is
# what it can honestly call the patch.
#
# Players do not use that number. TFT sites and the game itself label the same
# patch by its TFT number, which is what someone comparing this site against
# MetaTFT will be holding in their head. There is no derivation available: the
# TFT number is not in the payload, and it is not a clean function of the build
# (MetaTFT showed 17.9 across both 16.15 and 16.16), so guessing a mapping in
# code would be wrong the moment either side moved.
#
# Hence a hand-edited map, the same treatment COMP_NAMES gets and for the same
# reason: a human reads it off the client once per patch. Unmapped builds fall
# back to the build number, which is accurate if unfamiliar rather than wrong.
PATCH_NAMES: dict[str, str] = {
    # "16.16": "17.9",
}


def _auto_comp_name(traits_part: str, carry: str, resolver) -> str:
    head = traits_part.split("_")[0]
    head = "".join(ch for ch in head if not ch.isdigit())
    if carry and resolver:
        return f"{head} {resolver.champion(carry)}"
    return head or "Unnamed comp"


class LicensedProviderSource(StatsSource):
    """Adapter shell for a provider feed you have WRITTEN PERMISSION to use.

    Set PROVIDER_BASE_URL and PROVIDER_API_KEY once you have an agreement.
    Map their field names in _normalize(). Leaving this unconfigured is the
    correct default state.
    """

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = base_url or os.environ.get("PROVIDER_BASE_URL")
        self.api_key = api_key or os.environ.get("PROVIDER_API_KEY")
        if not self.base_url:
            raise RuntimeError(
                "No licensed provider configured. Use RiotDerivedSource until you "
                "have written permission from a stats provider -- see the module "
                "docstring before wiring anything else in here."
            )
        self.session = requests.Session()
        if self.api_key:
            self.session.headers["Authorization"] = f"Bearer {self.api_key}"

    def _get(self, path: str, **params) -> Any:
        r = self.session.get(f"{self.base_url}{path}", params=params, timeout=20)
        r.raise_for_status()
        return r.json()

    @staticmethod
    def _normalize(row: dict) -> dict:
        """Providers use different field names; normalize to our schema here."""
        return {
            "id": row.get("id") or row.get("comp_id") or row.get("name"),
            "name": row.get("name"),
            "avg_placement": row.get("avg_placement") or row.get("avgPlacement"),
            "top4_rate": row.get("top4_rate") or row.get("top4"),
            "play_rate": row.get("play_rate") or row.get("pick_rate"),
            "n": row.get("n") or row.get("count") or row.get("games"),
        }

    def comps(self) -> list[dict]:
        return [self._normalize(r) for r in self._get("/comps")]

    def augments(self) -> list[dict]:
        return [self._normalize(r) for r in self._get("/augments")]

    def augment_comp_pairs(self) -> list[dict]:
        return self._get("/augment-comp-pairs")

    def meta(self) -> dict:
        return {"source": "licensed-provider", "base_url": self.base_url}


class FallbackSource(StatsSource):
    """Try sources in order; first one that works wins. Lets you ship on the
    provider feed while your own crawl builds up volume, or vice versa."""

    def __init__(self, *sources: StatsSource):
        self.sources = sources

    def _first(self, method: str):
        errors = []
        for s in self.sources:
            try:
                result = getattr(s, method)()
                if result:
                    return result
            except Exception as e:  # noqa: BLE001
                errors.append(f"{type(s).__name__}: {e}")
        raise RuntimeError(f"all sources failed for {method}: {errors}")

    def comps(self):
        return self._first("comps")

    def augments(self):
        return self._first("augments")

    def augment_comp_pairs(self):
        return self._first("augment_comp_pairs")
