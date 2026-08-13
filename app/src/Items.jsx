import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { assignTiers, TierBadge } from "./tiers.jsx";
import { StatChip } from "./stats.jsx";

/**
 * Item categories, derived from the crafting recipe rather than a hand-kept
 * list: an item with no recipe is a basic component, one built from two
 * components is a completed item. Name-based checks only cover the classes
 * Riot distinguishes by name (emblems, radiant/artifact variants), which the
 * recipe alone can't separate from ordinary completed items.
 */
function categoryOf(id, meta) {
  const name = `${id} ${meta?.name || ""}`;
  if (/Emblem/i.test(name)) return "Emblem";
  if (/Radiant/i.test(name)) return "Radiant";
  if (/Artifact|Ornn/i.test(name)) return "Artifact";
  // Set-specific item lines (Set 17's Anima Squad tier-2s, and the same shape
  // in earlier sets) are their own class: they aren't crafted from components
  // and would otherwise be miscounted as basic components.
  if (/Item_Tier\d|SquadItem|Support|Trainer/i.test(id)) return "Special";
  if (meta?.recipe?.length) return "Completed";
  // A real component is an ingredient in something. Anything with no recipe
  // that nothing is built from is a one-off (Empty Bag, consumables) rather
  // than a component you hold and combine.
  return meta?.isComponent ? "Component" : "Special";
}

const CATEGORIES = ["Completed", "Component", "Radiant", "Artifact", "Emblem", "Special"];

const SORTS = {
  placement: { label: "Placement", fn: (a, b) => a.avg_placement - b.avg_placement },
  playrate: { label: "Play rate", fn: (a, b) => (b.play_rate || 0) - (a.play_rate || 0) },
  name: { label: "Name", fn: (a, b) => a.name.localeCompare(b.name) },
};

function ItemCard({ it, itemMeta, championIcons, championNames, baseline }) {
  const meta = itemMeta[it.id] || {};
  return (
    <>
      <span className="flex items-center gap-2 mb-1.5">
        <ItemIcon src={it.icon} name={it.name} size={26} />
        <span className="display text-[13px]" style={{ color: "var(--text)" }}>{it.name}</span>
      </span>
      {meta.stats?.length > 0 && (
        <span className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b" style={{ borderColor: "var(--line)" }}>
          {meta.stats.map((s) => (
            <StatChip key={s.key || s.label} statKey={s.key} label={s.label} value={s.value} />
          ))}
        </span>
      )}
      {meta.description && (
        <span className="block text-[11.5px] leading-relaxed whitespace-pre-line mb-2"
              style={{ color: "var(--text)", opacity: 0.85 }}>
          {meta.description}
        </span>
      )}
      {meta.recipe?.length > 0 && (
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--faint)" }}>combine</span>
          {meta.recipe.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: "var(--faint)" }}>+</span>}
              <ItemIcon src={c.icon} name={c.name} size={20} />
            </React.Fragment>
          ))}
        </span>
      )}
    </>
  );
}

/**
 * Item tier list with the "who should hold this" answer attached.
 *
 * The champion pages answer "what should this unit hold"; this is the same
 * data read the other way round, which is the question you actually have when
 * a component drops and you're deciding what to build.
 */
export default function Items({ stats, itemMeta }) {
  const [category, setCategory] = useState("Completed");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("placement");
  const [openId, setOpenId] = useState(null);

  // Which ids are actually ingredients in some recipe -- the only reliable way
  // to tell a real component from a no-recipe one-off.
  const componentIds = useMemo(() => {
    const s = new Set();
    for (const m of Object.values(itemMeta || {})) {
      for (const c of m.recipe || []) s.add(c.id);
    }
    return s;
  }, [itemMeta]);

  const rows = useMemo(() => {
    const raw = Object.entries(stats.items || {}).map(([id, s]) => {
      const meta = itemMeta[id];
      return {
        id,
        name: meta?.name || stats.item_names?.[id] || id,
        icon: meta?.icon || stats.item_icons?.[id],
        category: categoryOf(id, meta && { ...meta, isComponent: componentIds.has(id) }),
        holders: stats.item_holders?.[id] || [],
        ...s,
      };
    });
    return assignTiers(raw, "avg_placement");
  }, [stats, itemMeta, componentIds]);

  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const cat of CATEGORIES) c[cat] = rows.filter((r) => r.category === cat).length;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = category === "all" ? rows : rows.filter((r) => r.category === category);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q));
    }
    return [...out].sort(SORTS[sortBy].fn);
  }, [rows, category, query, sortBy]);

  const chip = (active) => ({
    borderColor: active ? "var(--text)" : "var(--line)",
    background: active ? "var(--raised)" : "transparent",
    color: active ? "var(--text)" : "var(--dim)",
  });

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No item stats in this snapshot. Re-run the crawl and publish step.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="display text-[15px] font-semibold">Items</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--dim)" }}>
            {rows.length} items with enough games to rank · click one for its best holders
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-[10px]" style={{ color: "var(--dim)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search items"
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

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <button onClick={() => setCategory("all")}
                className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
                style={chip(category === "all")}>
          All <span className="mono opacity-60">{counts.all}</span>
        </button>
        {CATEGORIES.filter((c) => counts[c] > 0).map((c) => (
          <button key={c} onClick={() => setCategory(c)}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
                  style={chip(category === c)}>
            {c} <span className="mono opacity-60">{counts[c]}</span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {filtered.map((it) => {
          const isOpen = openId === it.id;
          return (
            <div key={it.id} className="rounded-lg border overflow-hidden"
                 style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
              <button onClick={() => setOpenId(isOpen ? null : it.id)}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-3 row-hover">
                <TierBadge tier={it.tier} />
                <ItemIcon src={it.icon} name={it.name} size={34} meta={itemMeta[it.id]} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[13.5px] font-medium truncate">{it.name}</span>
                      <span className="text-[10px] px-1.5 py-[1px] rounded shrink-0"
                            style={{ color: "var(--dim)", background: "var(--raised)" }}>
                        {it.category}
                      </span>
                    </span>
                    <span className="mono text-[17px] font-bold shrink-0"
                          style={{ color: it.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                      {it.avg_placement.toFixed(2)}
                    </span>
                  </div>
                  <p className="mono text-[10.5px] mt-0.5" style={{ color: "var(--dim)" }}>
                    {(it.top4_rate * 100).toFixed(0)}% top4 · {(it.play_rate * 100).toFixed(1)}% of boards ·
                    n={it.n.toLocaleString()}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="px-3 pb-3.5 pl-[76px] space-y-3.5">
                  {itemMeta[it.id] && (
                    <div className="rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
                      <ItemCard it={it} itemMeta={itemMeta} baseline={stats.baseline_placement} />
                    </div>
                  )}

                  {it.holders.length > 0 ? (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                        best holders
                      </p>
                      <div className="space-y-1">
                        {it.holders.map((h) => (
                          <div key={h.champion} className="flex items-center gap-2.5 rounded border px-2.5 py-1.5"
                               style={{ borderColor: "var(--line)" }}>
                            <ChampionIcon src={stats.champion_icons?.[h.champion]}
                                          name={stats.champion_names?.[h.champion] || h.champion} size={24} />
                            <span className="text-[12px] flex-1 min-w-0 truncate">
                              {stats.champion_names?.[h.champion] || h.champion}
                            </span>
                            <span className="mono text-[10.5px] shrink-0" style={{ color: "var(--dim)" }}>
                              {(h.share * 100).toFixed(0)}% of holders · n={h.n.toLocaleString()}
                            </span>
                            <span className="mono text-[13px] font-bold shrink-0 w-11 text-right"
                                  style={{ color: h.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                              {h.avg_placement.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] mt-1.5 leading-snug" style={{ color: "var(--faint)" }}>
                        Ranked by placement when this unit held the item. A unit that holds it rarely but
                        well can outrank the popular holder — check the sample.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11.5px]" style={{ color: "var(--faint)" }}>
                      No single champion held this often enough to rank.
                    </p>
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
