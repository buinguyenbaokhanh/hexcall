import React from "react";

/**
 * Per-stat-type colours, shared by item tooltips and champion stat rows.
 *
 * Keyed by the raw effect key the pipeline emits (AD, Armor, ...) rather than
 * the display label, so rewording or localising a label can't silently break
 * the colour mapping.
 *
 * The families follow what players already associate with each stat in-game:
 * offence runs red/orange, magic runs purple, physical defence runs brown/tan,
 * magic defence teal, health green, mana blue. These are fixed semantic
 * colours rather than theme tokens -- "attack damage is red" holds regardless
 * of the surrounding palette, and they're used at large enough sizes and with
 * their label alongside that they don't carry meaning by colour alone.
 */
export const STAT_COLORS = {
  AD: "#FF7043",            // attack damage — orange-red
  AS: "#FFCA3A",            // attack speed — gold
  AP: "#B57BEE",            // ability power — purple
  Mana: "#4FA3F7",          // mana — blue
  Health: "#4ADE80",        // health — green
  Armor: "#C98B5E",         // armor (physical defence) — brown
  MagicResist: "#38BDF8",   // magic resist — cyan
  CritChance: "#FF8FA3",    // crit — pink-red
  CritDamageToGive: "#FF5C7A",
  LifeSteal: "#F472B6",     // sustain — pink
  StatOmnivamp: "#F472B6",
  DodgeChance: "#22D3EE",
  BonusPercentHP: "#4ADE80",
};

// Compact labels for the champion stat row, where the full name ("Magic
// Resist") would wrap and crowd out the number.
export const STAT_SHORT = {
  AD: "AD", AS: "AS", AP: "AP", Mana: "MANA", Health: "HP",
  Armor: "ARM", MagicResist: "MR", CritChance: "CRIT",
  CritDamageToGive: "CRIT DMG", LifeSteal: "VAMP", StatOmnivamp: "OMNIVAMP",
  DodgeChance: "DODGE", BonusPercentHP: "HP",
};

export const statColor = (key) => STAT_COLORS[key] || "var(--text)";

/**
 * One "+35 Attack Damage" row. The value carries the stat's colour and the
 * label sits in the standard dim text colour -- previously both were faint
 * enough to disappear against the tooltip background.
 */
export function StatChip({ statKey, label, value, showPlus = true }) {
  const color = statColor(statKey);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="mono text-[12px] font-bold" style={{ color }}>
        {showPlus ? "+" : ""}{value}
      </span>
      <span className="text-[11px]" style={{ color: "var(--dim)" }}>{label}</span>
    </span>
  );
}

/**
 * Champion base-stat strip: label above, value below, colour-coded per stat.
 * Values are 1-star base, which is how TFT itself lists them.
 */
export function StatGrid({ stats, className = "" }) {
  const entries = Object.entries(stats || {});
  if (entries.length === 0) return null;
  return (
    <div className={`grid grid-cols-3 sm:grid-cols-6 gap-1.5 ${className}`}>
      {entries.map(([key, value]) => (
        <div key={key} className="rounded border px-2 py-1.5 text-center"
             style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
          <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "var(--dim)" }}>
            {STAT_SHORT[key] || key}
          </p>
          <p className="mono text-[13px] font-bold" style={{ color: statColor(key) }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
