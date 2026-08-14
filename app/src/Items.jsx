import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { assignTiers, TierBadge } from "./tiers.jsx";
import { StatChip } from "./stats.jsx";
import { PageHeader, FilterChips, StatTable, Place, PlaceChange, Frequency, pct } from "./table.jsx";

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

function ItemDetailCard({ it, itemMeta }) {
  const meta = itemMeta[it.id] || {};
  return (
    <div className="rounded-lg border p-3 max-w-2xl" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 mb-1.5">
        <ItemIcon src={it.icon} name={it.name} size={26} />
        <span className="display text-[13px]" style={{ color: "var(--text)" }}>{it.name}</span>
      </div>
      {meta.stats?.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b" style={{ borderColor: "var(--line)" }}>
          {meta.stats.map((s) => (
            <StatChip key={s.key || s.label} statKey={s.key} label={s.label} value={s.value} />
          ))}
        </div>
      )}
      {meta.description && (
        <p className="text-[11.5px] leading-relaxed whitespace-pre-line mb-2"
           style={{ color: "var(--text)", opacity: 0.85 }}>
          {meta.description}
        </p>
      )}
      {meta.recipe?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--faint)" }}>combine</span>
          {meta.recipe.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: "var(--faint)" }}>+</span>}
              <ItemIcon src={c.icon} name={c.name} size={20} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Item tier list with the "who should hold this" answer attached.
 *
 * The unit page answers "what should this champion hold"; this is the same
 * data read the other way round, which is the question you actually have when
 * a component drops and you're deciding what to build.
 */
export default function Items({ stats, itemMeta }) {
  const [category, setCategory] = useState("Completed");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "place", dir: "asc" });
  const [expanded, setExpanded] = useState(() => new Set());

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
        change: stats.place_change?.items?.[id],
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
    return out;
  }, [rows, category, query]);

  const toggle = (id) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const baseline = stats.baseline_placement;

  const columns = useMemo(() => [
    {
      key: "item", label: "Item", sortFn: (a, b) => a.name.localeCompare(b.name),
      cell: (it) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <ItemIcon src={it.icon} name={it.name} size={30} meta={itemMeta[it.id]} />
          <span className="text-[13px] font-medium truncate">{it.name}</span>
          <span className="text-[9.5px] px-1.5 py-[1px] rounded shrink-0"
                style={{ color: "var(--dim)", background: "var(--raised)" }}>
            {it.category}
          </span>
        </div>
      ),
    },
    {
      key: "tier", label: "Tier", align: "center", width: 70,
      sortFn: (a, b) => a.avg_placement - b.avg_placement,
      cell: (it) => <TierBadge tier={it.tier} size="sm" />,
    },
    {
      key: "place", label: "Avg Place", align: "right", width: 110,
      sortFn: (a, b) => a.avg_placement - b.avg_placement,
      cell: (it) => <Place value={it.avg_placement} baseline={baseline} />,
    },
    {
      key: "change", label: "Change", align: "right", width: 95, defaultDir: "asc",
      sortFn: (a, b) => (a.change?.delta ?? 99) - (b.change?.delta ?? 99),
      cell: (it) => <PlaceChange change={it.change} />,
    },
    {
      key: "win", label: "Win Rate", align: "right", width: 100, defaultDir: "desc",
      sortFn: (a, b) => (a.win_rate || 0) - (b.win_rate || 0),
      cell: (it) => <span className="mono text-[12.5px]">{pct(it.win_rate)}</span>,
    },
    {
      key: "freq", label: "Frequency", align: "right", width: 130, defaultDir: "desc",
      sortFn: (a, b) => (a.n || 0) - (b.n || 0),
      cell: (it) => <Frequency n={it.n} rate={it.play_rate} />,
    },
    {
      key: "holders", label: "Popular Units", align: "right", width: 180,
      cell: (it) => (
        <span className="flex items-center gap-1 justify-end">
          {[...it.holders].sort((a, b) => b.share - a.share).slice(0, 5).map((h) => (
            <ChampionIcon key={h.champion} src={stats.champion_icons?.[h.champion]}
                          name={stats.champion_names?.[h.champion] || h.champion} size={24} />
          ))}
        </span>
      ),
    },
  ], [baseline, itemMeta, stats]);

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No item stats in this snapshot. Re-run the crawl and publish step.
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title="TFT Items Tier List"
        blurb="Which items are worth building on this patch, ranked by the average placement of boards that finished holding them. Open a row for the item's effect and the units that hold it best."
        sampleSize={stats.sample_size} generatedAt={stats.generated_at}>
        <p className="text-[11px] mt-1" style={{ color: "var(--faint)" }}>
          {rows.length} items with enough games to rank in this slice
        </p>
      </PageHeader>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <FilterChips
          value={category} onChange={setCategory} counts={counts}
          options={[["all", "All"], ...CATEGORIES.filter((c) => counts[c] > 0).map((c) => [c, c])]} />
        <div className="relative shrink-0">
          <Search size={12} className="absolute left-2.5 top-[9px]" style={{ color: "var(--dim)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search items"
                 className="rounded pl-7 pr-2 py-1.5 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors w-52"
                 style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
        </div>
      </div>

      <StatTable
        columns={columns} rows={filtered} rowKey={(it) => it.id}
        sort={sort} onSortChange={setSort}
        expanded={expanded} onToggleRow={toggle}
        renderDetail={(it) => (
          <div className="space-y-3.5 pt-2">
            {itemMeta[it.id] && <ItemDetailCard it={it} itemMeta={itemMeta} />}

            {it.holders.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
                  best holders
                </p>
                <div className="space-y-1 max-w-2xl">
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
                            style={{ color: h.avg_placement < baseline ? "var(--signal)" : "var(--text)" }}>
                        {h.avg_placement.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-1.5 leading-snug max-w-2xl" style={{ color: "var(--faint)" }}>
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
        )} />
    </div>
  );
}
