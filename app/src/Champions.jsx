import React, { useMemo, useState } from "react";
import { Search, ChevronDown, ChevronUp } from "lucide-react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { assignTiers, TierBadge } from "./tiers.jsx";
import { StatGrid } from "./stats.jsx";
import { TraitChip } from "./TraitBadge.jsx";

const ROLE_ORDER = ["Carry", "Fighter", "Tank", "Caster", "Reaper", "Specialist"];
const ROLE_COLORS = {
  Carry: "#FF7043", Fighter: "#FFCA3A", Tank: "#C98B5E",
  Caster: "#B57BEE", Reaper: "#F472B6", Specialist: "#38BDF8",
};
// TFT's own cost-tier colours -- players read gold/purple/blue/green/grey as
// 5/4/3/2/1 cost straight from the shop, so reusing that needs no legend.
const COST_COLORS = { 1: "#9FB0C4", 2: "#3FBF6F", 3: "#4FA3F7", 4: "#B571F0", 5: "#F0B429" };

const SORTS = {
  placement: { label: "Placement", fn: (a, b) => a.avg_placement - b.avg_placement },
  playrate: { label: "Play rate", fn: (a, b) => (b.play_rate || 0) - (a.play_rate || 0) },
  cost: { label: "Cost", fn: (a, b) => (a.cost ?? 9) - (b.cost ?? 9) },
  name: { label: "Name", fn: (a, b) => a.name.localeCompare(b.name) },
};

function CostBadge({ cost }) {
  if (!cost) return null;
  const color = COST_COLORS[cost];
  return (
    <span className="mono text-[11px] font-bold px-1.5 py-[1px] rounded shrink-0"
          style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {cost}g
    </span>
  );
}

function BuildRow({ build, itemMeta, baseline, best }) {
  const good = build.avg_placement < baseline;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 border"
         style={{ borderColor: best ? "color-mix(in srgb, var(--signal) 40%, transparent)" : "var(--line)",
                  background: best ? "color-mix(in srgb, var(--signal) 6%, transparent)" : "transparent" }}>
      <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
        {build.items.map((id, i) => (
          <ItemIcon key={i} src={build.icons?.[i]} name={build.names?.[i] || id} size={28}
                    meta={itemMeta[id]} />
        ))}
      </span>
      <span className="mono text-[12.5px] shrink-0" style={{ color: good ? "var(--signal)" : "var(--text)" }}>
        {build.avg_placement.toFixed(2)}
        <span className="text-[10px] ml-1" style={{ color: "var(--faint)" }}>n={build.n}</span>
      </span>
    </div>
  );
}

/**
 * The components you need to hold to build the recommended set.
 *
 * This is the closest honest answer to "what should I take on carousel":
 * tft-match-v1 returns one end-of-game snapshot with no round timeline, so
 * *when* a component was picked up genuinely cannot be measured from it. What
 * can be measured is which components the best-performing build consumes, and
 * how often each is needed -- which is the information a carousel decision
 * actually turns on.
 */
function ComponentPriority({ build, itemMeta }) {
  const counts = new Map();
  for (const id of build.items) {
    for (const c of itemMeta[id]?.recipe || []) {
      const prev = counts.get(c.id) || { ...c, n: 0 };
      counts.set(c.id, { ...prev, n: prev.n + 1 });
    }
  }
  const components = [...counts.values()].sort((a, b) => b.n - a.n);
  if (components.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {components.map((c) => (
        <span key={c.id} className="flex items-center gap-1.5 rounded border px-2 py-1"
              style={{ borderColor: "var(--line)" }}>
          <ItemIcon src={c.icon} name={c.name} size={22} meta={itemMeta[c.id]} />
          <span className="text-[11px]" style={{ color: "var(--dim)" }}>{c.name}</span>
          {c.n > 1 && (
            <span className="mono text-[10.5px] font-bold" style={{ color: "var(--accent)" }}>×{c.n}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Champion roster.
 *
 * Rows come from the published champion catalogue (the live set's playable
 * roster) with measured stats joined on. Cost, role, traits, base stats and
 * ability text are set reference data and are always present; placement and
 * item builds only exist for champions the crawl saw enough of, so those
 * degrade individually rather than emptying the tab.
 */
export default function Champions({ stats, championMeta, itemMeta, traitMeta = {} }) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [costFilter, setCostFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("placement");
  const [expanded, setExpanded] = useState(() => new Set());

  const { rows, measuredCount } = useMemo(() => {
    const catalog = championMeta || {};
    const ids = new Set([...Object.keys(catalog), ...Object.keys(stats.champions || {})]);

    const measured = [];
    const unmeasured = [];
    for (const id of ids) {
      const meta = catalog[id] || {};
      const s = stats.champions?.[id];
      const row = {
        id,
        name: meta.name || stats.champion_names?.[id] || id,
        icon: meta.icon || stats.champion_icons?.[id],
        cost: meta.cost,
        role: meta.role_group,
        traits: meta.traits || [],
        baseStats: meta.stats,
        ability: meta.ability,
        builds: stats.unit_items?.[id] || [],
        comps: stats.champion_comps?.[id] || [],
        ...(s || {}),
        measured: Boolean(s),
      };
      (s ? measured : unmeasured).push(row);
    }
    return { rows: [...assignTiers(measured, "avg_placement"), ...unmeasured],
             measuredCount: measured.length };
  }, [stats, championMeta]);

  const filtered = useMemo(() => {
    let out = rows;
    if (roleFilter !== "all") out = out.filter((r) => r.role === roleFilter);
    if (costFilter !== "all") out = out.filter((r) => r.cost === costFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) =>
        r.name.toLowerCase().includes(q) || r.traits.some((t) => t.toLowerCase().includes(q)));
    }
    return [...out].sort((a, b) => {
      if (a.measured !== b.measured) return a.measured ? -1 : 1;
      if (!a.measured) return (a.cost ?? 9) - (b.cost ?? 9) || a.name.localeCompare(b.name);
      return SORTS[sortBy].fn(a, b);
    });
  }, [rows, roleFilter, costFilter, query, sortBy]);

  const toggle = (id) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const chip = (active, color) => ({
    borderColor: active ? color : "var(--line)",
    background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
    color: active ? "var(--text)" : "var(--dim)",
  });

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No champion data published yet. Re-run the crawl and publish step.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="display text-[15px] font-semibold">Champions</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--dim)" }}>
            {rows.length} in the set · {measuredCount} with enough games to rank in this slice
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-[10px]" style={{ color: "var(--dim)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search name or trait"
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

      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--faint)" }}>role</span>
        <button onClick={() => setRoleFilter("all")}
                className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
                style={chip(roleFilter === "all", "var(--text)")}>
          All
        </button>
        {ROLE_ORDER.map((r) => (
          <button key={r} onClick={() => setRoleFilter(r)}
                  className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
                  style={chip(roleFilter === r, ROLE_COLORS[r])}>
            <span className="w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[r] }} />
            {r}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--faint)" }}>cost</span>
        <button onClick={() => setCostFilter("all")}
                className="text-[11.5px] px-2.5 py-1 rounded-full border transition-colors"
                style={chip(costFilter === "all", "var(--text)")}>
          All
        </button>
        {[1, 2, 3, 4, 5].map((c) => (
          <button key={c} onClick={() => setCostFilter(c)}
                  className="mono text-[11.5px] font-bold px-2.5 py-1 rounded-full border transition-colors"
                  style={chip(costFilter === c, COST_COLORS[c])}>
            <span style={{ color: costFilter === c ? COST_COLORS[c] : "var(--dim)" }}>{c}g</span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {filtered.map((c) => {
          const isOpen = expanded.has(c.id);
          const best = c.builds[0];
          return (
            <div key={c.id} className="rounded-lg border overflow-hidden"
                 style={{ background: "var(--surface)", borderColor: "var(--line)",
                          opacity: c.measured ? 1 : 0.72 }}>
              <button onClick={() => toggle(c.id)}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-3 row-hover">
                {c.measured ? <TierBadge tier={c.tier} /> : <span className="w-7 h-7 shrink-0" />}
                <span className="shrink-0 rounded-full p-[2px]"
                      style={{ border: `1.5px solid ${COST_COLORS[c.cost] || "var(--line)"}` }}>
                  <ChampionIcon src={c.icon} name={c.name} size={34} />
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[13.5px] font-medium truncate">{c.name}</span>
                      <CostBadge cost={c.cost} />
                      {c.role && (
                        <span className="text-[10px] px-1.5 py-[1px] rounded shrink-0"
                              style={{ color: ROLE_COLORS[c.role],
                                       background: `color-mix(in srgb, ${ROLE_COLORS[c.role]} 16%, transparent)` }}>
                          {c.role}
                        </span>
                      )}
                    </span>
                    {c.measured ? (
                      <span className="mono text-[17px] font-bold shrink-0"
                            style={{ color: c.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                        {c.avg_placement.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[10.5px] shrink-0" style={{ color: "var(--faint)" }}>
                        no games this slice
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2.5 min-w-0 flex-wrap">
                      {c.traits.map((t) => (
                        <TraitChip key={t} name={t} meta={traitMeta[t]} />
                      ))}
                    </span>
                    {c.measured && (
                      <span className="mono text-[10.5px] shrink-0" style={{ color: "var(--dim)" }}>
                        {(c.top4_rate * 100).toFixed(0)}% top4 · {(c.play_rate * 100).toFixed(1)}% played · n={c.n.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {isOpen
                  ? <ChevronUp size={14} className="shrink-0" style={{ color: "var(--faint)" }} />
                  : <ChevronDown size={14} className="shrink-0" style={{ color: "var(--faint)" }} />}
              </button>

              {/* Collapsed: just the best build, the one thing you usually want */}
              {!isOpen && best && (
                <div className="px-3 pb-2.5 pl-[84px] flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: "var(--faint)" }}>
                    best items
                  </span>
                  <span className="flex items-center gap-1">
                    {best.items.map((id, i) => (
                      <ItemIcon key={i} src={best.icons?.[i]} name={best.names?.[i] || id} size={22}
                                meta={itemMeta[id]} />
                    ))}
                  </span>
                  <span className="mono text-[11px]" style={{ color: "var(--dim)" }}>
                    {best.avg_placement.toFixed(2)}
                  </span>
                </div>
              )}

              {isOpen && (
                <div className="px-3 pb-3.5 pl-[84px] space-y-3.5">
                  {/* Recommended items first -- the question people open a
                      champion to answer. */}
                  {c.builds.length > 0 ? (
                    <>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                          recommended items <span className="normal-case tracking-normal">· best first</span>
                        </p>
                        <div className="space-y-1.5">
                          {c.builds.slice(0, 5).map((b, i) => (
                            <BuildRow key={i} build={b} itemMeta={itemMeta}
                                      baseline={stats.baseline_placement} best={i === 0} />
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                          components to build it
                        </p>
                        <ComponentPriority build={c.builds[0]} itemMeta={itemMeta} />
                        <p className="text-[10px] mt-1.5 leading-snug" style={{ color: "var(--faint)" }}>
                          What the top build consumes — prioritise these on carousel. Riot's match API
                          returns one end-of-game snapshot with no round timeline, so the stage a
                          component was actually picked up can't be measured.
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11.5px]" style={{ color: "var(--faint)" }}>
                      No repeated item set on this unit in this data cut.
                    </p>
                  )}

                  {c.baseStats && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                        base stats <span className="normal-case tracking-normal">(1★)</span>
                      </p>
                      <StatGrid stats={c.baseStats} />
                    </div>
                  )}

                  {/* Which comps this unit actually gets played in */}
                  {c.comps?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                        played in
                      </p>
                      <div className="space-y-1">
                        {c.comps.map((cp) => (
                          <div key={cp.comp} className="flex items-center gap-2.5 rounded border px-2.5 py-1.5"
                               style={{ borderColor: "var(--line)" }}>
                            <span className="text-[12px] truncate flex-1 min-w-0">
                              {stats.comp_names?.[cp.comp] || cp.comp}
                            </span>
                            <span className="mono text-[10.5px] shrink-0" style={{ color: "var(--dim)" }}>
                              {(cp.share * 100).toFixed(0)}% of boards
                            </span>
                            <span className="mono text-[12.5px] shrink-0 w-10 text-right"
                                  style={{ color: cp.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                              {cp.avg_placement.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {c.ability && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                        ability
                      </p>
                      <div className="flex items-start gap-2.5">
                        {c.ability.icon && (
                          <img src={c.ability.icon} alt="" loading="lazy"
                               className="w-8 h-8 rounded border shrink-0"
                               style={{ borderColor: "var(--line)" }}
                               onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        )}
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium mb-0.5">{c.ability.name}</p>
                          <p className="text-[11.5px] leading-relaxed whitespace-pre-line"
                             style={{ color: "var(--dim)" }}>
                            {c.ability.description}
                          </p>
                        </div>
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
            Nothing matches this filter.
          </p>
        )}
      </div>
    </div>
  );
}
