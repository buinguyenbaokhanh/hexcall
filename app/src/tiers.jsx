import React from "react";

// Shared tier-list convention (S/A/B/C/D) so augments, champions and comps
// read the same way at a glance instead of each tab inventing its own scale.
// Percentile-based rather than fixed placement cutoffs: it self-adjusts to
// whatever the current patch's spread actually looks like (a patch where
// everything clusters near the average still produces a usable S-D spread),
// and it matches the shape players already expect from other tier lists --
// a handful of S, more B, a handful of D.
const TIER_CUTOFFS = [
  ["S", 0.10], ["A", 0.30], ["B", 0.65], ["C", 0.88], ["D", 1.01],
];

export const TIER_COLORS = {
  S: "var(--accent)",
  A: "var(--signal)",
  B: "var(--text)",
  C: "var(--warn)",
  D: "var(--danger)",
};

// rows: array of objects with a numeric field where LOWER is better
// (TFT placement -- 1st is best). Returns a new array, same order, each
// row augmented with `tier`.
export function assignTiers(rows, key = "avg_placement") {
  const sorted = [...rows].sort((a, b) => a[key] - b[key]);
  const n = sorted.length || 1;
  const tierOf = new Map();
  sorted.forEach((r, i) => {
    const frac = (i + 1) / n;
    const tier = TIER_CUTOFFS.find(([, cutoff]) => frac <= cutoff)?.[0] || "D";
    tierOf.set(r, tier);
  });
  return rows.map((r) => ({ ...r, tier: tierOf.get(r) }));
}

export function TierBadge({ tier, size = "md" }) {
  if (!tier) return null;
  const dims = size === "sm" ? "w-5 h-5 text-[10.5px]" : "w-7 h-7 text-[13px]";
  const color = TIER_COLORS[tier] || "var(--dim)";
  return (
    <span
      className={`shrink-0 rounded-md flex items-center justify-center font-bold display ${dims}`}
      style={{ color: "var(--bg)", background: color }}
    >
      {tier}
    </span>
  );
}
