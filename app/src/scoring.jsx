import React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Scoring: projected = comp.avg + Σ shrink(lift(augment, comp))
// ---------------------------------------------------------------------------

const SHRINKAGE_K = 150;
export const shrink = (lift, n) => lift * (n / (n + SHRINKAGE_K));

// TFT placements run 1..8. Everything visual is anchored to that axis rather
// than to an invented 0-100 score, because the axis is the thing players
// already reason in.
export const P_MIN = 1, P_MAX = 8;
export const pct = (p) => ((p - P_MIN) / (P_MAX - P_MIN)) * 100;

// The three augment slots, and the stage each is offered at.
export const SLOTS = [
  { slot: 0, stage: "2-1", label: "1st augment" },
  { slot: 1, stage: "3-2", label: "2nd augment" },
  { slot: 2, stage: "4-2", label: "3rd augment" },
];

export function buildIndex(stats) {
  const idx = new Map();
  for (const p of stats.augment_comp_pairs || []) idx.set(`${p.augment}|${p.comp}`, p);
  return idx;
}

/** (augment, slot, comp) lifts — the same augment priced by when it was taken. */
export function buildSlotIndex(stats) {
  const idx = new Map();
  for (const p of stats.augment_slot_pairs || []) idx.set(`${p.augment}|${p.slot}|${p.comp}`, p);
  return idx;
}

/**
 * Rank comps given the augments picked so far.
 *
 * `picks` is indexed by slot: [slot0, slot1, slot2], nulls for empty slots.
 * Each pick is priced with its SLOT-SPECIFIC lift where the sample supports
 * one, falling back to the slot-agnostic lift otherwise — an econ augment
 * taken at 2-1 compounds for six more rounds than the same augment at 4-2, so
 * pricing them identically would flatten a real difference. Contributions
 * record which source was used so the UI can be honest about it.
 */
export function evaluate(stats, pairIndex, slotIndex, picks) {
  const chosen = picks.map((id, slot) => ({ id, slot })).filter((p) => p.id);

  return Object.entries(stats.comps)
    .map(([sig, c]) => {
      const contributions = [];
      let delta = 0, minPairN = Infinity, missing = 0;

      for (const { id, slot } of chosen) {
        const slotPair = slotIndex.get(`${id}|${slot}|${sig}`);
        const pair = slotPair || pairIndex.get(`${id}|${sig}`);
        if (!pair) { missing += 1; continue; }
        const applied = shrink(pair.lift_vs_comp, pair.n);
        delta += applied;
        minPairN = Math.min(minPairN, pair.n);
        contributions.push({
          augment: id, slot,
          name: stats.augment_names?.[id] || id,
          rawLift: pair.lift_vs_comp, applied, n: pair.n,
          pairAvg: pair.avg_placement,
          slotSpecific: Boolean(slotPair),
        });
      }
      contributions.sort((a, b) => a.applied - b.applied);

      return {
        sig, name: stats.comp_names?.[sig] || sig, ...c,
        projected: c.avg_placement + delta, delta, contributions, missing,
        confidence:
          chosen.length === 0
            ? (c.n >= 2000 ? "high" : c.n >= 600 ? "medium" : "low")
            : minPairN === Infinity ? "none"
            : minPairN >= 800 ? "high" : minPairN >= 250 ? "medium" : "low",
      };
    })
    .sort((a, b) => a.projected - b.projected);
}

export const CONF = {
  high:   { label: "High confidence", color: "var(--signal)" },
  medium: { label: "Medium confidence", color: "var(--warn)" },
  low:    { label: "Low sample", color: "var(--dim)" },
  none:   { label: "No pair data", color: "var(--dim)" },
};

// --- The signature element -------------------------------------------------
// A comp's row IS the placement axis. Its baseline sits as a tick, its
// projected placement as a filled marker, and the gap between them is drawn
// as a moving bar. You read the meta as positions on a scale rather than as a
// column of decimals.

export function PlacementTrack({ base, projected, stderr, rank, shifted }) {
  const moved = Math.abs(projected - base) > 0.02;
  const better = projected < base;
  const lo = Math.min(base, projected), hi = Math.max(base, projected);
  const ciW = stderr ? (stderr * 1.96 * 2 / (P_MAX - P_MIN)) * 100 : 0;

  return (
    <div className="relative h-9 select-none" aria-hidden="true">
      <div className="absolute left-0 right-0 top-[18px] h-px bg-[var(--line)]" />
      {[2, 3, 4, 5, 6, 7].map((t) => (
        <div key={t} className="absolute top-[14px] h-[9px] w-px bg-[var(--line)]"
             style={{ left: `${pct(t)}%` }} />
      ))}
      <div className="absolute top-[8px] h-[21px] w-px"
           style={{ left: `${pct(4.5)}%`, background: "var(--dim)", opacity: 0.5 }} />

      {ciW > 0 && (
        <div className="absolute top-[16px] h-[5px] rounded-full"
             style={{ left: `${pct(projected) - ciW / 2}%`, width: `${ciW}%`,
                      background: "var(--faint)" }} />
      )}

      {moved && (
        <div className="absolute top-[17px] h-[3px] rounded-full transition-all duration-500"
             style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%`,
                      background: better ? "var(--signal)" : "var(--danger)", opacity: 0.35 }} />
      )}

      {moved && (
        <div className="absolute top-[12px] h-[13px] w-[2px] rounded"
             style={{ left: `${pct(base)}%`, background: "var(--dim)" }} />
      )}

      <div className="absolute top-[11px] transition-all duration-500"
           style={{ left: `${pct(projected)}%`, transform: "translateX(-50%)" }}>
        <div className="w-[15px] h-[15px] rotate-45 rounded-[3px] border-2"
             style={{
               borderColor: moved ? (better ? "var(--signal)" : "var(--danger)") : "var(--ink-3)",
               background: moved ? (better ? "var(--signal)" : "var(--danger)") : "var(--surface)",
               boxShadow: rank === 0 && shifted ? "0 0 14px var(--signal)" : "none",
             }} />
      </div>
    </div>
  );
}

export function AxisLegend({ className = "" }) {
  return (
    <div className={`relative h-4 ${className}`}>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
        <span key={t} className="absolute mono text-[9.5px] -translate-x-1/2"
              style={{ left: `${pct(t)}%`, color: t === 4 || t === 5 ? "var(--dim)" : "var(--faint)" }}>
          {t}
        </span>
      ))}
    </div>
  );
}

export function RankBadge({ index, moved }) {
  return (
    <div className="relative w-9 shrink-0 text-center">
      <span className="font-mono text-[19px] leading-none"
            style={{ color: index === 0 ? "var(--accent)" : "var(--dim)" }}>
        {index + 1}
      </span>
      {moved !== 0 && moved !== undefined && (
        <span className="flex items-center justify-center gap-[1px] text-[9px] mt-0.5 font-mono"
              style={{ color: moved > 0 ? "var(--signal)" : "var(--danger)" }}>
          {moved > 0 ? <ArrowUp size={8} /> : <ArrowDown size={8} />}{Math.abs(moved)}
        </span>
      )}
    </div>
  );
}
