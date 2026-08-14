import React, { useMemo, useState } from "react";
import { Search, Info } from "lucide-react";
import { AugmentIcon, ChampionIcon } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";
import { HoverCard } from "./HoverCard.jsx";

// TFT's own augment rarities. The colours are the game's, so the frame around
// an augment icon here reads the same as it does in the augment select screen.
const RARITY = { Silver: "#9FB0C4", Gold: "#F0B429", Prismatic: "#8FE3D2" };
const RARITY_ORDER = ["Silver", "Gold", "Prismatic"];
const RARITY_RANK = { Silver: 1, Gold: 2, Prismatic: 3 };

/**
 * Rough "what kind of augment is this" tags, inferred from the effect text.
 * Riot publishes no category, so these are a reading aid rather than a fact
 * from the game; anything matching nothing gets no tag instead of a guess.
 */
const TYPE_RULES = [
  ["Econ",    "#F0B429", /\bgold\b|interest|income|econom/i],
  ["Items",   "#4FA3F7", /\bitem|component|anvil|emblem|artifact/i],
  ["Combat",  "#FF7043", /damage|attack|health|armor|shield|heal|resist|crit/i],
  ["Scaling", "#8FE3D2", /each round|per round|stacks|permanently|over time|grows/i],
  ["Reroll",  "#B57BEE", /reroll|refresh|shop odds|\brolls?\b/i],
  ["Level",   "#4ADE80", /\blevel|\bxp\b|experience/i],
];

function typeTags(row) {
  const text = `${row.name} ${row.description || ""}`;
  const tags = TYPE_RULES.filter(([, , re]) => re.test(text)).map(([label, color]) => ({ label, color }));
  if (row.traits?.length) tags.unshift({ label: "Traits", color: "#F472B6" });
  return tags.slice(0, 3);
}

const SORTS = {
  rarity: { label: "Rarity", fn: (a, b) => (RARITY_RANK[a.rarity] || 9) - (RARITY_RANK[b.rarity] || 9)
                                        || a.name.localeCompare(b.name) },
  name:   { label: "Name",   fn: (a, b) => a.name.localeCompare(b.name) },
};

function AugmentCard({ a }) {
  return (
    <>
      <span className="flex items-center gap-2 mb-1.5">
        <AugmentIcon src={a.icon} name={a.name} size={26} />
        <span className="min-w-0">
          <span className="display text-[13px] block" style={{ color: "var(--text)" }}>{a.name}</span>
          {a.rarity && (
            <span className="text-[9.5px] uppercase tracking-wider" style={{ color: RARITY[a.rarity] }}>
              {a.rarity}
            </span>
          )}
        </span>
      </span>
      {a.description ? (
        <span className="block text-[11.5px] leading-relaxed whitespace-pre-line"
              style={{ color: "var(--text)", opacity: 0.85 }}>
          {a.description}
        </span>
      ) : (
        <span className="block text-[11.5px]" style={{ color: "var(--dim)" }}>
          No effect text published for this augment.
        </span>
      )}
    </>
  );
}

/**
 * Augment reference.
 *
 * Deliberately has no tier list or placement columns. Riot's tft-match-v1
 * does not report which augments a player took, so no augment statistic can be
 * computed from match data at all -- a tier list here would either be empty or
 * invented. What IS available is the full pool with rarity and effect text,
 * which is genuinely useful as a lookup, so that is what this is.
 */
export default function Augments({ augmentMeta, championMeta, traitMeta }) {
  const [rarityFilter, setRarityFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("rarity");

  const rows = useMemo(() => Object.entries(augmentMeta || {}).map(([id, m]) => ({
    id, name: m.name || id, icon: m.icon, rarity: m.rarity,
    description: m.description, traits: m.traits || [],
    refs: m.refs, variants: m.variants,
  })), [augmentMeta]);

  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const r of RARITY_ORDER) c[r] = rows.filter((x) => x.rarity === r).length;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rarityFilter === "all" ? rows : rows.filter((r) => r.rarity === rarityFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q)
        || (r.description || "").toLowerCase().includes(q));
    }
    return [...out].sort(SORTS[sortBy].fn);
  }, [rows, rarityFilter, query, sortBy]);

  const linked = useMemo(() => rows.filter(
    (r) => r.variants?.length || r.refs?.champions?.length || r.refs?.traits?.length).length, [rows]);

  const chip = (active, color) => ({
    borderColor: active ? color : "var(--line)",
    background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
    color: active ? "var(--text)" : "var(--dim)",
  });

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] py-10 text-center" style={{ color: "var(--dim)" }}>
        No augment catalogue published yet. Re-run the publish step.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="display text-[15px] font-semibold">Augments</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--dim)" }}>
            All {rows.length} augments in the set pool · hover any row for its full effect
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-[10px]" style={{ color: "var(--dim)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search name or effect"
                   className="rounded pl-7 pr-2 py-2 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors w-56"
                   style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                  className="text-[12px] rounded px-2 py-2 border outline-none"
                  style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}
          </select>
        </div>
      </div>

      {/* Why there are no placements here */}
      <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 mb-4 text-[11.5px] leading-relaxed"
           style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--dim)" }}>
        <Info size={13} className="mt-[2px] shrink-0" style={{ color: "var(--accent)" }} />
        <span>
          There are no win rates or tiers on this page. Riot's match API doesn't report which
          augments players took, so augment performance can't be measured from it — and a tier
          list built without that data would be guesswork. Use the{" "}
          <strong style={{ color: "var(--text)" }}>Planner</strong> for recommendations that are
          measured.
        </span>
      </div>

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--muted)" }}>rarity</span>
        <button onClick={() => setRarityFilter("all")}
                className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
                style={chip(rarityFilter === "all", "var(--text)")}>
          All <span className="mono opacity-60">{counts.all}</span>
        </button>
        {RARITY_ORDER.map((r) => (
          <button key={r} onClick={() => setRarityFilter(r)}
                  className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
                  style={chip(rarityFilter === r, RARITY[r])}>
            <span className="w-2 h-2 rounded-full" style={{ background: RARITY[r] }} />
            {r} <span className="mono opacity-60">{counts[r]}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--line)" }}>
        <table className="w-full border-collapse" style={{ minWidth: 640 }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              {[["Augment", "left"], ["Rarity", "center"], ["Type", "left"], ["Links to", "left"]].map(([h, align]) => (
                <th key={h}
                    className="text-[11px] uppercase tracking-wider font-semibold px-3 py-2.5 border-b whitespace-nowrap"
                    style={{ color: "var(--dim)", borderColor: "var(--line)", textAlign: align }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="row-hover border-b" style={{ borderColor: "var(--line)" }}>
                <HoverCard as="td" className="px-3 py-2 align-middle cursor-default"
                           card={<AugmentCard a={a} />}>
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="shrink-0 rounded p-[2px]"
                          style={{ border: `1.5px solid ${RARITY[a.rarity] || "var(--line)"}` }}>
                      <AugmentIcon src={a.icon} name={a.name} size={26} />
                    </span>
                    <span className="text-[13px] font-medium truncate">{a.name}</span>
                  </span>
                </HoverCard>

                <td className="px-3 py-2 text-center whitespace-nowrap">
                  {a.rarity ? (
                    <span className="text-[10px] uppercase tracking-wider"
                          style={{ color: RARITY[a.rarity] }}>{a.rarity}</span>
                  ) : <span style={{ color: "var(--muted)" }}>—</span>}
                </td>

                <td className="px-3 py-2">
                  <span className="flex items-center gap-1 flex-wrap">
                    {typeTags(a).map((t) => (
                      <span key={t.label} className="text-[10px] px-1.5 py-[2px] rounded border whitespace-nowrap"
                            style={{ color: t.color,
                                     borderColor: `color-mix(in srgb, ${t.color} 40%, transparent)`,
                                     background: `color-mix(in srgb, ${t.color} 10%, transparent)` }}>
                        {t.label}
                      </span>
                    ))}
                  </span>
                </td>

                {/* What this augment is tied to. The effect text lives in the
                    hover card, so the column shows the connections instead:
                    the champions and traits it names, and its own tiered
                    variants. Blank where Riot's data supports no link. */}
                <td className="px-3 py-2" style={{ maxWidth: 400 }}>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {a.refs?.champions?.map((cid) => (
                      <span key={cid} className="flex items-center gap-1 rounded border px-1.5 py-[2px]"
                            style={{ borderColor: "var(--line)" }}>
                        <ChampionIcon src={championMeta?.[cid]?.icon} name={championMeta?.[cid]?.name || cid} size={16} />
                        <span className="text-[10.5px]" style={{ color: "var(--dim)" }}>
                          {championMeta?.[cid]?.name || cid}
                        </span>
                      </span>
                    ))}
                    {a.refs?.traits?.map((tid) => (
                      <span key={tid} className="flex items-center gap-1 rounded border px-1.5 py-[2px]"
                            style={{ borderColor: "var(--line)" }}>
                        <TraitBadge name={traitMeta?.[tid]?.name || tid} meta={traitMeta?.[tid]}
                                    size={14} showName={false} units={null} />
                        <span className="text-[10.5px]" style={{ color: "var(--dim)" }}>
                          {traitMeta?.[tid]?.name || tid}
                        </span>
                      </span>
                    ))}
                    {a.variants?.length > 0 && (
                      <span className="flex items-center gap-1 flex-wrap">
                        <span className="text-[9.5px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                          also
                        </span>
                        {a.variants.map((vid) => (
                          <span key={vid} className="text-[10.5px] px-1.5 py-[2px] rounded border"
                                style={{ borderColor: "var(--line)",
                                         color: RARITY[augmentMeta?.[vid]?.rarity] || "var(--dim)" }}>
                            {augmentMeta?.[vid]?.name || vid}
                          </span>
                        ))}
                      </span>
                    )}
                    {!a.refs?.champions?.length && !a.refs?.traits?.length && !a.variants?.length && (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-[12px] py-10 text-center" style={{ color: "var(--dim)" }}>
            Nothing matches this filter.
          </p>
        )}
      </div>

      <p className="text-[10px] mt-4 leading-snug" style={{ color: "var(--dim)" }}>
        “Links to” shows the champions and traits an augment names in its own effect text, plus
        its tiered variants — {linked} of {rows.length} augments have such a link, and the rest are
        blank rather than guessed. Riot publishes no augment-to-augment synergy data, and with no
        augment records in the match API there is nothing to measure pairings from. Type tags are
        inferred from effect text. Rarity is recovered from the augment's icon variant.
      </p>
    </div>
  );
}
