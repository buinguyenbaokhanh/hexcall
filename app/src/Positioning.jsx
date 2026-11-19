import React, { useState } from "react";
import { Crown, FlipHorizontal2 } from "lucide-react";
import { ChampionIcon } from "./icons.jsx";

// Stagger tanks across the middle, leave room behind them for short-range
// carries, and separate long-range units along the back edge.
const COLUMN_ORDER = [
  [4, 2, 5, 1, 3, 6, 0],
  [4, 2, 5, 1, 3, 6, 0],
  [5, 1, 3, 6, 0, 4, 2],
  [6, 0, 4, 2, 5, 1, 3],
];

function suggestFormation(view, catalogue) {
  const slots = Array(28).fill(null);
  const missing = [];
  const carryId = view?.carries?.[0]?.id;
  const ids = view?.lineup?.units || [];
  const units = [];
  ids.forEach((id, index) => {
    const meta = catalogue[id];
    const detail = view.units?.find((u) => u.id === id);
    const name = meta?.name || detail?.name || id;
    if (!Number.isInteger(meta?.attack_range) || meta.attack_range < 1) {
      missing.push(name);
      return;
    }
    const stats = meta.stats || {};
    const durability = (stats.Health || 0) * (1 + ((stats.Armor || 0) + (stats.MagicResist || 0)) / 200);
    units.push({ id, index, name, icon: meta.icon || detail?.icon, range: meta.attack_range,
      carry: id === carryId && index === ids.indexOf(carryId), durability });
  });
  const hasFrontline = units.some((u) => !u.carry && u.range === 1);
  // Reserve each unit's ideal row before filling any overflow into nearby rows.
  const ordered = units.sort((a, b) => Number(b.carry) - Number(a.carry) || b.durability - a.durability);
  const overflow = [];
  function place(unit, row) {
    const column = COLUMN_ORDER[row].find((col) => !slots[row * 7 + col]);
    if (column === undefined) return false;
    slots[row * 7 + column] = unit;
    return true;
  }
  for (const unit of ordered) {
    const row = unit.carry && unit.range === 1 && hasFrontline ? 1 : Math.min(3, unit.range - 1);
    if (!place(unit, row)) overflow.push({ unit, row });
  }
  for (const { unit, row } of overflow) {
    [0, 1, 2, 3].sort((a, b) => Math.abs(a - row) - Math.abs(b - row)).some((r) => place(unit, r));
  }
  return { slots, missing };
}

export default function Positioning({ view, championMeta = {} }) {
  const [mirrored, setMirrored] = useState(false);
  const [selected, setSelected] = useState(null);
  const { slots, missing } = suggestFormation(view, championMeta);
  const active = slots.find((u) => u && u.index === selected) || slots.find((u) => u?.carry) || slots.find(Boolean);
  const cell = active ? slots.indexOf(active) : -1;
  const columnAt = (col) => mirrored ? 6 - col : col;
  return (
    <section className="position-guide" aria-label="Recommended Positioning">
      <div className="position-header">
        <h4 className="section-title">Recommended Positioning</h4>
        {active && <button type="button" onClick={() => setMirrored(!mirrored)} aria-pressed={mirrored}>
          <FlipHorizontal2 size={15} aria-hidden="true" />Mirror Board
        </button>}
      </div>
      {active ? <>
        <p className="position-intro">This level {view.lineup.level} lineup appeared in ranked games. Starting hexes are suggested from attack range and durability.</p>
        <div className="position-layout">
          <div className="position-field">
            <span className="position-side">Enemy Side</span>
            {[0, 1, 2, 3].map((row) => (
              <div className="position-row" key={row}>
                {Array.from({ length: 7 }, (_, col) => {
                  const unit = slots[row * 7 + columnAt(col)];
                  if (!unit) return <span className="position-hex empty" key={col} aria-hidden="true" />;
                  return <button className="position-hex" type="button" key={col}
                      aria-pressed={unit === active} data-carry={unit.carry || undefined}
                      aria-label={`${unit.name}${unit.carry ? ", carry" : ""}, row ${row + 1}, column ${col + 1}`}
                      onClick={() => setSelected(unit.index)}>
                    <span className="position-token" aria-hidden="true">
                      <ChampionIcon key={unit.id} src={unit.icon} name={unit.name} size={32} />
                      <span>{unit.name}</span>
                    </span>
                    {unit.carry && <Crown className="position-crown" size={13} aria-hidden="true" />}
                  </button>;
                })}
              </div>
            ))}
            <span className="position-side">Your Backline</span>
          </div>
          <div className="position-detail" aria-live="polite" aria-atomic="true">
            <div className="position-unit">
              <ChampionIcon key={active.id} src={active.icon} name={active.name} size={35} />
              <div><strong>{active.name}</strong><small>{active.carry ? "Primary Carry · " : ""}{active.range}-hex range</small></div>
            </div>
            <p>Row {Math.floor(cell / 7) + 1}, column {columnAt(cell % 7) + 1}</p>
            <p>{cell < 7 ? "Start on the front line to engage enemies early."
              : active.range === 1 ? "Start behind the frontline so this melee unit can join after the first contact."
              : cell < 21 ? "Start behind the first row to give this unit cover while it moves into attack range."
              : "Start deep to give this unit time to attack while the frontline holds."}</p>
            <small>Select a unit to inspect its hex. Mirror the board to switch sides after scouting.</small>
          </div>
        </div>
        {missing.length > 0 && <p className="position-intro">Awaiting range data for {missing.join(", ")}.</p>}
      </> : <p className="position-intro">Positioning is available once this comp has a sampled lineup and champion attack ranges.</p>}
    </section>
  );
}
