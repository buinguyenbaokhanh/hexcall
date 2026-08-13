/**
 * Does this augment fit this comp?
 *
 * WHY THIS EXISTS AND WHAT IT IS NOT
 * ----------------------------------
 * Riot's match API records no augments, so no augment win rate can be computed
 * from match data by anyone -- MetaTFT's augment statistics come from their
 * desktop overlay reading the game client, and their augment tier list is
 * hand-maintained by a pro player. There is no pipeline that recovers this.
 *
 * So this does NOT invent a win rate. It pairs two things that are each solid:
 *
 *   1. What the augment does  -- Riot's own effect text, parsed into type tags
 *                                and explicit champion/trait references.
 *   2. What the comp needs    -- measured from the crawl: the level it actually
 *                                finishes on, the units it actually 3-stars,
 *                                how many items its carry actually holds.
 *
 * The rule connecting them is the only inferred part, and every match carries
 * the reason so the UI can show "fits because this comp goes to level 9"
 * rather than a number that would imply precision nobody has.
 *
 * Comp RANKING remains measured placement. Fit decides which comps are worth
 * showing for your augment; it never invents how good they are.
 */

// Same cues the Augments tab uses to tag an augment's effect text.
const TYPE_RULES = [
  ["Econ",    /\bgold\b|interest|income|econom/i],
  ["Items",   /\bitem|component|anvil|emblem|artifact/i],
  ["Combat",  /damage|attack|health|armor|shield|heal|resist|crit/i],
  ["Scaling", /each round|per round|stacks|permanently|over time|grows/i],
  ["Reroll",  /reroll|refresh|shop odds|\brolls?\b/i],
  ["Level",   /\blevel|\bxp\b|experience/i],
];

export function augmentTypes(aug) {
  const text = `${aug?.name || ""} ${aug?.description || ""}`;
  return new Set(TYPE_RULES.filter(([, re]) => re.test(text)).map(([t]) => t));
}

// Weights: a direct reference to a unit or trait the comp actually plays is
// near-certain; a type match is a reasoned inference and scores lower.
const W_CHAMPION = 5;
const W_TRAIT = 4;
const W_TYPE = 2;

/**
 * @returns {{score:number, reasons:string[]}} — score 0 means no known link,
 * which is the honest answer for most augment/comp pairs.
 */
export function fitScore(aug, comp, { championNames = {}, traitNames = {} } = {}) {
  const p = comp?.profile;
  if (!aug || !p) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  // 1. The augment names a unit this comp actually fields.
  const champHits = (aug.refs?.champions || []).filter((c) => p.champion_ids?.includes(c));
  for (const c of champHits) {
    score += W_CHAMPION;
    reasons.push(`names ${championNames[c] || c}, who this comp plays`);
  }

  // 2. The augment names a trait this comp actually runs.
  const traitHits = (aug.refs?.traits || []).filter((t) => p.trait_ids?.includes(t));
  for (const t of traitHits) {
    score += W_TRAIT;
    reasons.push(`names ${traitNames[t] || t}, a trait this comp runs`);
  }

  // 3. Type-to-shape rules, each grounded on a measured comp characteristic.
  const types = augmentTypes(aug);

  if ((types.has("Econ") || types.has("Level")) && p.finish_level >= 9) {
    score += W_TYPE;
    reasons.push(`econ pays off — this comp reaches level ${p.finish_level}`);
  }
  if (types.has("Reroll") && p.reroll) {
    score += W_TYPE;
    reasons.push(`rerolling suits it — it 3-stars ${p.three_stars.join(", ")}`);
  }
  if (types.has("Items") && p.carry_items >= 3) {
    score += W_TYPE;
    reasons.push("its carry wants a full 3 items");
  }
  if (types.has("Combat") && p.finish_level <= 8 && !p.reroll) {
    score += 1;
    reasons.push("a board-strength augment suits a standard-level comp");
  }

  return { score, reasons };
}

/**
 * Rank comps for a set of augment picks.
 *
 * Ordering is by measured placement among comps that fit; fit decides
 * eligibility and is surfaced as reasoning, not folded into the number.
 */
export function rankComps(comps, augs, ctx) {
  return comps
    .map((comp) => {
      const per = augs.filter(Boolean).map((a) => ({ aug: a, ...fitScore(a, comp, ctx) }));
      const score = per.reduce((s, r) => s + r.score, 0);
      return { ...comp, fit: score, fitPer: per,
               reasons: per.flatMap((r) => r.reasons) };
    })
    .sort((a, b) => (b.fit - a.fit) || (a.avg_placement - b.avg_placement));
}

/**
 * What a second or third augment means for the comp you're already on.
 *
 * The default is reinforce. A pivot is only worth naming when the alternative
 * both fits better AND places better, and the cost is stated in the currency
 * the player actually pays -- placement, plus the items already committed.
 */
export function pivotAdvice(anchor, ranked, slot) {
  if (!anchor) return null;
  const best = ranked[0];
  const anchorNow = ranked.find((c) => c.sig === anchor.sig) || anchor;

  if (!best || best.sig === anchor.sig) {
    return { kind: "reinforce", anchor: anchorNow };
  }
  const gain = anchorNow.avg_placement - best.avg_placement;

  // Slot 3 (4-2) is too late: items and board are committed by then.
  if (slot >= 2 || gain <= 0.15) {
    return { kind: "hold", anchor: anchorNow, alternative: best, gain };
  }
  return { kind: "pivot", anchor: anchorNow, alternative: best, gain };
}
