import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { PageHeader, SegmentedToggle, FilterChips, num, pct } from "./table.jsx";

// Categorical line colours. Hue alone never carries the reading -- every series
// is labelled in the legend and hovering isolates it -- so this only has to
// stay distinguishable at 2px on the dark surface, not encode a scale.
const LINE_COLORS = [
  "#46E0B0", "#FFC24B", "#4FA3F7", "#B571F0", "#FF7A85",
  "#38BDF8", "#F472B6", "#9FE870", "#FF9F45", "#8FE3D2",
];

const KINDS = [
  ["units", "Units"], ["items", "Items"], ["traits", "Traits"], ["comps", "Comps"],
];

/**
 * Metrics. `better` says which direction is good, which the chart uses to
 * orient the y axis -- placement is the odd one out (1st is best), and drawing
 * it on a normal upward axis makes a winning unit look like a falling line.
 */
const METRICS = {
  place: { label: "Avg Place", key: "place", better: "low", fmt: (v) => v.toFixed(2) },
  win:   { label: "Win Rate",  key: "win",   better: "high", fmt: (v) => pct(v) },
  top4:  { label: "Top 4",     key: "top4",  better: "high", fmt: (v) => pct(v) },
  rate:  { label: "Play Rate", key: "rate",  better: "high", fmt: (v) => pct(v) },
};

const PAD = { l: 52, r: 16, t: 14, b: 34 };
const H = 340;
const W = 900; // viewBox width; the SVG scales to its container

function shortDay(d) {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

/**
 * Multi-series line chart.
 *
 * Deliberately hand-rolled SVG rather than a charting dependency: the whole
 * bundle is 87 KB gzipped and a chart library would be a large fraction of
 * that again for one tab, on a page that has to stay self-contained.
 */
function LineChart({ series, metric, days, patchByDay, focus, onFocus }) {
  const m = METRICS[metric];

  const { scaleX, scaleY, lo, hi, ticks } = useMemo(() => {
    const values = series.flatMap((s) => s.points.map((p) => p[m.key]));
    if (values.length === 0) return { scaleX: () => 0, scaleY: () => 0, lo: 0, hi: 1, ticks: [] };
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = (hi - lo) * 0.12 || 0.1;
    lo -= pad; hi += pad;

    const dx = days.length > 1 ? (W - PAD.l - PAD.r) / (days.length - 1) : 0;
    const scaleX = (d) => PAD.l + days.indexOf(d) * dx;
    // Screen y always grows downward, so "better at the top" means inverting
    // for high-is-good metrics and NOT inverting for placement.
    const scaleY = (v) => {
      const frac = (v - lo) / (hi - lo || 1);
      return m.better === "low"
        ? PAD.t + frac * (H - PAD.t - PAD.b)
        : H - PAD.b - frac * (H - PAD.t - PAD.b);
    };
    const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    return { scaleX, scaleY, lo, hi, ticks };
  }, [series, days, m]);

  // Where the patch changed between two consecutive days -- drawn as a boundary
  // because a line that crosses one is comparing two different games.
  const patchBreaks = useMemo(() => {
    const out = [];
    for (let i = 1; i < days.length; i++) {
      const a = patchByDay[days[i - 1]], b = patchByDay[days[i]];
      if (a && b && a !== b) out.push({ x: (scaleX(days[i - 1]) + scaleX(days[i])) / 2, patch: b });
    }
    return out;
  }, [days, patchByDay, scaleX]);

  if (series.length === 0) {
    return (
      <p className="text-[12px] py-16 text-center" style={{ color: "var(--dim)" }}>
        Nothing to plot with these filters.
      </p>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
         role="img" aria-label={`${m.label} over ${days.length} days`}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={scaleY(t)} y2={scaleY(t)}
                stroke="var(--line)" strokeWidth="1" />
          <text x={PAD.l - 8} y={scaleY(t) + 3.5} textAnchor="end"
                fill="var(--dim)" fontSize="10.5" fontFamily="JetBrains Mono, monospace">
            {m.fmt(t)}
          </text>
        </g>
      ))}

      {days.map((d) => (
        <text key={d} x={scaleX(d)} y={H - PAD.b + 16} textAnchor="middle"
              fill="var(--dim)" fontSize="10.5" fontFamily="JetBrains Mono, monospace">
          {shortDay(d)}
        </text>
      ))}

      {patchBreaks.map((b, i) => (
        <g key={i}>
          <line x1={b.x} x2={b.x} y1={PAD.t} y2={H - PAD.b}
                stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
          <text x={b.x + 4} y={PAD.t + 10} fill="var(--accent)" fontSize="10"
                fontFamily="JetBrains Mono, monospace" opacity="0.9">
            patch {b.patch}
          </text>
        </g>
      ))}

      {series.map((s) => {
        const dim = focus && focus !== s.id;
        const pts = s.points.map((p) => `${scaleX(p.d)},${scaleY(p[m.key])}`).join(" ");
        return (
          <g key={s.id} opacity={dim ? 0.14 : 1}
             onMouseEnter={() => onFocus(s.id)} onMouseLeave={() => onFocus(null)}
             style={{ cursor: "pointer" }}>
            <polyline points={pts} fill="none" stroke={s.color}
                      strokeWidth={focus === s.id ? 2.6 : 1.6}
                      strokeLinejoin="round" strokeLinecap="round" />
            {/* Invisible fat stroke so thin lines are still hoverable */}
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth="12" />
            {focus === s.id && s.points.map((p) => (
              <circle key={p.d} cx={scaleX(p.d)} cy={scaleY(p[m.key])} r="3" fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Trends: how the meta moved, day by day.
 *
 * The series are bucketed by MATCH date rather than by publish time, so the
 * history is as deep as the match store and doesn't start from the day the
 * feature shipped. Days below the pipeline's sample floor are dropped rather
 * than drawn, which is why a line can start partway across.
 */
export default function Trends({ stats, apiBase, staticMode, sliceId, traitMeta = {} }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [kind, setKind] = useState("units");
  const [metric, setMetric] = useState("place");
  const [topN, setTopN] = useState(10);
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    if (!sliceId) return;
    let cancelled = false;
    setStatus("loading");
    const url = staticMode ? `${apiBase}/trends-${sliceId}.json` : `${apiBase}/trends/${sliceId}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) { setData(d); setStatus("ready"); } })
      .catch(() => { if (!cancelled) { setData(null); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [apiBase, staticMode, sliceId]);

  const nameOf = useMemo(() => ({
    units: (id) => stats.champion_names?.[id] || id,
    items: (id) => stats.item_names?.[id] || id,
    traits: (id) => traitMeta?.[id]?.name || id,
    comps: (id) => stats.comp_names?.[id] || id,
  }), [stats, traitMeta]);

  const series = useMemo(() => {
    if (!data?.series?.[kind]) return [];
    const m = METRICS[metric];
    const rows = Object.entries(data.series[kind])
      .filter(([, pts]) => pts.length >= 2)
      .map(([id, points]) => {
        const last = points[points.length - 1];
        return { id, points, last: last[m.key], sample: points.reduce((s, p) => s + p.n, 0) };
      });
    // Ranked by the metric on show, not by sample: a "top 10 by play rate"
    // list and a "top 10 by placement" list are different questions, and
    // ranking both by volume would answer neither.
    rows.sort((a, b) => (m.better === "low" ? a.last - b.last : b.last - a.last));
    return rows.slice(0, topN).map((r, i) => ({
      ...r, name: nameOf[kind](r.id), color: LINE_COLORS[i % LINE_COLORS.length],
    }));
  }, [data, kind, metric, topN, nameOf]);

  if (status === "loading") {
    return (
      <p className="flex items-center justify-center gap-2 text-[12.5px] py-16" style={{ color: "var(--dim)" }}>
        <RefreshCw size={13} className="animate-spin" /> Loading trend history…
      </p>
    );
  }

  if (status === "error" || !data?.days?.length) {
    return (
      <div>
        <PageHeader title="TFT Trends" blurb="How the meta moved, day by day." />
        <div className="flex items-start gap-2 text-[12px] rounded px-3 py-2.5 border"
             style={{ color: "var(--warn)", borderColor: "var(--warn)33", background: "var(--warn)0A" }}>
          <AlertTriangle size={13} className="mt-[2px] shrink-0" />
          <span>
            No trend history for this slice yet. Trends are bucketed by match date, so they
            appear once the store holds matches spanning more than one day — run
            <span className="mono"> ./run-crawl.sh </span> again and republish.
          </span>
        </div>
      </div>
    );
  }

  const m = METRICS[metric];
  const first = data.days[0], last = data.days[data.days.length - 1];

  return (
    <div>
      <PageHeader
        title="TFT Trends"
        blurb={`How each ${kind.replace(/s$/, "")} moved over the last ${data.days.length} days. Days are bucketed by when the match was played, not when it was crawled, and a day below the sample floor is left out rather than drawn.`}
        sampleSize={stats.sample_size} generatedAt={data.generated_at}>
        <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          {first} → {last} · {num(Object.values(data.day_samples).reduce((a, b) => a + b, 0))} boards across the window
        </p>
      </PageHeader>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <SegmentedToggle value={kind} onChange={(k) => { setKind(k); setFocus(null); }} options={KINDS} />
        <FilterChips label="metric" value={metric} onChange={setMetric}
                     options={Object.entries(METRICS).map(([k, v]) => [k, v.label])} />
        <FilterChips label="show" value={topN} onChange={setTopN}
                     options={[[10, "Top 10"], [25, "Top 25"], [999, "All"]]} />
      </div>

      <div className="rounded-lg border p-2" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <p className="text-[10px] uppercase tracking-wider px-2 pt-1" style={{ color: "var(--muted)" }}>
          {m.label} · better is {m.better === "low" ? "lower" : "higher"}, so up is better on this axis
        </p>
        <LineChart series={series} metric={metric} days={data.days}
                   patchByDay={data.day_patches || {}} focus={focus} onFocus={setFocus} />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {series.map((s) => (
          <button key={s.id}
                  onMouseEnter={() => setFocus(s.id)} onMouseLeave={() => setFocus(null)}
                  onClick={() => setFocus(focus === s.id ? null : s.id)}
                  className="flex items-center gap-2 rounded-lg border px-2 py-1 transition-colors"
                  style={{
                    borderColor: focus === s.id ? s.color : "var(--line)",
                    background: focus === s.id ? `color-mix(in srgb, ${s.color} 12%, transparent)` : "transparent",
                    opacity: focus && focus !== s.id ? 0.45 : 1,
                  }}>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            {kind === "units" && <ChampionIcon src={stats.champion_icons?.[s.id]} name={s.name} size={18} />}
            {kind === "items" && <ItemIcon src={stats.item_icons?.[s.id]} name={s.name} size={18} />}
            <span className="text-[11.5px]">{s.name}</span>
            <span className="mono text-[11px]" style={{ color: "var(--dim)" }}>{m.fmt(s.last)}</span>
          </button>
        ))}
      </div>

      <p className="text-[10.5px] mt-4 leading-relaxed max-w-3xl" style={{ color: "var(--muted)" }}>
        The most recent day keeps filling as later crawls pull matches that were already
        played, so its point firms up over the following runs rather than being final when
        first drawn. Patch boundaries are marked because a line crossing one is comparing
        two different games.
      </p>
    </div>
  );
}
