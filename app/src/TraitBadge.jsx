import React, { useState } from "react";

/**
 * Trait badge in the game's own visual language: a hexagon carrying the trait
 * icon, tinted by the breakpoint tier reached, with the unit count alongside.
 *
 * Riot's `style` ramp on each breakpoint is what the game colours by, so the
 * badge for "5 Anima" here matches the colour a player saw on their board
 * rather than a palette we invented.
 */
const STYLE_COLORS = {
  0: "#5C6478",   // inactive
  1: "#B0764A",   // bronze
  2: "#9FB0C4",   // silver
  3: "#F0B429",   // gold
  4: "#8FE3D2",   // chromatic
  5: "#8FE3D2",   // unique / prismatic
};

// Highest breakpoint the board actually reached.
function styleFor(meta, units) {
  const hit = (meta?.breakpoints || []).filter((b) => units >= b.units);
  return hit.length ? hit[hit.length - 1].style : 0;
}

function HexIcon({ icon, color, size, name }) {
  const [broken, setBroken] = useState(false);
  // A clip-path hexagon matches the in-game synergy badge shape; the tint sits
  // behind a slightly inset icon so the silhouette stays readable at 24-30px.
  const hex = { clipPath: "polygon(25% 2%, 75% 2%, 100% 50%, 75% 98%, 25% 98%, 0% 50%)" };
  return (
    <span className="relative inline-flex items-center justify-center shrink-0"
          style={{ width: size, height: size }}>
      <span className="absolute inset-0" style={{ ...hex, background: color, opacity: 0.9 }} />
      {icon && !broken ? (
        <img src={icon} alt="" loading="lazy" onError={() => setBroken(true)}
             className="relative"
             style={{ width: size * 0.62, height: size * 0.62,
                      // Trait icons ship as white-on-transparent glyphs.
                      filter: "brightness(0) invert(1)" }} />
      ) : (
        <span className="relative display font-bold"
              style={{ fontSize: size * 0.4, color: "#12151C" }}>
          {(name || "?").slice(0, 1)}
        </span>
      )}
    </span>
  );
}

export function TraitBadge({ name, units, meta, size = 26, showName = true, pct }) {
  const style = styleFor(meta, units);
  const color = STYLE_COLORS[style] ?? STYLE_COLORS[0];
  const label = meta?.name || name;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border pl-1 pr-2 py-1"
          title={meta?.description || label}
          style={{
            borderColor: style ? `color-mix(in srgb, ${color} 45%, transparent)` : "var(--line)",
            background: style ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent",
          }}>
      <HexIcon icon={meta?.icon} color={color} size={size} name={label} />
      {units != null && (
        <span className="mono text-[12px] font-bold" style={{ color }}>{units}</span>
      )}
      {showName && (
        <span className="text-[12px] truncate" style={{ color: "var(--text)" }}>{label}</span>
      )}
      {pct != null && (
        <span className="mono text-[10.5px]" style={{ color: "var(--dim)" }}>
          {(pct * 100).toFixed(0)}%
        </span>
      )}
    </span>
  );
}

/** Compact icon-only variant for dense lists (champion rows). */
export function TraitChip({ name, meta }) {
  const label = meta?.name || name;
  return (
    <span className="inline-flex items-center gap-1" title={meta?.description || label}>
      <HexIcon icon={meta?.icon} color={STYLE_COLORS[2]} size={16} name={label} />
      <span className="text-[10.5px]" style={{ color: "var(--dim)" }}>{label}</span>
    </span>
  );
}
