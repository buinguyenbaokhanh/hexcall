import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { StatChip } from "./stats.jsx";
import { HoverCard } from "./HoverCard.jsx";

// Shared image-with-graceful-fallback avatars for champions, items and
// augments. Real art comes from the pipeline (Data Dragon icon URLs baked
// into the published stats); when a URL is missing or 404s -- which happens
// for TFT sets Data Dragon hasn't published art for yet -- these fall back to
// a small styled placeholder instead of a broken image icon.

export function ChampionIcon({ src, name, size = 24, className = "" }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  if (!src || broken) {
    return (
      <div
        className={`shrink-0 rounded-full flex items-center justify-center font-semibold select-none ${className}`}
        style={{ width: size, height: size, background: "var(--faint)", color: "var(--dim)", fontSize: size * 0.42 }}
        title={name}
      >
        {initial}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name || ""}
      title={name}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`shrink-0 rounded-full object-cover border ${className}`}
      style={{ width: size, height: size, borderColor: "var(--line)" }}
    />
  );
}

// Small icon used inside the tooltip's "combine" recipe row -- no nested
// tooltip of its own, just the picture.
function MiniItemIcon({ src, name, size = 22 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div className="shrink-0 rounded" style={{ width: size, height: size, background: "var(--faint)", border: "1px solid var(--line)" }} />;
  }
  return (
    <img src={src} alt={name || ""} loading="lazy" onError={() => setBroken(true)}
         className="shrink-0 rounded border" style={{ width: size, height: size, borderColor: "var(--line)" }} />
  );
}

export function ItemIcon({ src, name, size = 20, className = "", meta = null }) {
  const [broken, setBroken] = useState(false);
  const img = !src || broken ? (
    <div
      className={`shrink-0 rounded ${className}`}
      style={{ width: size, height: size, background: "var(--faint)", border: "1px solid var(--line)" }}
      title={meta ? undefined : name}
    />
  ) : (
    <img
      src={src}
      alt={name || ""}
      title={meta ? undefined : name}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`shrink-0 rounded border ${className}`}
      style={{ width: size, height: size, borderColor: "var(--line)" }}
    />
  );

  if (!meta) return img;

  return (
    <HoverCard className="inline-flex" card={
        <>
          <span className="flex items-center gap-2 mb-1.5">
            <MiniItemIcon src={meta.icon || src} name={meta.name || name} size={26} />
            <span className="display text-[13px]" style={{ color: "var(--text)" }}>{meta.name || name}</span>
          </span>

          {meta.stats?.length > 0 && (
            <span className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b" style={{ borderColor: "var(--line)" }}>
              {meta.stats.map((s) => (
                <StatChip key={s.key || s.label} statKey={s.key} label={s.label} value={s.value} />
              ))}
            </span>
          )}

          {meta.description && (
            <span className="block text-[11.5px] leading-relaxed mb-2 whitespace-pre-line"
                  style={{ color: "var(--text)", opacity: 0.85 }}>
              {meta.description}
            </span>
          )}

          {meta.recipe?.length > 0 ? (
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--faint)" }}>combine</span>
              {meta.recipe.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color: "var(--faint)" }}>+</span>}
                  <MiniItemIcon src={c.icon} name={c.name} size={20} />
                </React.Fragment>
              ))}
            </span>
          ) : meta.recipe && (
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--faint)" }}>basic component</span>
          )}
        </>
      }>
      {img}
    </HoverCard>
  );
}

export function AugmentIcon({ src, name, size = 24, className = "" }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div
        className={`shrink-0 rounded flex items-center justify-center ${className}`}
        style={{
          width: size, height: size,
          background: "color-mix(in srgb, var(--accent) 16%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
        }}
        title={name}
      >
        <Sparkles size={Math.round(size * 0.55)} style={{ color: "var(--accent)" }} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name || ""}
      title={name}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`shrink-0 rounded border ${className}`}
      style={{ width: size, height: size, borderColor: "var(--line)" }}
    />
  );
}

// Comp signatures look like "Anima5_Duelist2 :: TFT17_Fiora" -- the part
// after " :: " is the carry's raw champion id, usable as a champion_icons key.
export function carryIdFromSig(sig = "") {
  const idx = sig.indexOf(" :: ");
  return idx === -1 ? null : sig.slice(idx + 4);
}
