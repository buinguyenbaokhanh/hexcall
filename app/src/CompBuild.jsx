import React, { useState, useEffect, useMemo } from "react";
import { Loader2, AlertTriangle, Star, Info } from "lucide-react";
import { ChampionIcon, ItemIcon, AugmentIcon } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";
import { HoverCard } from "./HoverCard.jsx";

const short = (id = "") => id.replace(/^TFT\d*_(Item_)?/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");

const RARITY = { Silver: "#9FB0C4", Gold: "#F0B429", Prismatic: "#8FE3D2" };
const RARITY_ORDER = ["Silver", "Gold", "Prismatic"];

function Bar({ value, max, color = "var(--signal)", height = 4 }) {
  return (
    <div className="rounded-full overflow-hidden w-full" style={{ height, background: "var(--faint)" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  );
}

function placementColor(v, baseline) {
  if (v < baseline - 0.15) return "var(--signal)";
  if (v > baseline + 0.15) return "var(--danger)";
  return "var(--text)";
}

function Section({ title, note, children }) {
  return (
    <section>
      <h4 className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: "var(--dim)" }}>
        {title}
      </h4>
      {children}
      {note && <p className="text-[10.5px] mt-2 leading-relaxed" style={{ color: "var(--faint)" }}>{note}</p>}
    </section>
  );
}

/**
 * How the comp plays, derived rather than editorialised.
 *
 * The finishing-level distribution separates the "level to 9" boards from the
 * ones that stop at 7, and a high 3-star share on the core units is what
 * actually distinguishes a reroll comp. Both come out of the aggregation, so
 * this label is measured — unlike the difficulty ratings comp guides carry,
 * which are an author's opinion and aren't in the data at all.
 */
function playstyle(view) {
  const levels = view.level_curve || [];
  if (levels.length === 0) return null;
  const modal = levels.reduce((a, b) => (b.pct > a.pct ? b : a));
  const reroll = (view.units || []).some((u) => Number(u.stars?.["3"]?.pct || 0) > 0.35);
  const label = reroll ? `Reroll · level ${modal.level}`
    : modal.level >= 9 ? "Fast 9"
    : modal.level === 8 ? "Level 8"
    : `Level ${modal.level}`;
  return { label, level: modal.level, pct: modal.pct };
}

/** Components consumed by the comp's best builds, most-needed first. */
function carouselPriority(view, itemMeta) {
  const counts = new Map();
  for (const u of view.units || []) {
    const best = u.builds?.[0];
    if (!best) continue;
    for (const id of best.items) {
      for (const c of itemMeta[id]?.recipe || []) {
        const prev = counts.get(c.id) || { ...c, n: 0 };
        counts.set(c.id, { ...prev, n: prev.n + 1 });
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
}

/**
 * Build detail for one comp.
 *
 * Everything shown here is derived from tft-match-v1's end-of-game snapshot:
 * unit rosters, star levels, item sets, traits and final level. The API
 * exposes no board coordinates and no round timeline, so there is deliberately
 * no formation map and no stage-by-stage levelling guide — those would have to
 * be invented rather than measured.
 */
export default function CompBuild({
  apiBase, staticMode, sliceId, slug, selectedAugments, augmentNames,
  augmentIcons = {}, itemMeta = {}, traitMeta = {}, augmentMeta = {},
  compPairs = [], baseline,
}) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lens, setLens] = useState("base");

  useEffect(() => {
    if (!slug || !sliceId) return;
    let cancelled = false;
    setLoading(true); setError(null); setDoc(null);
    const url = staticMode
      ? `${apiBase}/comps/${sliceId}/${slug}.json`
      : `${apiBase}/comp/${sliceId}/${slug}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) { setDoc(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(String(e.message || e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [apiBase, staticMode, sliceId, slug]);

  const availableCuts = useMemo(() => {
    if (!doc) return [];
    return selectedAugments.filter((a) => doc.by_augment?.[a]);
  }, [doc, selectedAugments]);

  useEffect(() => { setLens("base"); }, [slug]);

  const view = lens === "base" ? doc?.base : doc?.by_augment?.[lens];

  // Augments that measurably help this comp, bucketed by the rarity they're
  // offered at — which is the shape the augment-select screen presents.
  const augmentsByRarity = useMemo(() => {
    const out = { Silver: [], Gold: [], Prismatic: [], Unknown: [] };
    for (const p of compPairs) {
      if (p.lift_vs_comp >= 0) continue;  // only ones that help
      const meta = augmentMeta[p.augment] || {};
      (out[meta.rarity] || out.Unknown).push({
        id: p.augment,
        name: meta.name || augmentNames?.[p.augment] || short(p.augment),
        icon: meta.icon || augmentIcons?.[p.augment],
        description: meta.description,
        lift: p.lift_vs_comp,
        avg: p.avg_placement,
        n: p.n,
      });
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => a.lift - b.lift);
      out[k] = out[k].slice(0, 5);
    }
    return out;
  }, [compPairs, augmentMeta, augmentNames, augmentIcons]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-[12px]" style={{ color: "var(--dim)" }}>
        <Loader2 size={13} className="animate-spin" /> Loading build data
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-[11.5px] rounded px-3 py-2.5 border"
           style={{ color: "var(--warn)", borderColor: "var(--warn)33", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
        <AlertTriangle size={13} className="mt-[2px] shrink-0" />
        <span>
          No build detail published for this comp yet. Re-run the crawl and publish step —
          detail files are written to <code className="mono">public/current/comps/</code>.
          <span className="opacity-60 mono ml-1">({error})</span>
        </span>
      </div>
    );
  }

  if (!view) return null;

  const maxUnitPlay = Math.max(...view.units.map((u) => u.play_rate), 0.01);
  const carry = view.carries?.[0];
  const style = playstyle(view);
  const components = carouselPriority(view, itemMeta);
  // Units on essentially every board are the comp's non-negotiable core.
  const core = view.units.filter((u) => u.play_rate >= 0.9);

  return (
    <div>
      {/* Board strip — the comp at a glance, carries first, items underneath */}
      <div className="flex gap-2.5 flex-wrap pb-4 mb-4 border-b" style={{ borderColor: "var(--line)" }}>
        {view.units.slice(0, 10).map((u) => {
          const best = u.builds?.[0];
          const isCarry = u.id === carry?.id;
          return (
            <div key={u.id} className="flex flex-col items-center gap-1" style={{ width: 54 }}>
              <span className="rounded-full p-[2px]"
                    style={{ border: `2px solid ${isCarry ? "var(--accent)" : "var(--line)"}` }}>
                <ChampionIcon src={u.icon} name={short(u.name || u.id)} size={40} />
              </span>
              <span className="text-[10px] truncate w-full text-center"
                    style={{ color: isCarry ? "var(--accent)" : "var(--dim)" }}>
                {short(u.name || u.id)}
              </span>
              <span className="flex gap-[2px] justify-center h-[18px]">
                {(best?.items || []).slice(0, 3).map((id, i) => (
                  <ItemIcon key={i} src={best.icons?.[i]} name={best.names?.[i] || id} size={16}
                            meta={itemMeta[id]} />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      {/* Augment lens switcher — see how the build changes when you actually
          hold each augment, not just the generic build. */}
      {availableCuts.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider mr-1" style={{ color: "var(--dim)" }}>
            build when holding
          </span>
          <button onClick={() => setLens("base")}
                  className="text-[12.5px] px-2.5 py-1.5 rounded border transition-colors"
                  style={{
                    borderColor: lens === "base" ? "var(--accent)" : "var(--line)",
                    color: lens === "base" ? "var(--accent)" : "var(--dim)",
                  }}>
            any augment
          </button>
          {availableCuts.map((a) => {
            const cut = doc.by_augment[a];
            return (
              <button key={a} onClick={() => setLens(a)}
                      className="text-[12.5px] pl-1.5 pr-2.5 py-1 rounded border transition-colors flex items-center gap-2"
                      style={{
                        borderColor: lens === a ? "var(--accent)" : "var(--line)",
                        color: lens === a ? "var(--accent)" : "var(--dim)",
                      }}>
                <AugmentIcon src={augmentMeta[a]?.icon || augmentIcons[a]} name={augmentNames[a] || short(a)} size={22} />
                {augmentMeta[a]?.name || augmentNames[a] || short(a)}
                <span className="mono text-[11px] opacity-70">{cut.avg_placement}</span>
                {cut.carry_changed && <Star size={11} style={{ color: "var(--warn)" }} />}
              </button>
            );
          })}
        </div>
      )}

      {lens !== "base" && view.carry_changed && (
        <p className="text-[12.5px] mb-3 rounded px-2.5 py-2 border"
           style={{ color: "var(--warn)", borderColor: "var(--warn)33", background: "color-mix(in srgb, var(--warn) 7%, transparent)" }}>
          With this augment the most common carry changes to <strong>{short(carry?.name || carry?.id)}</strong>.
        </p>
      )}

      {/* Quick facts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {[
          ["boards", view.boards.toLocaleString()],
          ["avg placement", view.avg_placement],
          ["plays like", style?.label || "—"],
          ["carry", short(carry?.name || carry?.id || "—")],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--line)" }}>
            <p className="text-[9.5px] uppercase tracking-wider mb-0.5" style={{ color: "var(--dim)" }}>{label}</p>
            <p className="mono text-[14px] font-bold truncate">{value}</p>
          </div>
        ))}
      </div>
      {lens !== "base" && (
        <p className="mono text-[11px] -mt-3 mb-4" style={{ color: "var(--faint)" }}>
          filtered to boards holding this augment
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
        <div className="space-y-6">
          {/* Full synergy list */}
          {view.traits?.length > 0 && (
            <Section title="full synergy list"
                     note="Breakpoint each trait most commonly reached, with how often the board hit it.">
              <div className="flex flex-wrap gap-1.5">
                {view.traits.map((t) => (
                  <TraitBadge key={t.name} name={short(t.name)} units={t.units}
                              meta={traitMeta[t.name] || traitMeta[short(t.name)]} pct={t.pct} />
                ))}
              </div>
            </Section>
          )}

          {/* Core champions */}
          {core.length > 0 && (
            <Section title="core champions"
                     note="On at least 90% of boards running this comp — the part that isn't flexible.">
              <div className="flex flex-wrap gap-2">
                {core.map((u) => (
                  <span key={u.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1"
                        style={{ borderColor: "var(--line)" }}>
                    <ChampionIcon src={u.icon} name={short(u.name || u.id)} size={22} />
                    <span className="text-[12px]">{short(u.name || u.id)}</span>
                    <span className="mono text-[10.5px]" style={{ color: "var(--dim)" }}>
                      {(u.play_rate * 100).toFixed(0)}%
                    </span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Carousel priority */}
          {components.length > 0 && (
            <Section title="carousel priority"
                     note="Components the comp's best builds consume, most-needed first. The API has no round timeline, so which carousel you take them on can't be measured.">
              <div className="flex flex-wrap gap-1.5">
                {components.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1"
                        style={{ borderColor: "var(--line)" }}>
                    <ItemIcon src={c.icon} name={c.name} size={22} meta={itemMeta[c.id]} />
                    <span className="text-[11px]" style={{ color: "var(--dim)" }}>{c.name}</span>
                    {c.n > 1 && (
                      <span className="mono text-[10.5px] font-bold" style={{ color: "var(--accent)" }}>×{c.n}</span>
                    )}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Units */}
          <Section title="units · play rate and placement">
            <div className="space-y-2">
              {view.units.map((u) => (
                <div key={u.id}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="flex items-center gap-2 text-[13.5px] truncate min-w-0">
                      <ChampionIcon src={u.icon} name={short(u.name || u.id)} size={28} />
                      <span className="truncate">{short(u.name || u.id)}</span>
                      {u.id === carry?.id && (
                        <span className="mono text-[10px] ml-0.5 px-1.5 py-[1px] rounded shrink-0 font-semibold"
                              style={{ background: "var(--accent)", color: "var(--bg)" }}>CARRY</span>
                      )}
                    </span>
                    <span className="mono text-[13px] shrink-0" style={{ color: placementColor(u.avg_placement, baseline) }}>
                      {u.avg_placement}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-[36px]">
                    <Bar value={u.play_rate} max={maxUnitPlay} height={5} />
                    <span className="mono text-[10.5px] w-10 text-right shrink-0" style={{ color: "var(--dim)" }}>
                      {(u.play_rate * 100).toFixed(0)}%
                    </span>
                  </div>
                  {Object.keys(u.stars).length > 1 && (
                    <div className="flex gap-2.5 mt-1 pl-[36px]">
                      {Object.entries(u.stars).map(([s, v]) => (
                        <span key={s} className="mono text-[10.5px]" style={{ color: "var(--faint)" }}>
                          {s}★ {(v.pct * 100).toFixed(0)}% → <span style={{ color: placementColor(v.avg, baseline) }}>{v.avg}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          {/* Recommended augments, by the rarity they're offered at */}
          {RARITY_ORDER.some((r) => augmentsByRarity[r].length > 0) && (
            <Section title="augments that help this comp"
                     note="Ranked by how much the comp's average placement improves when held with each. Hover for the effect text.">
              <div className="space-y-3">
                {RARITY_ORDER.map((rarity) => {
                  const rows = augmentsByRarity[rarity];
                  if (!rows.length) return null;
                  return (
                    <div key={rarity}>
                      <p className="text-[10px] uppercase tracking-wider mb-1.5"
                         style={{ color: RARITY[rarity] }}>{rarity}</p>
                      <div className="space-y-1">
                        {rows.map((a) => (
                          <HoverCard key={a.id} as="div"
                                     className="flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-default"
                                     card={
                                       <>
                                         <span className="flex items-center gap-2 mb-1.5">
                                           <AugmentIcon src={a.icon} name={a.name} size={26} />
                                           <span className="display text-[13px]" style={{ color: "var(--text)" }}>{a.name}</span>
                                         </span>
                                         {a.description && (
                                           <span className="block text-[11.5px] leading-relaxed whitespace-pre-line"
                                                 style={{ color: "var(--text)", opacity: 0.85 }}>
                                             {a.description}
                                           </span>
                                         )}
                                         <span className="block mono text-[10.5px] mt-2 pt-2 border-t"
                                               style={{ color: "var(--dim)", borderColor: "var(--line)" }}>
                                           {a.avg.toFixed(2)} avg with this comp · n={a.n.toLocaleString()}
                                         </span>
                                       </>
                                     }>
                            <span className="shrink-0 rounded p-[2px]"
                                  style={{ border: `1.5px solid ${RARITY[rarity]}` }}>
                              <AugmentIcon src={a.icon} name={a.name} size={22} />
                            </span>
                            <span className="text-[12px] truncate flex-1 min-w-0">{a.name}</span>
                            <span className="mono text-[12px] shrink-0 font-bold" style={{ color: "var(--signal)" }}>
                              {a.lift.toFixed(2)}
                            </span>
                          </HoverCard>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Item builds */}
          <Section title="best item sets">
            {view.units.filter((u) => u.builds?.length).slice(0, 3).map((u) => (
              <div key={u.id} className="mb-3.5">
                <p className="flex items-center gap-2 text-[13px] mb-2">
                  <ChampionIcon src={u.icon} name={short(u.name || u.id)} size={24} />
                  {short(u.name || u.id)}
                </p>
                <div className="space-y-1.5">
                  {u.builds.map((b, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 border"
                         style={{ borderColor: "var(--line)", background: i === 0 ? "color-mix(in srgb, var(--signal) 6%, transparent)" : "transparent" }}>
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        {(b.items).map((id, j) => (
                          <ItemIcon key={j} src={b.icons?.[j]} name={short(b.names?.[j] || id)} size={28}
                                    meta={itemMeta[id]} />
                        ))}
                      </div>
                      <span className="mono text-[13px] shrink-0" style={{ color: placementColor(b.avg, baseline) }}>
                        {b.avg}
                        <span className="text-[10px] ml-1" style={{ color: "var(--faint)" }}>n={b.n}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!view.units.some((u) => u.builds?.length) && (
              <p className="text-[12.5px]" style={{ color: "var(--dim)" }}>
                Not enough games with a repeated item set to report one.
              </p>
            )}
          </Section>

          {/* Item count on carry */}
          {view.item_count_curve?.length > 1 && (
            <Section title="items on carry → placement">
              <div className="flex gap-2.5">
                {view.item_count_curve.map((r) => (
                  <div key={r.items} className="flex-1 rounded-lg border px-2.5 py-2 text-center"
                       style={{ borderColor: "var(--line)" }}>
                    <p className="mono text-[16px]" style={{ color: placementColor(r.avg, baseline) }}>{r.avg}</p>
                    <p className="mono text-[10.5px]" style={{ color: "var(--dim)" }}>{r.items} item{r.items === 1 ? "" : "s"}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Final level */}
          {view.level_curve?.length > 0 && (() => {
            const peak = Math.max(...view.level_curve.map((x) => x.pct));
            return (
              <Section title="level finished on"
                       note="Where players finished, not when they levelled — the API returns one end-of-game snapshot with no round timeline, so a stage-by-stage levelling guide can't be measured from it.">
                <div className="space-y-1">
                  {view.level_curve.map((r) => {
                    const modal = r.pct === peak;
                    return (
                      <div key={r.level}
                           className="relative flex items-center gap-2.5 rounded-md px-2 py-1.5 overflow-hidden"
                           style={{ background: modal ? "color-mix(in srgb, var(--accent) 7%, transparent)" : "transparent" }}>
                        <span className="absolute inset-y-0 left-0 rounded-md"
                              style={{
                                width: `${(r.pct / peak) * 100}%`,
                                background: modal
                                  ? "linear-gradient(90deg, color-mix(in srgb, var(--accent) 26%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))"
                                  : "linear-gradient(90deg, var(--faint), transparent)",
                              }} />
                        <span className="relative mono text-[12.5px] font-bold w-8 shrink-0"
                              style={{ color: modal ? "var(--accent)" : "var(--dim)" }}>
                          lv{r.level}
                        </span>
                        <span className="relative mono text-[11px] flex-1" style={{ color: "var(--dim)" }}>
                          {(r.pct * 100).toFixed(0)}%
                        </span>
                        <span className="relative mono text-[13px] font-bold w-10 text-right shrink-0"
                              style={{ color: placementColor(r.avg, baseline) }}>
                          {r.avg}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            );
          })()}
        </div>
      </div>

      <p className="text-[11px] mt-6 pt-4 border-t leading-relaxed flex items-start gap-2"
         style={{ borderColor: "var(--line)", color: "var(--faint)" }}>
        <Info size={13} className="mt-[1px] shrink-0" />
        <span>
          No formation map: tft-match-v1 returns unit identities and items but no board
          coordinates, so positioning cannot be measured from this data. Sites that show a
          hex formation read the game client through an overlay.
        </span>
      </p>
    </div>
  );
}
