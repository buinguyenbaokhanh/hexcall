import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ChampionIcon } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";
import { assignTiers, TierBadge } from "./tiers.jsx";

const SORTS = {
  placement: { label: "Best breakpoint", fn: (a, b) => a.avg_placement - b.avg_placement },
  playrate: { label: "Play rate", fn: (a, b) => (b.play_rate || 0) - (a.play_rate || 0) },
  name: { label: "Name", fn: (a, b) => a.name.localeCompare(b.name) },
};

/**
 * Trait browser.
 *
 * The unit of interest is the BREAKPOINT, not the trait: 4 of a trait and 6 of
 * it are different decisions with different payoffs, and a single average
 * across both hides which one is actually worth playing for. Each row is
 * therefore ranked by its best measured breakpoint and expands to show all of
 * them, plus the champions that carry the trait.
 */
export default function Traits({ stats, traitMeta, championMeta }) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("placement");
  const [openId, setOpenId] = useState(null);

  // Champions grouped by trait, from the champion catalogue rather than the
  // stats, so a trait shows its full roster even for units the crawl missed.
  const championsByTrait = useMemo(() => {
    const out = {};
    for (const [id, meta] of Object.entries(championMeta || {})) {
      for (const t of meta.traits || []) {
        (out[t] ||= []).push({ id, ...meta });
      }
    }
    for (const list of Object.values(out)) list.sort((a, b) => (a.cost ?? 9) - (b.cost ?? 9));
    return out;
  }, [championMeta]);

  const rows = useMemo(() => {
    const raw = Object.entries(stats.traits || {}).map(([name, breakpoints]) => {
      const best = breakpoints.reduce((a, b) => (b.avg_placement < a.avg_placement ? b : a));
      const meta = traitMeta?.[name] || {};
      return {
        id: name,
        name: meta.name || name,
        meta,
        breakpoints,
        best,
        avg_placement: best.avg_placement,
        play_rate: breakpoints.reduce((s, b) => s + (b.play_rate || 0), 0),
        n: breakpoints.reduce((s, b) => s + b.n, 0),
        champions: championsByTrait[meta.name || name] || championsByTrait[name] || [],
      };
    });
    return assignTiers(raw, "avg_placement");
  }, [stats, traitMeta, championsByTrait]);

  const filtered = useMemo(() => {
    let out = rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q));
    }
    return [...out].sort(SORTS[sortBy].fn);
  }, [rows, query, sortBy]);

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No trait stats in this snapshot. Re-run the crawl and publish step.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="display text-[15px] font-semibold">Traits</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--dim)" }}>
            {rows.length} synergies · ranked by their best-performing breakpoint
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-[10px]" style={{ color: "var(--dim)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search traits"
                   className="rounded pl-7 pr-2 py-2 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors w-52"
                   style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                  className="text-[12px] rounded px-2 py-2 border outline-none"
                  style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        {filtered.map((t) => {
          const isOpen = openId === t.id;
          const peak = Math.max(...t.breakpoints.map((b) => b.play_rate || 0), 0.0001);
          return (
            <div key={t.id} className="rounded-lg border overflow-hidden"
                 style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
              <button onClick={() => setOpenId(isOpen ? null : t.id)}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-3 row-hover">
                <TierBadge tier={t.tier} />
                <TraitBadge name={t.name} units={t.best.units} meta={t.meta} showName={false} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13.5px] font-medium truncate">{t.name}</span>
                    <span className="mono text-[17px] font-bold shrink-0"
                          style={{ color: t.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                      {t.avg_placement.toFixed(2)}
                    </span>
                  </div>
                  <p className="mono text-[10.5px] mt-0.5" style={{ color: "var(--dim)" }}>
                    best at {t.best.units} units · {t.breakpoints.length} measured breakpoint
                    {t.breakpoints.length === 1 ? "" : "s"} · n={t.n.toLocaleString()}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="px-3 pb-3.5 pl-[76px] space-y-3.5">
                  {t.meta?.description && (
                    <p className="text-[11.5px] leading-relaxed whitespace-pre-line"
                       style={{ color: "var(--text)", opacity: 0.8 }}>
                      {t.meta.description}
                    </p>
                  )}

                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                      performance by breakpoint
                    </p>
                    <div className="space-y-1">
                      {t.breakpoints.map((b) => {
                        const isBest = b.units === t.best.units;
                        return (
                          <div key={b.units}
                               className="relative flex items-center gap-2.5 rounded-md px-2 py-1.5 overflow-hidden"
                               style={{ background: isBest ? "color-mix(in srgb, var(--signal) 8%, transparent)" : "transparent" }}>
                            <span className="absolute inset-y-0 left-0 rounded-md"
                                  style={{ width: `${((b.play_rate || 0) / peak) * 100}%`,
                                           background: "linear-gradient(90deg, var(--faint), transparent)" }} />
                            <span className="relative shrink-0">
                              <TraitBadge name={t.name} units={b.units} meta={t.meta} showName={false} size={20} />
                            </span>
                            <span className="relative mono text-[11px] flex-1" style={{ color: "var(--dim)" }}>
                              {(b.play_rate * 100).toFixed(1)}% of boards · n={b.n.toLocaleString()}
                            </span>
                            <span className="relative mono text-[11px] shrink-0" style={{ color: "var(--dim)" }}>
                              {(b.top4_rate * 100).toFixed(0)}% top4
                            </span>
                            <span className="relative mono text-[13px] font-bold w-11 text-right shrink-0"
                                  style={{ color: b.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                              {b.avg_placement.toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {t.champions.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                        champions with this trait
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {t.champions.map((c) => (
                          <span key={c.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1"
                                style={{ borderColor: "var(--line)" }}>
                            <ChampionIcon src={c.icon} name={c.name} size={22} />
                            <span className="text-[11.5px]">{c.name}</span>
                            {c.cost && (
                              <span className="mono text-[10px]" style={{ color: "var(--dim)" }}>{c.cost}g</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-[12px] py-10 text-center" style={{ color: "var(--dim)" }}>
            Nothing matches this search.
          </p>
        )}
      </div>
    </div>
  );
}
