import React, { useMemo } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Formatting shared by every stats tab.

export function timeAgo(ts) {
  if (!ts) return "unknown";
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export const num = (v) => (v ?? 0).toLocaleString();
export const pct = (v, digits = 1) => `${((v || 0) * 100).toFixed(digits)}%`;

// TFT's own cost-tier colours -- players read grey/green/blue/purple/gold as
// 1/2/3/4/5 cost straight from the shop, so reusing that needs no legend.
export const COST_COLORS = {
  1: "#9FB0C4", 2: "#3FBF6F", 3: "#4FA3F7", 4: "#B571F0", 5: "#F0B429",
};

// ---------------------------------------------------------------------------

/**
 * Page header for a stats tab: what the table is, and how much data is behind
 * it. The sample size and freshness sit together in one block deliberately --
 * a placement average means nothing without the board count it was measured
 * over, and a stale snapshot is worse than an obviously empty one.
 */
export function PageHeader({ title, blurb, sampleSize, generatedAt, children }) {
  return (
    <div className="flex items-start justify-between gap-6 flex-wrap mb-4">
      <div className="min-w-0 max-w-[620px]">
        <h2 className="display text-[19px] font-semibold">{title}</h2>
        {blurb && (
          <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--dim)" }}>{blurb}</p>
        )}
        {children}
      </div>
      {(sampleSize != null || generatedAt != null) && (
        <div className="rounded-lg border px-3.5 py-2.5 shrink-0"
             style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          {generatedAt != null && (
            <div className="flex items-baseline justify-between gap-6">
              <span className="text-[10.5px]" style={{ color: "var(--dim)" }}>Last updated</span>
              <span className="mono text-[11.5px]">{timeAgo(generatedAt)}</span>
            </div>
          )}
          {sampleSize != null && (
            <div className="flex items-baseline justify-between gap-6 mt-1">
              <span className="text-[10.5px]" style={{ color: "var(--dim)" }}>Boards analysed</span>
              <span className="mono text-[11.5px] font-bold">{num(sampleSize)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One row of pill filters. `options` is [value, label, color?] triples. */
export function FilterChips({ label, options, value, onChange, counts }) {
  const style = (active, color = "var(--text)") => ({
    borderColor: active ? color : "var(--line)",
    background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
    color: active ? "var(--text)" : "var(--dim)",
  });
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {label && (
        <span className="text-[10px] uppercase tracking-wider mr-0.5" style={{ color: "var(--faint)" }}>
          {label}
        </span>
      )}
      {options.map(([val, text, color]) => (
        <button key={String(val)} onClick={() => onChange(val)}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5"
                style={style(value === val, color)}>
          {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
          {text}
          {counts?.[val] != null && <span className="mono opacity-60">{counts[val]}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmented control for mutually exclusive views (Overall / by Level). */
export function SegmentedToggle({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden shrink-0" style={{ borderColor: "var(--line)" }}>
      {options.map(([val, text]) => (
        <button key={val} onClick={() => onChange(val)}
                className="text-[11.5px] px-3 py-1.5 transition-colors"
                style={{
                  background: value === val ? "var(--raised)" : "transparent",
                  color: value === val ? "var(--text)" : "var(--dim)",
                }}>
          {text}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Placement cell. Green when the row beats the field average, plain otherwise
 * -- the same convention the comp and advisor views already use, so a number
 * reads the same way wherever it appears.
 */
export function Place({ value, baseline, size = 15 }) {
  if (value == null) return <span style={{ color: "var(--faint)" }}>—</span>;
  return (
    <span className="mono font-bold" style={{
      fontSize: size,
      color: value < baseline ? "var(--signal)" : "var(--text)",
    }}>
      {value.toFixed(2)}
    </span>
  );
}

// Below this the arrow is noise dressed as a signal, so it renders flat.
const CHANGE_DEADBAND = 0.05;

/**
 * Movement since the previous window.
 *
 * Placement is inverted -- lower is better -- so a NEGATIVE delta is an
 * improvement and gets the good colour. The arrow follows the quality, not the
 * arithmetic sign, because "down 0.3 placement" and "got better" are the same
 * event and showing a red down-arrow for it would be read backwards every time.
 */
export function PlaceChange({ change }) {
  if (!change || change.delta == null) {
    return <span className="text-[11px]" style={{ color: "var(--faint)" }}>—</span>;
  }
  const d = change.delta;
  const flat = Math.abs(d) < CHANGE_DEADBAND;
  const color = flat ? "var(--dim)" : d < 0 ? "var(--signal)" : "var(--danger)";
  return (
    <span className="mono text-[12.5px] whitespace-nowrap" style={{ color }}
          title={`${change.prev?.toFixed(2)} → ${change.curr?.toFixed(2)}  `
               + `(${num(change.n_prev)} then ${num(change.n_curr)} boards)`}>
      {flat ? "±0.00" : `${d > 0 ? "+" : ""}${d.toFixed(2)}`}
    </span>
  );
}

/**
 * Sample cell: the absolute board count with its share of the slice beneath.
 * Both matter and neither substitutes for the other -- a 25% play rate on a
 * 4,000-board slice is a very different claim from the same rate on 500,000.
 */
export function Frequency({ n, rate }) {
  if (n == null) return <span style={{ color: "var(--faint)" }}>—</span>;
  return (
    <span className="mono text-[12.5px] whitespace-nowrap">
      {num(n)}
      {rate != null && (
        <span className="text-[10.5px] ml-1.5" style={{ color: "var(--dim)" }}>{pct(rate)}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------

/**
 * Dense sortable tier table, shared by the Units, Items and Traits tabs.
 *
 * Every stats tab used to render its own bespoke card list, which meant the
 * same measurement (placement, sample, play rate) was laid out three different
 * ways and could only be sorted by whatever that tab happened to offer. One
 * table means one reading and one set of sort affordances.
 *
 * Column shape:
 *   key         unique id, also the sort key
 *   label       header text
 *   align       "left" (default) | "right" | "center"
 *   width       optional fixed width
 *   sortFn      (a, b) => number, ascending. Omit for an unsortable column.
 *   defaultDir  direction a fresh click on this header uses (default "asc")
 *   cell        (row) => node
 *
 * `pinLast` keeps rows that have no measurement at the bottom under every
 * sort, rather than letting them scatter through the ranking as zeroes.
 */
export function StatTable({
  columns, rows, rowKey, sort, onSortChange,
  expanded, onToggleRow, renderDetail, pinLast, emptyMessage = "Nothing matches this filter.",
}) {
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    const out = [...rows];
    if (!col?.sortFn) return out;
    const dir = sort.dir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      if (pinLast) {
        const pa = pinLast(a), pb = pinLast(b);
        if (pa !== pb) return pa ? 1 : -1;
      }
      return col.sortFn(a, b) * dir;
    });
    return out;
  }, [rows, columns, sort, pinLast]);

  const headerClick = (col) => {
    if (!col.sortFn) return;
    if (sort?.key === col.key) {
      onSortChange({ key: col.key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key: col.key, dir: col.defaultDir || "asc" });
    }
  };

  const alignClass = { right: "text-right", center: "text-center" };

  if (sorted.length === 0) {
    return (
      <p className="text-[12px] py-10 text-center" style={{ color: "var(--dim)" }}>{emptyMessage}</p>
    );
  }

  return (
    <div className="rounded-lg border overflow-x-auto scroll-thin"
         style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
      <table className="w-full border-collapse" style={{ minWidth: 720 }}>
        <thead>
          <tr className="border-b" style={{ borderColor: "var(--line)" }}>
            {columns.map((col) => {
              const active = sort?.key === col.key;
              const Arrow = !col.sortFn ? null : !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
              return (
                <th key={col.key} style={{ width: col.width }}
                    className={`px-3 py-2.5 font-medium ${alignClass[col.align] || "text-left"}`}>
                  <button
                    onClick={() => headerClick(col)}
                    disabled={!col.sortFn}
                    className={`display text-[11.5px] uppercase tracking-wider inline-flex items-center gap-1 ${
                      col.sortFn ? "cursor-pointer" : "cursor-default"}`}
                    style={{ color: active ? "var(--text)" : "var(--dim)" }}>
                    {col.label}
                    {Arrow && <Arrow size={11} style={{ color: active ? "var(--accent)" : "var(--faint)" }} />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>

        {sorted.map((row) => {
          const key = rowKey(row);
          const isOpen = expanded?.has(key);
          return (
            <tbody key={key}>
              <tr onClick={renderDetail ? () => onToggleRow(key) : undefined}
                  className={`border-b row-hover ${renderDetail ? "cursor-pointer" : ""}`}
                  style={{ borderColor: "var(--line)", background: isOpen ? "var(--raised)" : undefined }}>
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2 ${alignClass[col.align] || "text-left"}`}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
              {isOpen && renderDetail && (
                <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                  <td colSpan={columns.length} className="px-3 pt-1 pb-4"
                      style={{ background: "var(--bg)" }}>
                    {renderDetail(row)}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
