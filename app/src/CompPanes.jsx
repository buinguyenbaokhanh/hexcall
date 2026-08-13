import React, { useState, useMemo } from "react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";

const short = (id = "") => id.replace(/^TFT\d*_(Item_)?/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");

const place = (v, baseline) =>
  v < baseline - 0.15 ? "var(--signal)" : v > baseline + 0.15 ? "var(--danger)" : "var(--text)";

/**
 * A labelled horizontal bar with its value on the right — the shape used
 * throughout the reference for play-rate and frequency breakdowns.
 */
function Bar({ pct, max = 1, label, value, sub, color = "var(--faint)", onClick, active }) {
  return (
    <button onClick={onClick} disabled={!onClick}
            className="w-full flex items-center gap-2 rounded px-1.5 py-1 text-left"
            style={{ background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                     cursor: onClick ? "pointer" : "default" }}>
      {label}
      <span className="relative flex-1 h-[18px] rounded overflow-hidden" style={{ background: "var(--bg)" }}>
        <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(pct / max) * 100}%`, background: color }} />
      </span>
      <span className="text-right shrink-0" style={{ width: 78 }}>
        <span className="mono text-[12px] font-bold block leading-tight">{value}</span>
        {sub && <span className="mono text-[10px] block leading-tight" style={{ color: "var(--dim)" }}>{sub}</span>}
      </span>
    </button>
  );
}

/** Units pane: play-rate list on the left, star + item breakdown on the right. */
export function UnitsPane({ view, baseline }) {
  const units = view.units || [];
  const [sel, setSel] = useState(units[0]?.id);
  const unit = units.find((u) => u.id === sel) || units[0];
  const maxPlay = Math.max(...units.map((u) => u.play_rate), 0.01);

  if (!units.length) return <Empty>No unit data in this cut.</Empty>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <PaneTitle>Unit play rate</PaneTitle>
        <div className="space-y-[2px] max-h-[330px] overflow-y-auto scroll-thin pr-1">
          {units.map((u) => (
            <Bar key={u.id} pct={u.play_rate} max={maxPlay} active={u.id === unit?.id}
                 onClick={() => setSel(u.id)}
                 label={<ChampionIcon src={u.icon} name={short(u.name || u.id)} size={24} />}
                 value={<span style={{ color: place(u.avg_placement, baseline) }}>{u.avg_placement}</span>}
                 sub={`${(u.play_rate * 100).toFixed(1)}%`} />
          ))}
        </div>
      </div>

      {unit && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ChampionIcon src={unit.icon} name={short(unit.name || unit.id)} size={34} />
            <div>
              <p className="text-[13.5px] font-medium">{short(unit.name || unit.id)}</p>
              <p className="mono text-[11px]" style={{ color: place(unit.avg_placement, baseline) }}>
                {unit.avg_placement} avg place
              </p>
            </div>
          </div>

          {Object.keys(unit.stars || {}).length > 0 && (
            <>
              <PaneTitle>Star level</PaneTitle>
              <div className="space-y-[2px] mb-3">
                {Object.entries(unit.stars).sort((a, b) => Number(b[0]) - Number(a[0])).map(([s, v]) => (
                  <Bar key={s} pct={v.pct}
                       label={<span className="mono text-[11px] w-9 shrink-0"
                                    style={{ color: "var(--accent)" }}>{"★".repeat(Number(s))}</span>}
                       value={<span style={{ color: place(v.avg, baseline) }}>{v.avg}</span>}
                       sub={`${(v.pct * 100).toFixed(1)}%`} />
                ))}
              </div>
            </>
          )}

          {unit.item_counts?.length > 0 && (
            <>
              <PaneTitle>Number of items</PaneTitle>
              <div className="space-y-[2px]">
                {[...unit.item_counts].sort((a, b) => b.items - a.items).map((r) => (
                  <Bar key={r.items} pct={r.pct}
                       label={<span className="mono text-[11px] w-14 shrink-0" style={{ color: "var(--dim)" }}>
                                {r.items} item{r.items === 1 ? "" : "s"}
                              </span>}
                       value={<span style={{ color: place(r.avg, baseline) }}>{r.avg}</span>}
                       sub={`${(r.pct * 100).toFixed(1)}%`} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Items pane: item play rate, and who held each one best. */
export function ItemsPane({ view, itemMeta, baseline }) {
  const items = view.top_items || [];
  const [sel, setSel] = useState(items[0]?.id);
  const item = items.find((i) => i.id === sel) || items[0];
  const maxPct = Math.max(...items.map((i) => i.pct || 0), 0.01);

  if (!items.length) return <Empty>No item reached the sample floor in this cut.</Empty>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <PaneTitle>Item play rate</PaneTitle>
        <div className="space-y-[2px] max-h-[330px] overflow-y-auto scroll-thin pr-1">
          {items.map((i) => (
            <Bar key={i.id} pct={i.pct || 0} max={maxPct} active={i.id === item?.id}
                 onClick={() => setSel(i.id)}
                 label={<ItemIcon src={i.icon} name={i.name} size={24} meta={itemMeta?.[i.id]} />}
                 value={<span style={{ color: place(i.avg, baseline) }}>{i.avg}</span>}
                 sub={`${((i.pct || 0) * 100).toFixed(1)}%`} />
          ))}
        </div>
      </div>

      {item && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ItemIcon src={item.icon} name={item.name} size={32} meta={itemMeta?.[item.id]} />
            <div>
              <p className="text-[13.5px] font-medium">{item.name}</p>
              <p className="mono text-[11px]" style={{ color: place(item.avg, baseline) }}>
                {item.avg} avg place · n={item.n}
              </p>
            </div>
          </div>
          <PaneTitle>Best holders</PaneTitle>
          {item.holders?.length ? (
            <div className="space-y-1">
              {item.holders.map((h) => (
                <div key={h.id} className="flex items-center gap-2.5 rounded border px-2 py-1.5"
                     style={{ borderColor: "var(--line)" }}>
                  <ChampionIcon src={h.icon} name={short(h.name || h.id)} size={24} />
                  <span className="text-[12px] flex-1 min-w-0 truncate">{short(h.name || h.id)}</span>
                  <span className="mono text-[10.5px] shrink-0" style={{ color: "var(--dim)" }}>
                    {(h.share * 100).toFixed(0)}% of holders
                  </span>
                  <span className="mono text-[12.5px] font-bold w-16 text-right shrink-0"
                        style={{ color: place(h.avg, baseline) }}>
                    {h.avg}
                    <span className="text-[9.5px] ml-1" style={{ color: "var(--faint)" }}>
                      {h.avg - view.avg_placement >= 0 ? "+" : ""}{(h.avg - view.avg_placement).toFixed(2)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No single unit held this often enough to rank.</Empty>
          )}
        </div>
      )}
    </div>
  );
}

/** Traits pane: breakpoint distribution per trait. */
export function TraitsPane({ view, traitMeta, baseline }) {
  const traits = view.traits || [];
  const [sel, setSel] = useState(traits[0]?.name);
  const trait = traits.find((t) => t.name === sel) || traits[0];
  if (!traits.length) return <Empty>No trait data in this cut.</Empty>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <PaneTitle>Trait play rate</PaneTitle>
        <div className="space-y-[2px] max-h-[330px] overflow-y-auto scroll-thin pr-1">
          {traits.map((t) => (
            <Bar key={t.name} pct={t.pct} active={t.name === trait?.name}
                 onClick={() => setSel(t.name)}
                 label={<TraitBadge name={t.display || t.name} units={t.units}
                                    meta={traitMeta?.[t.name]} size={18} showName={false} />}
                 value={<span style={{ color: place(t.avg, baseline) }}>{t.avg}</span>}
                 sub={`${(t.pct * 100).toFixed(1)}%`} />
          ))}
        </div>
      </div>

      {trait && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TraitBadge name={trait.display || trait.name} units={trait.units}
                        meta={traitMeta?.[trait.name]} size={26} showName={false} />
            <p className="text-[13.5px] font-medium">{trait.display || trait.name}</p>
          </div>
          <PaneTitle>By breakpoint</PaneTitle>
          <div className="space-y-1">
            {(trait.levels || []).map((l) => (
              <div key={l.units} className="flex items-center gap-2.5 rounded border px-2 py-1.5"
                   style={{ borderColor: "var(--line)" }}>
                <TraitBadge name={trait.display || trait.name} units={l.units}
                            meta={traitMeta?.[trait.name]} size={20} showName={false} />
                <span className="mono text-[11px] flex-1" style={{ color: "var(--dim)" }}>
                  {(l.pct * 100).toFixed(1)}% of boards · n={l.n}
                </span>
                <span className="mono text-[13px] font-bold w-11 text-right"
                      style={{ color: place(l.avg, baseline) }}>{l.avg}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--faint)" }}>
            Placement at each breakpoint this comp actually reached — the gap between them is
            what going one unit deeper is worth.
          </p>
        </div>
      )}
    </div>
  );
}

/** Stats pane: placement histogram and how contested the comp is. */
export function StatsPane({ view, comp, contested, baseline }) {
  const hist = view.placements || [];
  const maxPct = Math.max(...hist.map((h) => h.pct), 0.01);
  const maxCon = Math.max(...(contested || []).map((c) => c.pct), 0.01);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <PaneTitle>Placement distribution</PaneTitle>
        <div className="flex items-end gap-1 h-[130px] mb-1">
          {hist.map((h) => (
            <div key={h.place} className="flex-1 flex flex-col items-center justify-end gap-1">
              <span className="mono text-[9.5px]" style={{ color: "var(--dim)" }}>
                {(h.pct * 100).toFixed(0)}%
              </span>
              <span className="w-full rounded-t"
                    style={{ height: `${(h.pct / maxPct) * 92}px`,
                             background: h.place <= 4 ? "var(--signal)" : "var(--faint)",
                             opacity: h.place <= 4 ? 0.75 : 1 }} />
              <span className="mono text-[10px]" style={{ color: "var(--dim)" }}>{h.place}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] leading-snug" style={{ color: "var(--faint)" }}>
          An average hides shape — a comp that wins or bottom-fours reads the same as one that
          always takes 4th.
        </p>
      </div>

      <div>
        <PaneTitle>How contested</PaneTitle>
        {contested?.length ? (
          <>
            <div className="space-y-[2px]">
              {contested.map((c) => (
                <Bar key={c.others} pct={c.pct} max={maxCon}
                     label={<span className="mono text-[11px] w-24 shrink-0" style={{ color: "var(--dim)" }}>
                              {c.others === 0 ? "uncontested" : `+${c.others} other${c.others > 1 ? "s" : ""}`}
                            </span>}
                     value={`${(c.pct * 100).toFixed(1)}%`} />
              ))}
            </div>
            <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--faint)" }}>
              How many other players in the same lobby ran this comp. Only measurable because
              placements are compared within a shared lobby.
            </p>
          </>
        ) : <Empty>Not enough shared lobbies to measure.</Empty>}

        <div className="grid grid-cols-2 gap-2 mt-3">
          {[["top 4", `${(comp.top4_rate * 100).toFixed(1)}%`],
            ["1st", `${(comp.win_rate * 100).toFixed(1)}%`],
            ["sample", comp.n.toLocaleString()],
            ["95% interval", comp.stderr ? `±${(comp.stderr * 1.96).toFixed(2)}` : "—"]].map(([l, v]) => (
            <div key={l} className="rounded border px-2 py-1.5" style={{ borderColor: "var(--line)" }}>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--dim)" }}>{l}</p>
              <p className="mono text-[14px] font-bold">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PaneTitle({ children }) {
  return (
    <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--faint)" }}>
      {children}
    </p>
  );
}

function Empty({ children }) {
  return <p className="text-[12px] py-4" style={{ color: "var(--dim)" }}>{children}</p>;
}
