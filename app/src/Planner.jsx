import React, { useMemo, useState } from "react";
import { Plus, Minus, ArrowRight, Sparkles, TrendingUp } from "lucide-react";
import { ChampionIcon, ItemIcon, carryIdFromSig } from "./icons.jsx";
import { HoverCard } from "./HoverCard.jsx";
import { CONF } from "./scoring.jsx";

/**
 * Which items each component builds into, derived by inverting the published
 * recipes rather than hard-coding a table -- so it follows the live set.
 */
function componentIndex(itemMeta) {
  const components = new Map();   // component id -> {id, name, icon}
  const recipes = [];             // {id, name, icon, needs: [componentId, ...]}
  for (const [id, meta] of Object.entries(itemMeta || {})) {
    const recipe = meta.recipe || [];
    if (recipe.length === 0) continue;
    recipes.push({ id, name: meta.name || id, icon: meta.icon, needs: recipe.map((c) => c.id) });
    for (const c of recipe) {
      if (!components.has(c.id)) components.set(c.id, { id: c.id, name: c.name, icon: c.icon });
    }
  }
  return { components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)), recipes };
}

/** Can `needs` be satisfied from `have`? Multiplicity matters (2x B.F. Sword). */
function missingFrom(have, needs) {
  const pool = { ...have };
  const missing = [];
  for (const n of needs) {
    if (pool[n] > 0) pool[n] -= 1;
    else missing.push(n);
  }
  return missing;
}

/**
 * Component planner.
 *
 * The decision this models is the one a TFT player actually makes over and
 * over: components drop, and you have to choose what to build and who to build
 * it on -- which in turn commits you to a comp. It replaced an augment-based
 * flow because Riot's match API does not report augments, so no augment
 * statistic can be computed from it; components, items, units and traits are
 * all present, so everything below is measured rather than asserted.
 */
export default function Planner({ stats, itemMeta, onOpenComp }) {
  const [have, setHave] = useState({});   // componentId -> count

  const { components, recipes } = useMemo(() => componentIndex(itemMeta), [itemMeta]);
  const held = Object.values(have).reduce((a, b) => a + b, 0);

  const add = (id) => setHave((h) => ({ ...h, [id]: (h[id] || 0) + 1 }));
  const remove = (id) => setHave((h) => {
    const n = { ...h };
    if (!n[id]) return n;
    n[id] -= 1;
    if (n[id] <= 0) delete n[id];
    return n;
  });

  // Completed items split by how far away they are.
  const { buildable, oneAway } = useMemo(() => {
    const b = [], o = [];
    for (const r of recipes) {
      const miss = missingFrom(have, r.needs);
      const row = {
        ...r,
        missing: miss,
        stat: stats.items?.[r.id],
        holders: stats.item_holders?.[r.id] || [],
      };
      if (miss.length === 0) b.push(row);
      else if (miss.length === 1) o.push(row);
    }
    const rank = (x, y) =>
      (x.stat?.avg_placement ?? 99) - (y.stat?.avg_placement ?? 99);
    return { buildable: b.sort(rank), oneAway: o.sort(rank) };
  }, [recipes, have, stats]);

  // Champions that perform with what you can build, best placement first.
  const carries = useMemo(() => {
    const byChamp = new Map();
    for (const item of buildable) {
      for (const h of item.holders) {
        const prev = byChamp.get(h.champion) || { champion: h.champion, items: [], best: 99, n: 0 };
        prev.items.push({ id: item.id, name: item.name, icon: item.icon, avg: h.avg_placement, n: h.n });
        prev.best = Math.min(prev.best, h.avg_placement);
        prev.n += h.n;
        byChamp.set(h.champion, prev);
      }
    }
    return [...byChamp.values()]
      .map((c) => ({ ...c, items: c.items.sort((a, b) => a.avg - b.avg).slice(0, 3) }))
      .sort((a, b) => a.best - b.best)
      .slice(0, 6);
  }, [buildable]);

  // Comps those carries actually get played in.
  const comps = useMemo(() => {
    const bySig = new Map();
    for (const c of carries) {
      for (const cp of stats.champion_comps?.[c.champion] || []) {
        const prev = bySig.get(cp.comp) || { sig: cp.comp, via: [], avg: cp.avg_placement, n: cp.n };
        prev.via.push(c.champion);
        prev.avg = Math.min(prev.avg, cp.avg_placement);
        bySig.set(cp.comp, prev);
      }
    }
    return [...bySig.values()]
      .map((c) => ({ ...c, ...(stats.comps?.[c.sig] || {}), name: stats.comp_names?.[c.sig] || c.sig }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 6);
  }, [carries, stats]);

  // Which single component unlocks the most (and best) new items.
  const nextComponent = useMemo(() => {
    const gain = new Map();
    for (const r of oneAway) {
      const need = r.missing[0];
      const prev = gain.get(need) || { id: need, unlocks: [], best: 99 };
      prev.unlocks.push(r);
      prev.best = Math.min(prev.best, r.stat?.avg_placement ?? 99);
      gain.set(need, prev);
    }
    return [...gain.values()]
      .map((g) => ({ ...g, ...(components.find((c) => c.id === g.id) || {}) }))
      .sort((a, b) => a.best - b.best || b.unlocks.length - a.unlocks.length)
      .slice(0, 4);
  }, [oneAway, components]);

  const itemCard = (row) => (
    <>
      <span className="flex items-center gap-2 mb-1.5">
        <ItemIcon src={row.icon} name={row.name} size={26} />
        <span className="display text-[13px]" style={{ color: "var(--text)" }}>{row.name}</span>
      </span>
      {itemMeta[row.id]?.description && (
        <span className="block text-[11.5px] leading-relaxed whitespace-pre-line"
              style={{ color: "var(--text)", opacity: 0.85 }}>
          {itemMeta[row.id].description}
        </span>
      )}
      {row.stat && (
        <span className="block mono text-[10.5px] mt-2 pt-2 border-t"
              style={{ color: "var(--dim)", borderColor: "var(--line)" }}>
          {row.stat.avg_placement.toFixed(2)} avg · n={row.stat.n.toLocaleString()}
        </span>
      )}
    </>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
      {/* ---- What you're holding ---- */}
      <aside className="rounded-lg border p-3.5 lg:sticky lg:top-[130px]"
             style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="display text-[12.5px] flex items-center gap-1.5">
            <Sparkles size={13} style={{ color: "var(--accent)" }} /> Your components
          </h2>
          <span className="mono text-[11px]" style={{ color: "var(--dim)" }}>{held}</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {components.map((c) => {
            const n = have[c.id] || 0;
            return (
              <div key={c.id}
                   className="rounded-lg border px-1.5 py-1.5 flex items-center gap-1.5"
                   style={{
                     borderColor: n ? "var(--accent)" : "var(--line)",
                     background: n ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                   }}>
                <ItemIcon src={c.icon} name={c.name} size={24} meta={itemMeta[c.id]} />
                <span className="text-[10.5px] leading-tight flex-1 min-w-0 truncate"
                      style={{ color: n ? "var(--text)" : "var(--dim)" }}>
                  {c.name}
                </span>
                {n > 0 && (
                  <button onClick={() => remove(c.id)} className="shrink-0 p-0.5 rounded"
                          style={{ color: "var(--dim)" }} aria-label={`Remove ${c.name}`}>
                    <Minus size={11} />
                  </button>
                )}
                {n > 0 && <span className="mono text-[11px] font-bold" style={{ color: "var(--accent)" }}>{n}</span>}
                <button onClick={() => add(c.id)} className="shrink-0 p-0.5 rounded"
                        style={{ color: "var(--dim)" }} aria-label={`Add ${c.name}`}>
                  <Plus size={11} />
                </button>
              </div>
            );
          })}
        </div>

        {held > 0 && (
          <button onClick={() => setHave({})}
                  className="w-full mt-2.5 text-[11px] rounded px-2 py-1.5 border"
                  style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
            Clear
          </button>
        )}

        <p className="text-[10px] mt-3 leading-snug" style={{ color: "var(--dim)" }}>
          Add the components you're holding. Everything on the right is measured from real
          matches on this slice — no augment data exists in Riot's match API, so this plans
          around items instead.
        </p>
      </aside>

      {/* ---- The plan ---- */}
      <section className="space-y-4">
        {held === 0 ? (
          <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            <h2 className="display text-[15px] font-semibold mb-1">Start with what dropped</h2>
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
              Add the components you're holding and this becomes a plan: what you can build now,
              who should hold it, which comps that steers you into, and which component to
              prioritise on the next carousel.
            </p>
          </div>
        ) : (
          <>
            {/* Build now */}
            <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
              <h3 className="display text-[13px] font-semibold mb-2.5">
                You can build
                <span className="mono text-[11px] ml-2" style={{ color: "var(--dim)" }}>
                  {buildable.length}
                </span>
              </h3>
              {buildable.length === 0 ? (
                <p className="text-[12px]" style={{ color: "var(--dim)" }}>
                  Nothing completes yet — see what one more component unlocks below.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {buildable.map((r) => (
                    <HoverCard key={r.id} as="div" card={itemCard(r)}
                               className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
                               >
                      <ItemIcon src={r.icon} name={r.name} size={26} />
                      <span className="text-[12px] truncate flex-1 min-w-0">{r.name}</span>
                      {r.stat ? (
                        <span className="mono text-[12.5px] font-bold shrink-0"
                              style={{ color: r.stat.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                          {r.stat.avg_placement.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-[10px] shrink-0" style={{ color: "var(--faint)" }}>no data</span>
                      )}
                    </HoverCard>
                  ))}
                </div>
              )}
            </div>

            {/* Who holds it */}
            {carries.length > 0 && (
              <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                <h3 className="display text-[13px] font-semibold mb-2.5">Give it to</h3>
                <div className="space-y-1.5">
                  {carries.map((c) => (
                    <div key={c.champion} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
                         style={{ borderColor: "var(--line)" }}>
                      <ChampionIcon src={stats.champion_icons?.[c.champion]}
                                    name={stats.champion_names?.[c.champion] || c.champion} size={30} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] truncate">
                          {stats.champion_names?.[c.champion] || c.champion}
                        </p>
                        <span className="flex items-center gap-1 mt-0.5">
                          {c.items.map((it) => (
                            <ItemIcon key={it.id} src={it.icon} name={it.name} size={17} meta={itemMeta[it.id]} />
                          ))}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="mono text-[14px] font-bold"
                           style={{ color: c.best < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                          {c.best.toFixed(2)}
                        </p>
                        <p className="mono text-[9.5px]" style={{ color: "var(--dim)" }}>
                          n={c.n.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--faint)" }}>
                  Best placement each unit reached holding one of your buildable items.
                </p>
              </div>
            )}

            {/* Where it leads */}
            {comps.length > 0 && (
              <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                <h3 className="display text-[13px] font-semibold mb-2.5">Comps that go with it</h3>
                <div className="space-y-1.5">
                  {comps.map((c) => (
                    <button key={c.sig} onClick={() => onOpenComp({ ...c, projected: c.avg_placement ?? c.avg,
                                                                    contributions: [], delta: 0, missing: 0,
                                                                    confidence: "high" })}
                            className="w-full text-left flex items-center gap-2.5 rounded-lg border px-2.5 py-2 row-hover"
                            style={{ borderColor: "var(--line)" }}>
                      <ChampionIcon src={stats.champion_icons?.[carryIdFromSig(c.sig)]} name={c.name} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] truncate">{c.name}</p>
                        <p className="mono text-[10px]" style={{ color: "var(--dim)" }}>
                          via {c.via.map((v) => stats.champion_names?.[v] || v).join(", ")}
                        </p>
                      </div>
                      <span className="mono text-[14px] font-bold shrink-0"
                            style={{ color: c.avg < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
                        {c.avg.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* What to look for */}
            {nextComponent.length > 0 && (
              <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <TrendingUp size={13} style={{ color: "var(--accent)" }} />
                  <h3 className="display text-[13px] font-semibold">Prioritise on carousel</h3>
                </div>
                <div className="space-y-1.5">
                  {nextComponent.map((g) => (
                    <div key={g.id} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
                         style={{ borderColor: "var(--line)" }}>
                      <ItemIcon src={g.icon} name={g.name} size={26} meta={itemMeta[g.id]} />
                      <span className="text-[12px] shrink-0" style={{ color: "var(--text)" }}>{g.name}</span>
                      <ArrowRight size={12} className="shrink-0" style={{ color: "var(--faint)" }} />
                      <span className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                        {g.unlocks.slice(0, 5).map((u) => (
                          <ItemIcon key={u.id} src={u.icon} name={u.name} size={20} meta={itemMeta[u.id]} />
                        ))}
                      </span>
                      <span className="mono text-[12px] font-bold shrink-0" style={{ color: "var(--signal)" }}>
                        {g.best < 99 ? g.best.toFixed(2) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--faint)" }}>
                  Components that complete the strongest item you're one piece away from.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
