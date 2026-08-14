import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { assignTiers, TierBadge } from "./tiers.jsx";
import { StatGrid } from "./stats.jsx";
import { TraitChip } from "./TraitBadge.jsx";
import {
  PageHeader, FilterChips, StatTable, Place, PlaceChange, Frequency, pct, COST_COLORS,
} from "./table.jsx";

const ROLE_ORDER = ["Carry", "Fighter", "Tank", "Caster", "Reaper", "Specialist"];
const ROLE_COLORS = {
  Carry: "#FF7043", Fighter: "#FFCA3A", Tank: "#C98B5E",
  Caster: "#B57BEE", Reaper: "#F472B6", Specialist: "#38BDF8",
};

function CostBadge({ cost }) {
  if (!cost) return null;
  const color = COST_COLORS[cost];
  return (
    <span className="mono text-[10.5px] font-bold px-1.5 py-[1px] rounded shrink-0"
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
        <span className="text-[10px] ml-1" style={{ color: "var(--muted)" }}>n={build.n}</span>
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
 * The individual items most often seen on a unit, regardless of what they were
 * paired with.
 *
 * The pipeline measures item *sets* -- the full three-slot build -- which is
 * the right unit for "what should I build", but the wrong one for a glance
 * down a tier list: a unit with its damage spread over four viable third items
 * looks itemless when only whole sets are counted. Summing each item's
 * appearances across every measured set recovers "this unit wants Blue Buff"
 * without losing the set detail, which is still there on expand.
 */
function popularItems(builds, limit = 5) {
  const counts = new Map();
  for (const b of builds) {
    b.items.forEach((id, i) => {
      const prev = counts.get(id) || { id, name: b.names?.[i] || id, icon: b.icons?.[i], n: 0 };
      counts.set(id, { ...prev, n: prev.n + b.n });
    });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}

/**
 * Unit tier list.
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
  const [sort, setSort] = useState({ key: "place", dir: "asc" });
  const [expanded, setExpanded] = useState(() => new Set());

  const { rows, measuredCount } = useMemo(() => {
    const catalog = championMeta || {};
    const ids = new Set([...Object.keys(catalog), ...Object.keys(stats.champions || {})]);

    const measured = [];
    const unmeasured = [];
    for (const id of ids) {
      const meta = catalog[id] || {};
      const s = stats.champions?.[id];
      const builds = stats.unit_items?.[id] || [];
      const row = {
        id,
        name: meta.name || stats.champion_names?.[id] || id,
        icon: meta.icon || stats.champion_icons?.[id],
        cost: meta.cost,
        role: meta.role_group,
        traits: meta.traits || [],
        baseStats: meta.stats,
        ability: meta.ability,
        builds,
        topItems: popularItems(builds),
        comps: stats.champion_comps?.[id] || [],
        change: stats.place_change?.units?.[id],
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
    return out;
  }, [rows, roleFilter, costFilter, query]);

  const toggle = (id) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const baseline = stats.baseline_placement;

  const columns = useMemo(() => [
    {
      key: "unit", label: "Unit", sortFn: (a, b) => a.name.localeCompare(b.name),
      cell: (c) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 rounded-full p-[2px]"
                style={{ border: `1.5px solid ${COST_COLORS[c.cost] || "var(--line)"}` }}>
            <ChampionIcon src={c.icon} name={c.name} size={30} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium truncate">{c.name}</span>
              <CostBadge cost={c.cost} />
              {c.role && (
                <span className="text-[9.5px] px-1.5 py-[1px] rounded shrink-0"
                      style={{ color: ROLE_COLORS[c.role],
                               background: `color-mix(in srgb, ${ROLE_COLORS[c.role]} 16%, transparent)` }}>
                  {c.role}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {c.traits.map((t) => <TraitChip key={t} name={t} meta={traitMeta[t]} />)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "tier", label: "Tier", align: "center", width: 70,
      sortFn: (a, b) => a.avg_placement - b.avg_placement,
      cell: (c) => (c.measured ? <TierBadge tier={c.tier} size="sm" /> : null),
    },
    {
      key: "place", label: "Avg Place", align: "right", width: 110,
      sortFn: (a, b) => a.avg_placement - b.avg_placement,
      cell: (c) => (c.measured
        ? <Place value={c.avg_placement} baseline={baseline} />
        : <span className="text-[10.5px]" style={{ color: "var(--muted)" }}>no games</span>),
    },
    {
      key: "change", label: "Change", align: "right", width: 95, defaultDir: "asc",
      sortFn: (a, b) => (a.change?.delta ?? 99) - (b.change?.delta ?? 99),
      cell: (c) => <PlaceChange change={c.change} />,
    },
    {
      key: "win", label: "Win Rate", align: "right", width: 100, defaultDir: "desc",
      sortFn: (a, b) => (a.win_rate || 0) - (b.win_rate || 0),
      cell: (c) => (c.measured
        ? <span className="mono text-[12.5px]">{pct(c.win_rate)}</span>
        : <span style={{ color: "var(--muted)" }}>—</span>),
    },
    {
      key: "freq", label: "Frequency", align: "right", width: 130, defaultDir: "desc",
      sortFn: (a, b) => (a.n || 0) - (b.n || 0),
      cell: (c) => (c.measured ? <Frequency n={c.n} rate={c.play_rate} /> : null),
    },
    {
      key: "items", label: "Popular Items", align: "right", width: 190,
      cell: (c) => (
        <span className="flex items-center gap-1 justify-end">
          {c.topItems.map((it) => (
            <ItemIcon key={it.id} src={it.icon} name={it.name} size={24} meta={itemMeta[it.id]} />
          ))}
        </span>
      ),
    },
  ], [baseline, itemMeta, traitMeta]);

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No champion data published yet. Re-run the crawl and publish step.
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title="TFT Unit Tier List"
        blurb="Every unit in the set, ranked by measured average placement. Open a row for its best item builds, the components those need, and the comps it gets played in."
        sampleSize={stats.sample_size} generatedAt={stats.generated_at}>
        <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          {rows.length} in the set · {measuredCount} with enough games to rank in this slice
        </p>
      </PageHeader>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <FilterChips
            label="role" value={roleFilter} onChange={setRoleFilter}
            options={[["all", "All"], ...ROLE_ORDER.map((r) => [r, r, ROLE_COLORS[r]])]} />
          <FilterChips
            label="cost" value={costFilter} onChange={setCostFilter}
            options={[["all", "All"], ...[1, 2, 3, 4, 5].map((c) => [c, `${c}g`, COST_COLORS[c]])]} />
        </div>
        <div className="relative shrink-0">
          <Search size={12} className="absolute left-2.5 top-[9px]" style={{ color: "var(--dim)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search name or trait"
                 className="rounded pl-7 pr-2 py-1.5 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors w-52"
                 style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
        </div>
      </div>

      <StatTable
        columns={columns} rows={filtered} rowKey={(c) => c.id}
        sort={sort} onSortChange={setSort}
        expanded={expanded} onToggleRow={toggle}
        pinLast={(c) => !c.measured}
        renderDetail={(c) => (
          <div className="space-y-3.5 pt-2">
            {/* Recommended items first -- the question people open a unit to
                answer. */}
            {c.builds.length > 0 ? (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
                    recommended items <span className="normal-case tracking-normal">· best first</span>
                  </p>
                  <div className="space-y-1.5 max-w-2xl">
                    {c.builds.slice(0, 5).map((b, i) => (
                      <BuildRow key={i} build={b} itemMeta={itemMeta}
                                baseline={baseline} best={i === 0} />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
                    components to build it
                  </p>
                  <ComponentPriority build={c.builds[0]} itemMeta={itemMeta} />
                  <p className="text-[10px] mt-1.5 leading-snug max-w-2xl" style={{ color: "var(--muted)" }}>
                    What the top build consumes — prioritise these on carousel. Riot's match API
                    returns one end-of-game snapshot with no round timeline, so the stage a
                    component was actually picked up can't be measured.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>
                No repeated item set on this unit in this data cut.
              </p>
            )}

            {c.baseStats && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
                  base stats <span className="normal-case tracking-normal">(1★)</span>
                </p>
                <div className="max-w-2xl"><StatGrid stats={c.baseStats} /></div>
              </div>
            )}

            {/* Which comps this unit actually gets played in */}
            {c.comps?.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
                  played in
                </p>
                <div className="space-y-1 max-w-2xl">
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
                            style={{ color: cp.avg_placement < baseline ? "var(--signal)" : "var(--text)" }}>
                        {cp.avg_placement.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {c.ability && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
                  ability
                </p>
                <div className="flex items-start gap-2.5 max-w-2xl">
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
        )} />
    </div>
  );
}
