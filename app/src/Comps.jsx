import React, { useMemo, useState, useEffect } from "react";
import { Search, ChevronDown, ChevronUp, Swords, Loader2, Copy, Check } from "lucide-react";
import { UnitsPane, ItemsPane, TraitsPane, StatsPane } from "./CompPanes.jsx";
import { ChampionIcon, ItemIcon, carryIdFromSig } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";
import { assignTiers, TierBadge, TIER_COLORS } from "./tiers.jsx";

const TIERS = ["S", "A", "B", "C", "D"];

// Star colour follows the game's rarity ramp, so 3-star reroll units stand out
// from the 2-star standard board at a glance.
const STAR_COLOR = { "1": "#9FB0C4", "2": "#F0B429", "3": "#8FE3D2" };

/**
 * Copies the comp's in-game Team Planner share code, so a player can paste the
 * board into the client instead of adding ten units by hand.
 *
 * Uses navigator.clipboard where available and falls back to a hidden textarea
 * plus execCommand -- the async Clipboard API is unavailable on insecure
 * origins, which includes the http://localhost dev server this is used from.
 */
export function TeamCodeButton({ code, className = "" }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;

  const copy = async (e) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button onClick={copy} title="Copy the in-game Team Planner code"
            className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border transition-colors ${className}`}
            style={{
              borderColor: copied ? "var(--signal)" : "var(--line)",
              color: copied ? "var(--signal)" : "var(--dim)",
              background: copied ? "color-mix(in srgb, var(--signal) 12%, transparent)" : "transparent",
            }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Team code"}
    </button>
  );
}

function Unit({ u, itemMeta, size = 30 }) {
  return (
    <span className="flex flex-col items-center gap-[2px]" style={{ width: size + 8 }}>
      {u.star && (
        <span className="mono text-[8px] leading-none font-bold" style={{ color: STAR_COLOR[u.star] }}>
          {"★".repeat(Number(u.star) || 2)}
        </span>
      )}
      <span className="rounded-full p-[1.5px]"
            style={{ border: `1.5px solid ${u.carry ? "var(--accent)" : "transparent"}` }}>
        <ChampionIcon src={u.icon} name={u.name} size={size} />
      </span>
      <span className="flex gap-[1px] h-[12px]">
        {(u.items || []).slice(0, 3).map((id, i) => (
          <ItemIcon key={i} src={u.item_icons?.[i]} name={id} size={11} meta={itemMeta?.[id]} />
        ))}
      </span>
      <span className="text-[8.5px] truncate w-full text-center leading-tight"
            style={{ color: u.carry ? "var(--accent)" : "var(--dim)" }}>
        {u.name}
      </span>
    </span>
  );
}

const SORTS = {
  placement: { label: "Avg placement", fn: (a, b) => a.avg_placement - b.avg_placement },
  top4:      { label: "Top 4 rate",    fn: (a, b) => b.top4_rate - a.top4_rate },
  win:       { label: "Win rate",      fn: (a, b) => b.win_rate - a.win_rate },
  play:      { label: "Play rate",     fn: (a, b) => b.play_rate - a.play_rate },
  sample:    { label: "Sample size",   fn: (a, b) => b.n - a.n },
};

/**
 * Playstyle from the finishing-level distribution, so the label is measured
 * rather than an author's opinion. Reroll boards stop low and 3-star; standard
 * boards level to 8; fast boards reach 9.
 */
function playstyle(c) {
  const levels = c.levels || [];
  if (!levels.length) return null;
  const modal = levels.reduce((a, b) => (b.pct > a.pct ? b : a));
  if (modal.level >= 9) return { key: "fast9", label: "Fast 9" };
  if (modal.level <= 7) return { key: "reroll", label: `Reroll ${modal.level}` };
  return { key: "standard", label: "Level 8" };
}

/**
 * Inline detail, in place of a modal — the reference expands the row, which
 * keeps the rest of the tier list visible while you read one comp.
 *
 * Sections cover what the match API supports. There is deliberately no
 * positioning board and no per-round "early boards with round win rate":
 * tft-match-v1 returns one end-of-game snapshot with no coordinates and no
 * round timeline, so both would have to be fabricated. Sites that show them
 * collect it from a client-side overlay instead.
 */
function CompDetail({ comp, stats, traitMeta, itemMeta, onOpenComp, apiBase, staticMode, sliceId }) {
  const [pane, setPane] = useState("units");
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const counters = stats.comp_versus?.[comp.sig] || [];
  const contested = stats.comp_contested?.[comp.sig] || [];
  const slug = stats.comp_slugs?.[comp.sig];

  useEffect(() => {
    if (!slug || !sliceId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const url = staticMode ? `${apiBase}/comps/${sliceId}/${slug}.json`
                           : `${apiBase}/comp/${sliceId}/${slug}`;
    fetch(url).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setDoc(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, staticMode, sliceId, slug]);

  const view = doc?.base;
  const baseline = stats.baseline_placement;

  const panes = [
    ["units", "Units"], ["items", "Items"], ["traits", "Traits"],
    ["levels", "Levelling"],
    counters.length ? ["counters", "Matchups"] : null,
    ["stats", "Stats"],
  ].filter(Boolean);

  const peak = Math.max(...(comp.levels || []).map((l) => l.pct), 0.0001);

  return (
    <div className="border-t" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
      <div className="flex gap-1 px-3 pt-2 flex-wrap border-b" style={{ borderColor: "var(--line)" }}>
        {panes.map(([id, label]) => (
          <button key={id} onClick={() => setPane(id)}
                  className="text-[12px] px-3 py-1.5 border-b-2 transition-colors -mb-px"
                  style={{ borderColor: pane === id ? "var(--accent)" : "transparent",
                           color: pane === id ? "var(--text)" : "var(--dim)" }}>
            {label}
          </button>
        ))}
      </div>

      <div className="p-3.5">
        {loading && (
          <p className="flex items-center gap-2 text-[12px] py-4" style={{ color: "var(--dim)" }}>
            <Loader2 size={13} className="animate-spin" /> Loading detail
          </p>
        )}

        {!loading && !view && pane !== "counters" && pane !== "levels" && (
          <p className="text-[12px] py-4" style={{ color: "var(--dim)" }}>
            No detail document published for this comp yet.
          </p>
        )}

        {!loading && view && pane === "units" && <UnitsPane view={view} baseline={baseline} />}
        {!loading && view && pane === "items" && <ItemsPane view={view} itemMeta={itemMeta} baseline={baseline} />}
        {!loading && view && pane === "traits" && <TraitsPane view={view} traitMeta={traitMeta} baseline={baseline} />}
        {!loading && pane === "stats" && (
          <StatsPane view={view || {}} comp={comp} contested={contested} baseline={baseline} />
        )}

        {pane === "levels" && (
          <div>
            <div className="space-y-1">
              {(comp.levels || []).map((l) => (
                <div key={l.level} className="relative flex items-center gap-2.5 rounded-md px-2 py-1.5 overflow-hidden">
                  <span className="absolute inset-y-0 left-0 rounded-md"
                        style={{ width: `${(l.pct / peak) * 100}%`,
                                 background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent)" }} />
                  <span className="relative mono text-[12.5px] font-bold w-10" style={{ color: "var(--accent)" }}>
                    lv{l.level}
                  </span>
                  <span className="relative mono text-[11px] flex-1" style={{ color: "var(--dim)" }}>
                    {(l.pct * 100).toFixed(1)}% of boards
                  </span>
                  <span className="relative mono text-[13px] font-bold w-11 text-right">{l.avg}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--muted)" }}>
              Where players finished, not when they levelled. The match API has no round
              timeline, so stage-by-stage levelling and early-board win rates can't be measured
              from it.
            </p>
          </div>
        )}

        {pane === "counters" && (
          <div>
            <div className="space-y-1">
              {counters.map((r) => {
                const wr = r.win_rate * 100;
                const good = wr >= 50;
                return (
                  <button key={r.comp} onClick={() => {
                            const t = stats.comps[r.comp];
                            if (t) onOpenComp({ sig: r.comp, name: stats.comp_names?.[r.comp] || r.comp, ...t });
                          }}
                          className="w-full flex items-center gap-2.5 rounded-lg border px-2.5 py-2 row-hover"
                          style={{ borderColor: "var(--line)" }}>
                    <Swords size={13} className="shrink-0" style={{ color: good ? "var(--signal)" : "var(--danger)" }} />
                    <span className="text-[12px] flex-1 min-w-0 truncate text-left">
                      {stats.comp_names?.[r.comp] || r.comp}
                    </span>
                    <span className="mono text-[10.5px] shrink-0" style={{ color: "var(--muted)" }}>
                      {r.games} shared lobbies
                    </span>
                    <span className="mono text-[13px] font-bold w-12 text-right shrink-0"
                          style={{ color: good ? "var(--signal)" : "var(--danger)" }}>
                      {wr.toFixed(0)}%
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--muted)" }}>
              How often this comp finished ahead when both were in the same lobby. Unlike
              comparing two averages, these boards faced the same eight players.
            </p>
          </div>
        )}

        <button onClick={() => onOpenComp(comp)}
                className="mt-3 text-[11.5px] underline" style={{ color: "var(--dim)" }}>
          Open full build detail
        </button>
      </div>
    </div>
  );
}

export default function Comps({ stats, traitMeta, itemMeta, onOpenComp, apiBase, staticMode, sliceId }) {
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("placement");
  const [expanded, setExpanded] = useState(null);

  const rows = useMemo(() => {
    const raw = Object.entries(stats.comps || {}).map(([sig, c]) => ({
      sig,
      name: stats.comp_names?.[sig] || sig,
      carryIcon: stats.champion_icons?.[carryIdFromSig(sig)],
      style: playstyle(c),
      ...c,
    }));
    return assignTiers(raw, "avg_placement");
  }, [stats]);

  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const t of TIERS) c[t] = rows.filter((r) => r.tier === t).length;
    return c;
  }, [rows]);

  const styles = useMemo(() => {
    const seen = new Map();
    for (const r of rows) if (r.style) seen.set(r.style.key, r.style.label.replace(/ \d+$/, ""));
    return [...seen.entries()];
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tierFilter !== "all") out = out.filter((r) => r.tier === tierFilter);
    if (styleFilter !== "all") out = out.filter((r) => r.style?.key === styleFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q)
        || (r.board || []).some((u) => (u.name || "").toLowerCase().includes(q))
        || (r.traits || []).some((t) => (t.name || "").toLowerCase().includes(q)));
    }
    return [...out].sort(SORTS[sortBy].fn);
  }, [rows, tierFilter, styleFilter, query, sortBy]);

  const chip = (active, color) => ({
    borderColor: active ? color : "var(--line)",
    background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
    color: active ? "var(--text)" : "var(--dim)",
  });

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No comps cleared the sample floor in this slice yet. Crawl more matches and republish.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="display text-[15px] font-semibold">Compositions</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--dim)" }}>
            {rows.length} comps · click one for the full build, items and levelling
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-[10px]" style={{ color: "var(--dim)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search comp, unit or trait"
                   className="rounded pl-7 pr-2 py-2 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors w-60"
                   style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                  className="text-[12px] rounded px-2 py-2 border outline-none"
                  style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--muted)" }}>tier</span>
        <button onClick={() => setTierFilter("all")}
                className="text-[11.5px] px-2.5 py-1 rounded-full border transition-colors"
                style={chip(tierFilter === "all", "var(--text)")}>
          All <span className="mono opacity-60">{counts.all}</span>
        </button>
        {TIERS.filter((t) => counts[t] > 0).map((t) => (
          <button key={t} onClick={() => setTierFilter(t)}
                  className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border transition-colors"
                  style={chip(tierFilter === t, TIER_COLORS[t])}>
            <TierBadge tier={t} size="sm" />
            <span className="mono text-[11px]" style={{ color: "var(--dim)" }}>{counts[t]}</span>
          </button>
        ))}
      </div>

      {styles.length > 1 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--muted)" }}>plays like</span>
          <button onClick={() => setStyleFilter("all")}
                  className="text-[11.5px] px-2.5 py-1 rounded-full border transition-colors"
                  style={chip(styleFilter === "all", "var(--text)")}>All</button>
          {styles.map(([k, label]) => (
            <button key={k} onClick={() => setStyleFilter(k)}
                    className="text-[11.5px] px-2.5 py-1 rounded-full border transition-colors"
                    style={chip(styleFilter === k, "var(--accent)")}>{label}</button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((c) => {
          const open = expanded === c.sig;
          return (
          <div key={c.sig} className="rounded-lg border overflow-hidden"
               style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            {/* Accent rail: tier colour down the left edge, as in the reference */}
            <div className="flex">
              <span className="w-[3px] shrink-0" style={{ background: TIER_COLORS[c.tier] }} />
              <div className="flex-1 min-w-0 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1 shrink-0" style={{ width: 44 }}>
                    <TierBadge tier={c.tier} />
                    {c.style && (
                      <span className="text-[9px] px-1 py-[1px] rounded text-center leading-tight"
                            style={{ color: "var(--accent)",
                                     background: "color-mix(in srgb, var(--accent) 14%, transparent)" }}>
                        {c.style.label}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                      <span className="display text-[14px] font-medium">{c.name}</span>
                      {c.traits?.slice(0, 6).map((t) => (
                        <TraitBadge key={t.name} name={t.name} units={t.units}
                                    meta={traitMeta?.[t.name]} size={16} showName={false} />
                      ))}
                    </div>

                    {c.board?.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {c.board.map((u) => <Unit key={u.id} u={u} itemMeta={itemMeta} />)}
                      </div>
                    )}
                  </div>

                  {/* Numbers column */}
                  <div className="text-right shrink-0" style={{ width: 92 }}>
                    <p className="mono text-[19px] font-bold leading-none"
                       style={{ color: c.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                      {c.avg_placement.toFixed(2)}
                    </p>
                    <p className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: "var(--dim)" }}>
                      avg place
                    </p>
                    <p className="mono text-[14px] font-bold mt-2 leading-none" style={{ color: "var(--text)" }}>
                      {(c.play_rate * 100).toFixed(2)}
                    </p>
                    <p className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: "var(--dim)" }}>
                      pick rate
                    </p>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <TeamCodeButton code={c.team_code} />
                    <button onClick={() => setExpanded(open ? null : c.sig)}
                            className="p-1 rounded row-hover" aria-label="Toggle detail">
                      {open ? <ChevronUp size={15} style={{ color: "var(--dim)" }} />
                            : <ChevronDown size={15} style={{ color: "var(--dim)" }} />}
                    </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap mono text-[10.5px] mt-2"
                     style={{ color: "var(--dim)" }}>
                  <span>{(c.top4_rate * 100).toFixed(0)}% top4</span>
                  <span>{(c.win_rate * 100).toFixed(1)}% first</span>
                  <span>n={c.n.toLocaleString()}</span>
                  {c.stderr && <span style={{ color: "var(--muted)" }}>±{(c.stderr * 1.96).toFixed(2)}</span>}
                </div>
              </div>
            </div>

            {open && (
              <CompDetail comp={c} stats={stats} traitMeta={traitMeta} itemMeta={itemMeta}
                          onOpenComp={onOpenComp} apiBase={apiBase}
                          staticMode={staticMode} sliceId={sliceId} />
            )}
          </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-[12px] py-10 text-center" style={{ color: "var(--dim)" }}>
            Nothing matches this filter.
          </p>
        )}
      </div>
    </div>
  );
}
