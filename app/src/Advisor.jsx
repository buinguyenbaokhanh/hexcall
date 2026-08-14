import React, { useMemo, useState } from "react";
import { Search, X, Sparkles, Anchor, Shuffle, ArrowRight, Info, Check } from "lucide-react";
import { AugmentIcon, ChampionIcon, ItemIcon, carryIdFromSig } from "./icons.jsx";
import { HoverCard } from "./HoverCard.jsx";
import { rankComps, pivotAdvice, augmentTypes, fitScore } from "./fit.jsx";
import { TeamCodeButton } from "./Comps.jsx";

const RARITY = { Silver: "#9FB0C4", Gold: "#F0B429", Prismatic: "#8FE3D2" };
const STAGES = [
  { slot: 0, stage: "2-1", label: "1st augment", blurb: "This sets your direction." },
  { slot: 1, stage: "3-2", label: "2nd augment", blurb: "Reinforce what you committed to." },
  { slot: 2, stage: "4-2", label: "3rd augment", blurb: "Too late to pivot — take what fits." },
];

function AugmentPick({ a, onClick, disabled }) {
  return (
    <HoverCard as="div" className="w-full"
               card={
                 <>
                   <span className="flex items-center gap-2 mb-1.5">
                     <AugmentIcon src={a.icon} name={a.name} size={26} />
                     <span className="min-w-0">
                       <span className="display text-[13px] block" style={{ color: "var(--text)" }}>{a.name}</span>
                       {a.rarity && (
                         <span className="text-[9.5px] uppercase tracking-wider"
                               style={{ color: RARITY[a.rarity] }}>{a.rarity}</span>
                       )}
                     </span>
                   </span>
                   {a.description && (
                     <span className="block text-[11.5px] leading-relaxed whitespace-pre-line"
                           style={{ color: "var(--text)", opacity: 0.85 }}>{a.description}</span>
                   )}
                 </>
               }>
      <button disabled={disabled} onClick={onClick}
              className={`w-full text-left rounded px-2 py-[6px] border row-hover ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              style={{ borderColor: "transparent" }}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 rounded p-[1.5px]"
                style={{ border: `1.5px solid ${RARITY[a.rarity] || "var(--line)"}` }}>
            <AugmentIcon src={a.icon} name={a.name} size={20} />
          </span>
          <span className="text-[12px] truncate flex-1">{a.name}</span>
          {[...augmentTypes(a)].slice(0, 1).map((t) => (
            <span key={t} className="text-[9px] px-1 py-[1px] rounded shrink-0"
                  style={{ color: "var(--dim)", background: "var(--raised)" }}>{t}</span>
          ))}
        </span>
      </button>
    </HoverCard>
  );
}

function CompCard({ comp, stats, itemMeta, traitMeta, onOpen, highlight }) {
  const p = comp.profile || {};
  return (
    <button onClick={() => onOpen(comp)}
            className="w-full text-left rounded-lg border p-3 row-hover"
            style={{ background: "var(--bg)",
                     borderColor: highlight ? "var(--signal)" : "var(--line)" }}>
      <div className="flex items-center gap-3">
        <ChampionIcon src={stats.champion_icons?.[carryIdFromSig(comp.sig)]} name={comp.name} size={38} />
        <div className="flex-1 min-w-0">
          <p className="display text-[14px] truncate">{comp.name}</p>
          <p className="mono text-[10.5px]" style={{ color: "var(--dim)" }}>
            {(comp.top4_rate * 100).toFixed(0)}% top4 · n={comp.n.toLocaleString()}
            {p.finish_level ? ` · finishes lv${p.finish_level}` : ""}
            {p.reroll ? ` · rerolls ${p.three_stars.join(", ")}` : ""}
          </p>
        </div>
        <span className="text-right shrink-0">
          <p className="mono text-[19px] font-bold"
             style={{ color: comp.avg_placement < stats.baseline_placement ? "var(--signal)" : "var(--text)" }}>
            {comp.avg_placement.toFixed(2)}
          </p>
          <span className="flex justify-end mt-1"><TeamCodeButton code={comp.team_code} /></span>
        </span>
      </div>

      {comp.board?.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-2">
          {comp.board.slice(0, 9).map((u) => (
            <span key={u.id} className="rounded-full p-[1.5px]"
                  style={{ border: `1.5px solid ${u.carry ? "var(--accent)" : "transparent"}` }}>
              <ChampionIcon src={u.icon} name={u.name} size={24} />
            </span>
          ))}
        </div>
      )}

      {comp.reasons?.length > 0 && (
        <ul className="mt-2 space-y-[2px]">
          {comp.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--signal)" }}>
              <Check size={11} className="mt-[2px] shrink-0" />
              <span style={{ color: "var(--dim)" }}>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}

/**
 * The staged augment advisor.
 *
 * The premise the tool is built on: your first augment sets a direction, and
 * the next two should usually reinforce it. Pivoting is possible and sometimes
 * right, but it costs the items and board you already committed -- so the
 * default answer here is "stay", and a pivot is only named when the
 * alternative is meaningfully better AND it is early enough to matter.
 *
 * Comps are RANKED by measured placement. Augments decide which comps are
 * shown and why; they never invent how good a comp is. See fit.jsx for why
 * there are no augment win rates anywhere in this flow.
 */
export default function Advisor({ stats, augmentMeta, itemMeta, traitMeta, onOpenComp }) {
  const [picks, setPicks] = useState([null, null, null]);
  const [slot, setSlot] = useState(0);
  const [query, setQuery] = useState("");

  const ctx = useMemo(() => ({
    championNames: stats.champion_names || {},
    traitNames: Object.fromEntries(
      Object.entries(traitMeta || {}).map(([k, v]) => [k, v.name || k])),
  }), [stats, traitMeta]);

  const comps = useMemo(
    () => Object.entries(stats.comps || {}).map(([sig, c]) => ({
      sig, name: stats.comp_names?.[sig] || sig, ...c })),
    [stats]);

  const chosen = picks.map((id) => (id ? { id, ...(augmentMeta?.[id] || {}) } : null));
  const filled = chosen.filter(Boolean).length;

  // Anchor = the comp the FIRST augment pointed at, carried forward.
  const anchorRank = useMemo(
    () => rankComps(comps, [chosen[0]], ctx), [comps, chosen[0], ctx]);
  const anchor = filled > 0 ? anchorRank[0] : null;

  const ranked = useMemo(() => rankComps(comps, chosen, ctx), [comps, chosen, ctx]);
  const advice = useMemo(
    () => (filled > 1 ? pivotAdvice(anchor, ranked, filled - 1) : null),
    [anchor, ranked, filled]);

  const augList = useMemo(() => {
    let rows = Object.entries(augmentMeta || {}).map(([id, m]) => ({ id, ...m }));
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((a) => (a.name || "").toLowerCase().includes(q)
        || (a.description || "").toLowerCase().includes(q));
    }
    return rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [augmentMeta, query]);

  const setPick = (i, v) => setPicks((p) => { const n = [...p]; n[i] = v; return n; });
  const pick = (id) => {
    setPick(slot, id);
    const next = picks.findIndex((p, i) => !p && i !== slot);
    if (next >= 0) setSlot(next);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
      {/* Picker */}
      <aside className="rounded-lg border p-3.5 lg:sticky lg:top-[130px]"
             style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
        <div className="flex gap-1.5 mb-3">
          {STAGES.map(({ slot: s, stage }) => {
            const id = picks[s];
            const active = slot === s;
            return (
              <button key={s} onClick={() => setSlot(s)}
                      className="flex-1 rounded-lg border p-1.5 text-center transition-colors"
                      style={{ borderColor: active ? "var(--accent)" : id ? "var(--line)" : "var(--faint)",
                               background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent" }}>
                <p className="mono text-[10px] mb-1" style={{ color: active ? "var(--accent)" : "var(--dim)" }}>{stage}</p>
                <span className="flex justify-center items-center h-[26px]">
                  {id ? <AugmentIcon src={augmentMeta?.[id]?.icon} name={augmentMeta?.[id]?.name} size={26} />
                      : <Sparkles size={14} style={{ color: "var(--muted)" }} />}
                </span>
              </button>
            );
          })}
        </div>

        {picks[slot] && (
          <button onClick={() => setPick(slot, null)}
                  className="w-full flex items-center justify-between gap-2 text-[11.5px] rounded px-2 py-1.5 border mb-2.5"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)",
                           background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
            <span className="truncate">{augmentMeta?.[picks[slot]]?.name || picks[slot]}</span>
            <X size={11} className="shrink-0" />
          </button>
        )}

        <p className="text-[11px] mb-2" style={{ color: "var(--dim)" }}>
          What were you offered at <span className="mono" style={{ color: "var(--accent)" }}>{STAGES[slot].stage}</span>?
        </p>

        <div className="relative mb-2">
          <Search size={12} className="absolute left-2.5 top-[9px]" style={{ color: "var(--dim)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search augments"
                 className="w-full rounded pl-7 pr-2 py-2 text-[12px] border outline-none focus:border-[var(--accent)]"
                 style={{ background: "var(--bg)", borderColor: "var(--line)", color: "var(--text)" }} />
        </div>

        <div className="max-h-[calc(100vh-360px)] overflow-y-auto scroll-thin pr-1 space-y-[2px]">
          {augList.map((a) => (
            <AugmentPick key={a.id} a={a} onClick={() => pick(a.id)}
                         disabled={picks.includes(a.id) && picks[slot] !== a.id} />
          ))}
        </div>
      </aside>

      {/* Plan */}
      <section className="space-y-4">
        {filled === 0 ? (
          <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            <h2 className="display text-[15px] font-semibold mb-1">Start with your 2-1 augment</h2>
            <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--dim)" }}>
              Your first augment sets a direction. Pick it and this becomes a plan: which comps
              it supports, why, and what to look for at 3-2 to reinforce rather than fight it.
            </p>
            <div className="flex items-start gap-2 text-[11px] rounded px-2.5 py-2 border"
                 style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
              <Info size={12} className="mt-[2px] shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                Comps are ranked by <strong style={{ color: "var(--text)" }}>measured placement</strong>.
                Augments decide which are shown and why — there are no augment win rates here,
                because Riot's match API records no augments for anyone to measure.
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* Verdict */}
            <div className="rounded-lg border p-4"
                 style={{ background: "var(--surface)",
                          borderColor: advice?.kind === "pivot" ? "var(--warn)" : "var(--signal)" }}>
              <div className="flex items-center gap-2 mb-2.5">
                {advice?.kind === "pivot"
                  ? <Shuffle size={14} style={{ color: "var(--warn)" }} />
                  : <Anchor size={14} style={{ color: "var(--signal)" }} />}
                <h2 className="display text-[14px] font-semibold"
                    style={{ color: advice?.kind === "pivot" ? "var(--warn)" : "var(--signal)" }}>
                  {filled === 1 ? "Build toward"
                    : advice?.kind === "pivot" ? "Worth pivoting"
                    : advice?.kind === "hold" ? "Stay — pivot isn't worth it"
                    : "Stay the course"}
                </h2>
                <span className="mono text-[10.5px]" style={{ color: "var(--dim)" }}>
                  after {filled} of 3
                </span>
              </div>

              {advice?.kind === "hold" && advice.alternative && (
                <p className="text-[12px] mb-2.5" style={{ color: "var(--dim)" }}>
                  {advice.alternative.name} rates {advice.gain > 0 ? advice.gain.toFixed(2) : "0.00"} better,
                  {" "}but you'd abandon the items and board you've already committed
                  {filled > 2 ? " and it's 4-2 — too late." : ". Not worth it below ~0.15."}
                </p>
              )}
              {advice?.kind === "pivot" && advice.alternative && (
                <p className="text-[12px] mb-2.5" style={{ color: "var(--dim)" }}>
                  <span style={{ color: "var(--text)" }}>{advice.anchor.name}</span>
                  <ArrowRight size={11} className="inline mx-1.5" />
                  <span style={{ color: "var(--text)" }}>{advice.alternative.name}</span>
                  {" "}— worth {advice.gain.toFixed(2)} placement, and it's still early enough to move.
                </p>
              )}

              <CompCard comp={advice?.kind === "pivot" ? advice.alternative : (anchor || ranked[0])}
                        stats={stats} itemMeta={itemMeta} traitMeta={traitMeta}
                        onOpen={onOpenComp} highlight />

              {/* Closing the loop: the augment picked the comp, the comp picks
                  the build. Same question a player asks next, so it shouldn't
                  need another tab. */}
              <BuildPlan comp={advice?.kind === "pivot" ? advice.alternative : (anchor || ranked[0])}
                         itemMeta={itemMeta} />
            </div>

            {/* Next augment guidance */}
            {filled < 3 && (
              <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                <h3 className="display text-[13px] font-semibold mb-1">
                  At {STAGES[filled].stage}, look for
                </h3>
                <p className="text-[11.5px] mb-2.5" style={{ color: "var(--dim)" }}>
                  {STAGES[filled].blurb} These support{" "}
                  <span style={{ color: "var(--text)" }}>{(anchor || ranked[0])?.name}</span>:
                </p>
                <NextAugments comp={anchor || ranked[0]} augmentMeta={augmentMeta}
                              taken={picks.filter(Boolean)} ctx={ctx} />
              </div>
            )}

            {/* Other comps that fit */}
            <div>
              <h3 className="display text-[13px] mb-2">Other comps your augments support</h3>
              <div className="space-y-2">
                {ranked.filter((c) => c.sig !== (anchor || ranked[0])?.sig && c.fit > 0)
                       .slice(0, 4)
                       .map((c) => (
                  <CompCard key={c.sig} comp={c} stats={stats} itemMeta={itemMeta}
                            traitMeta={traitMeta} onOpen={onOpenComp} />
                ))}
                {ranked.filter((c) => c.fit > 0).length <= 1 && (
                  <p className="text-[12px]" style={{ color: "var(--dim)" }}>
                    No other comp has a known link to your augments. That usually means the
                    augment is generic — take the strongest comp on the Comps tab instead.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * What to build for the anchored comp: the carry's measured best item set, and
 * the components it costs.
 *
 * Components come from inverting the item recipes rather than a hand-kept
 * list, so this follows the live set. The API has no round timeline, so this
 * says what the build consumes -- not when to pick each piece up.
 */
function BuildPlan({ comp, itemMeta }) {
  // Prefer the carry, but fall back to the most-played unit that actually has
  // a measured build. On a thin crawl the carry often hasn't repeated one item
  // set often enough to clear the floor, and showing nothing there is worse
  // than showing a real build on a different unit -- as long as it says whose.
  const board = comp?.board || [];
  const holder = board.find((u) => u.carry && u.items?.length)
              || board.find((u) => u.items?.length);
  const items = holder?.items || [];
  if (!items.length) {
    return (
      <p className="mt-3 text-[11.5px]" style={{ color: "var(--muted)" }}>
        No item set has repeated often enough in this data cut to recommend a build yet.
      </p>
    );
  }

  const components = [];
  const seen = new Map();
  for (const id of items) {
    for (const c of itemMeta?.[id]?.recipe || []) {
      const prev = seen.get(c.id);
      if (prev) prev.n += 1;
      else { const row = { ...c, n: 1 }; seen.set(c.id, row); components.push(row); }
    }
  }
  components.sort((a, b) => b.n - a.n);

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
      <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
        then build — on {holder.name}{holder.carry ? "" : " (the carry has no measured build yet)"}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        {items.map((id, i) => (
          <ItemIcon key={i} src={holder.item_icons?.[i]} name={id} size={30} meta={itemMeta?.[id]} />
        ))}
      </div>
      {components.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
            components to prioritise
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {components.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5 rounded border px-2 py-1"
                    style={{ borderColor: "var(--line)" }}>
                <ItemIcon src={c.icon} name={c.name} size={20} meta={itemMeta?.[c.id]} />
                <span className="text-[11px]" style={{ color: "var(--dim)" }}>{c.name}</span>
                {c.n > 1 && (
                  <span className="mono text-[10.5px] font-bold" style={{ color: "var(--accent)" }}>×{c.n}</span>
                )}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Augments that support the anchor comp, grouped by why. */
function NextAugments({ comp, augmentMeta, taken, ctx }) {
  const rows = useMemo(() => {
    if (!comp) return [];
    const out = [];
    for (const [id, m] of Object.entries(augmentMeta || {})) {
      if (taken.includes(id)) continue;
      const { score, reasons } = fitScore({ id, ...m }, comp, ctx);
      if (score > 0) out.push({ id, ...m, score, reasons });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6);
  }, [comp, augmentMeta, taken, ctx]);

  if (!rows.length) {
    return (
      <p className="text-[12px]" style={{ color: "var(--dim)" }}>
        Nothing in the pool has a specific link to this comp — take the best generic augment.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {rows.map((a) => (
        <HoverCard key={a.id} as="div"
                   className="flex items-start gap-2 rounded-lg border px-2 py-1.5"
                   card={
                     <>
                       <span className="flex items-center gap-2 mb-1.5">
                         <AugmentIcon src={a.icon} name={a.name} size={26} />
                         <span className="display text-[13px]" style={{ color: "var(--text)" }}>{a.name}</span>
                       </span>
                       {a.description && (
                         <span className="block text-[11.5px] leading-relaxed whitespace-pre-line"
                               style={{ color: "var(--text)", opacity: 0.85 }}>{a.description}</span>
                       )}
                     </>
                   }>
          <span className="shrink-0 rounded p-[1.5px] mt-[1px]"
                style={{ border: `1.5px solid ${RARITY[a.rarity] || "var(--line)"}` }}>
            <AugmentIcon src={a.icon} name={a.name} size={20} />
          </span>
          <span className="min-w-0">
            <span className="text-[12px] block truncate">{a.name}</span>
            <span className="text-[10px] block leading-snug" style={{ color: "var(--dim)" }}>
              {a.reasons[0]}
            </span>
          </span>
        </HoverCard>
      ))}
    </div>
  );
}
