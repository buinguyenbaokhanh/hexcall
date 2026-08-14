import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ChampionIcon } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";
import { assignTiers, TierBadge } from "./tiers.jsx";
import { PageHeader, SegmentedToggle, StatTable, Place, PlaceChange, Frequency, pct } from "./table.jsx";

/**
 * Breakpoints are disjoint -- the pipeline records a board once, at the tier it
 * actually reached -- so the overall number for a trait is the sample-weighted
 * mean across them, not an unweighted average of the tier numbers. A trait with
 * a strong 6-piece played 40 times and a mediocre 2-piece played 4,000 times is
 * a mediocre trait overall, and averaging the tiers evenly would hide that.
 */
function overallOf(breakpoints) {
  const n = breakpoints.reduce((s, b) => s + b.n, 0) || 1;
  return {
    n,
    avg_placement: breakpoints.reduce((s, b) => s + b.avg_placement * b.n, 0) / n,
    win_rate: breakpoints.reduce((s, b) => s + (b.win_rate || 0) * b.n, 0) / n,
    top4_rate: breakpoints.reduce((s, b) => s + (b.top4_rate || 0) * b.n, 0) / n,
    play_rate: breakpoints.reduce((s, b) => s + (b.play_rate || 0), 0),
  };
}

/**
 * Trait tier list.
 *
 * Two readings, because the trait and the breakpoint are different decisions.
 * "Overall" answers whether the trait is worth playing at all; "by level"
 * splits each breakpoint into its own row, because 4 of a trait and 6 of it
 * cost different amounts and pay differently, and a single average across both
 * hides which one you should actually be building toward.
 */
export default function Traits({ stats, traitMeta, championMeta }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState("overall");
  const [sort, setSort] = useState({ key: "place", dir: "asc" });
  const [expanded, setExpanded] = useState(() => new Set());

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

  const traits = useMemo(() => {
    return Object.entries(stats.traits || {}).map(([name, breakpoints]) => {
      const meta = traitMeta?.[name] || {};
      const sorted = [...breakpoints].sort((a, b) => a.units - b.units);
      const best = sorted.reduce((a, b) => (b.avg_placement < a.avg_placement ? b : a));
      return {
        id: name,
        name: meta.name || name,
        meta,
        breakpoints: sorted,
        best,
        // Keyed by apiName, and the trend series collapses breakpoints, so the
        // same delta applies to every row the trait produces in either view.
        change: stats.place_change?.traits?.[name],
        ...overallOf(sorted),
        champions: championsByTrait[meta.name || name] || championsByTrait[name] || [],
      };
    });
  }, [stats, traitMeta, championsByTrait]);

  // Tiers are assigned within the view being shown: ranking a 6-piece against
  // other 6-pieces is a different comparison from ranking whole traits, and
  // carrying one view's tiers into the other would mislabel both.
  const rows = useMemo(() => {
    if (view === "overall") return assignTiers(traits, "avg_placement");
    const flat = traits.flatMap((t) =>
      t.breakpoints.map((b) => ({ ...t, ...b, id: `${t.id}@${b.units}`, units: b.units })));
    return assignTiers(flat, "avg_placement");
  }, [traits, view]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const toggle = (id) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const baseline = stats.baseline_placement;

  const columns = useMemo(() => {
    const cols = [
      {
        key: "trait", label: "Trait", sortFn: (a, b) => a.name.localeCompare(b.name),
        cell: (t) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <TraitBadge name={t.name} units={view === "overall" ? t.best.units : t.units}
                        meta={t.meta} showName={false} size={26} />
            <span className="text-[13px] font-medium truncate">{t.name}</span>
            {view === "level" && (
              <span className="mono text-[10.5px] shrink-0" style={{ color: "var(--dim)" }}>
                {t.units} piece
              </span>
            )}
          </div>
        ),
      },
      {
        key: "tier", label: "Tier", align: "center", width: 70,
        sortFn: (a, b) => a.avg_placement - b.avg_placement,
        cell: (t) => <TierBadge tier={t.tier} size="sm" />,
      },
      {
        key: "place", label: "Avg Place", align: "right", width: 110,
        sortFn: (a, b) => a.avg_placement - b.avg_placement,
        cell: (t) => <Place value={t.avg_placement} baseline={baseline} />,
      },
      {
        key: "change", label: "Change", align: "right", width: 95, defaultDir: "asc",
        sortFn: (a, b) => (a.change?.delta ?? 99) - (b.change?.delta ?? 99),
        cell: (t) => <PlaceChange change={t.change} />,
      },
      {
        key: "win", label: "Win Rate", align: "right", width: 100, defaultDir: "desc",
        sortFn: (a, b) => (a.win_rate || 0) - (b.win_rate || 0),
        cell: (t) => <span className="mono text-[12.5px]">{pct(t.win_rate)}</span>,
      },
    ];

    if (view === "overall") {
      cols.push({
        key: "levels", label: "Levels", align: "left", width: 150,
        cell: (t) => (
          <span className="flex items-center gap-1 flex-wrap">
            {t.breakpoints.map((b) => {
              const isBest = b.units === t.best.units && t.breakpoints.length > 1;
              return (
                <span key={b.units}
                      title={`${b.units} pieces · ${b.avg_placement.toFixed(2)} avg place`}
                      className="mono text-[11px] font-bold px-1.5 py-[1px] rounded"
                      style={{
                        color: isBest ? "var(--bg)" : "var(--dim)",
                        background: isBest ? "var(--signal)" : "var(--raised)",
                      }}>
                  {b.units}
                </span>
              );
            })}
          </span>
        ),
      });
    }

    cols.push({
      key: "freq", label: "Frequency", align: "right", width: 130, defaultDir: "desc",
      sortFn: (a, b) => (a.n || 0) - (b.n || 0),
      cell: (t) => <Frequency n={t.n} rate={t.play_rate} />,
    });

    return cols;
  }, [baseline, view]);

  if (traits.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No trait stats in this snapshot. Re-run the crawl and publish step.
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title="TFT Trait Tier List"
        blurb="Which synergies are carrying boards on this patch. Overall weights every breakpoint by how often it was actually hit; by level splits them out, since the highlighted breakpoint is the one worth building toward."
        sampleSize={stats.sample_size} generatedAt={stats.generated_at}>
        <p className="text-[11px] mt-1" style={{ color: "var(--faint)" }}>
          {traits.length} synergies measured in this slice
        </p>
      </PageHeader>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <SegmentedToggle value={view} onChange={setView}
                         options={[["overall", "Overall"], ["level", "By level"]]} />
        <div className="relative shrink-0">
          <Search size={12} className="absolute left-2.5 top-[9px]" style={{ color: "var(--dim)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search traits"
                 className="rounded pl-7 pr-2 py-1.5 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors w-52"
                 style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
        </div>
      </div>

      <StatTable
        columns={columns} rows={filtered} rowKey={(t) => t.id}
        sort={sort} onSortChange={setSort}
        expanded={expanded} onToggleRow={toggle}
        emptyMessage="Nothing matches this search."
        renderDetail={(t) => {
          const peak = Math.max(...t.breakpoints.map((b) => b.play_rate || 0), 0.0001);
          return (
            <div className="space-y-3.5 pt-2 max-w-2xl">
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
                              style={{ color: b.avg_placement < baseline ? "var(--signal)" : "var(--text)" }}>
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
          );
        }} />
    </div>
  );
}
