import React, { useState } from "react";
import {
  Search, AlertTriangle, AlertCircle, CheckCircle2, Loader2, Target, Sparkles,
} from "lucide-react";
import { ChampionIcon, ItemIcon } from "./icons.jsx";
import { TraitBadge } from "./TraitBadge.jsx";
import { SegmentedToggle, COST_COLORS, num } from "./table.jsx";

const PLATFORMS = [
  ["na1","NA"],["euw1","EUW"],["eun1","EUNE"],["kr","KR"],["jp1","JP"],["br1","BR"],
  ["sg2","SEA"],["vn2","VN"],["th2","TH"],["ph2","PH"],["tw2","TW"],["oc1","OCE"],
  ["la1","LAN"],["la2","LAS"],["tr1","TR"],["ru","RU"],
];

const SEV = {
  high:   { Icon: AlertTriangle, color: "var(--danger)" },
  medium: { Icon: AlertCircle,   color: "var(--warn)" },
  ok:     { Icon: CheckCircle2,  color: "var(--signal)" },
};

const TONE = { good: "var(--signal)", bad: "var(--danger)", accent: "var(--accent)", neutral: "var(--dim)" };

const P_MIN = 1, P_MAX = 8;
const axisPct = (p) => ((p - P_MIN) / (P_MAX - P_MIN)) * 100;

const STAR_COLOR = { 1: "#9FB0C4", 2: "#C9A227", 3: "#F0B429", 4: "#8FE3D2" };

function timeAgo(ms) {
  if (!ms) return "";
  const h = Math.floor((Date.now() - ms) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

/** One unit on a finished board: star level, cost-tinted portrait, its items. */
function BoardUnit({ unit }) {
  const color = COST_COLORS[unit.cost] || "var(--line)";
  return (
    <span className="flex flex-col items-center gap-[3px] shrink-0" title={unit.name}>
      <span className="mono text-[9px] leading-none" style={{ color: STAR_COLOR[unit.star] || "var(--muted)" }}>
        {"★".repeat(Math.min(unit.star || 1, 4))}
      </span>
      <span className="rounded-md p-[1.5px]" style={{ border: `1.5px solid ${color}` }}>
        <ChampionIcon src={unit.icon} name={unit.name} size={30} className="!rounded-md" />
      </span>
      <span className="flex gap-[2px] h-[14px]">
        {unit.item_icons?.map((src, i) => (
          <ItemIcon key={i} src={src} name={unit.items?.[i]} size={13} />
        ))}
      </span>
    </span>
  );
}

/** Where you sit on one measured axis of playstyle. */
function AxisBar({ axis }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] w-[86px] text-right shrink-0" style={{ color: "var(--dim)" }}>
        {axis.left}
      </span>
      <span className="relative flex-1 h-[3px] rounded" style={{ background: "var(--faint)" }}>
        <span className="absolute w-[11px] h-[11px] rounded-full -top-1 -translate-x-1/2"
              style={{ left: `${axis.value * 100}%`, background: "var(--accent)" }} />
      </span>
      <span className="text-[11px] w-[86px] shrink-0" style={{ color: "var(--dim)" }}>{axis.right}</span>
    </div>
  );
}

function LeakCard({ leak }) {
  const cfg = SEV[leak.severity] || SEV.ok;
  const { Icon } = cfg;
  return (
    <div className="rounded-lg border px-4 py-3.5"
         style={{ background: "var(--surface)", borderColor: "var(--line)",
                  borderLeftWidth: 2, borderLeftColor: cfg.color }}>
      <div className="flex items-start gap-3">
        <Icon size={15} style={{ color: cfg.color }} className="mt-[2px] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="display text-[13px]">{leak.title}</span>
            <span className="mono text-[11.5px] shrink-0" style={{ color: cfg.color }}>{leak.metric}</span>
          </div>
          <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--dim)" }}>{leak.detail}</p>

          {/* Itemisation is the one leak that names its own fix, so it gets a
              side-by-side rather than a sentence. */}
          {leak.builds?.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {leak.builds.map((b, i) => (
                <div key={i} className="flex items-center gap-2.5 flex-wrap rounded border px-2.5 py-1.5"
                     style={{ borderColor: "var(--line)" }}>
                  <span className="text-[11.5px] w-24 shrink-0 truncate">{b.carry}</span>
                  <span className="flex items-center gap-1">
                    {b.yours_icons?.map((src, j) => (
                      <ItemIcon key={j} src={src} name={b.yours[j]} size={20} />
                    ))}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>→</span>
                  <span className="flex items-center gap-1">
                    {(b.best_icons?.length ? b.best_icons : b.best).map((src, j) => (
                      <ItemIcon key={j} src={b.best_icons?.length ? src : null} name={b.best[j]} size={20} />
                    ))}
                  </span>
                  <span className="mono text-[11px] ml-auto shrink-0"
                        style={{ color: b.gap == null ? "var(--muted)" : "var(--danger)" }}>
                    {b.gap == null ? "no measured sample" : `+${b.gap}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {leak.table && (
            <div className="mt-2.5 space-y-1">
              {leak.table.map((r) => (
                <div key={r.comp} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="truncate">{r.comp}
                    <span className="mono ml-1.5" style={{ color: "var(--muted)" }}>{r.games}g</span>
                  </span>
                  <span className="mono shrink-0" style={{ color: "var(--dim)" }}>
                    {r.your_avg} vs {r.field_avg}
                    <span className="ml-2" style={{ color: r.gap > 0 ? "var(--danger)" : "var(--signal)" }}>
                      {r.gap > 0 ? "+" : ""}{r.gap}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {leak.examples?.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {leak.examples.map((ex, i) => (
                <span key={i} className="mono text-[10px] rounded px-2 py-1 border"
                      style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
                  {ex.comp ? `${ex.comp} · ${ex.augment} ${ex.lift > 0 ? "+" : ""}${ex.lift}`
                           : `${ex.gold}g left · placed ${ex.placement}`}
                </span>
              ))}
            </div>
          )}

          {leak.caveat && (
            <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--muted)" }}>{leak.caveat}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Personal review.
 *
 * The tier-list tabs answer "what is strong". This answers "what are YOU doing
 * wrong", which is the only question on the site whose answer differs per
 * person -- and the reason to build this rather than read someone else's.
 *
 * Everything here is derived from end-of-game state plus lobby comparison.
 * match-v1 has no round timeline, so nothing on this page claims to know what
 * happened during a game; it reports the state you ended in and how that
 * compares with the players who ended alongside you.
 */
export default function Review({ apiBase, sliceId, staticMode, traitMeta = {} }) {
  const [riotId, setRiotId] = useState("");
  const [platform, setPlatform] = useState("na1");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState("fixes");
  const [queue, setQueue] = useState("1100");

  const run = async () => {
    if (!riotId.includes("#")) { setError("Enter your Riot ID as GameName#TAG"); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(
        `${apiBase}/review?riot_id=${encodeURIComponent(riotId)}&platform=${platform}`
        + `&slice=${sliceId || "global-all"}`
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      setQueue(j.views?.["1100"] ? "1100" : Object.keys(j.views || {})[0] || "all");
    } catch (e) {
      setError(String(e.message || e)); setData(null);
    } finally { setLoading(false); }
  };

  // Every queue's analysis arrives in one response, so switching tabs is a
  // local lookup rather than another Riot round-trip -- which under a
  // development key's rate limit took about a minute per tab.
  const qview = data?.views?.[queue] || null;
  const s = qview?.summary;

  const noKey = error && error.toLowerCase().includes("api key");

  // Unlike every other tab, this one can't run off published files: it queries
  // Riot for YOUR match history at request time, which needs a server holding
  // the API key. On a static deploy there's nothing to call, so say so rather
  // than letting the fetch fail with a confusing parse error.
  if (staticMode) {
    return (
      <div className="max-w-[760px]">
        <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
          <h2 className="display text-[13px] mb-1">Review your recent games</h2>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--dim)" }}>
            This feature needs the stats server running, because it looks up your match history
            from Riot at request time — the rest of the app reads pre-published files and works
            without one. Run <code className="mono">./run-dev.sh</code> locally to use it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px]">
      <div className="rounded-lg border p-4 mb-5"
           style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
        <h2 className="display text-[13px] mb-1">Review your recent games</h2>
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--dim)" }}>
          Compares your last 20 ranked games against the aggregate to find the mistakes you
          repeat. A tier list tells you what's strong; this tells you what you're doing wrong.
        </p>
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-[10px]" style={{ color: "var(--dim)" }} />
            <input value={riotId} onChange={(e) => setRiotId(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && run()}
                   placeholder="YourName#TAG"
                   className="w-full rounded pl-7 pr-2 py-2 text-[12.5px] border outline-none focus:border-[var(--accent)] transition-colors"
                   style={{ background: "var(--bg)", borderColor: "var(--line)", color: "var(--text)" }} />
          </div>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
                  className="rounded px-2 py-2 text-[12.5px] border outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--line)", color: "var(--text)" }}>
            {PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={() => run()} disabled={loading}
                  className="display text-[12.5px] px-4 py-2 rounded flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {loading && <Loader2 size={12} className="animate-spin" />}
            {loading ? "Reading" : "Review"}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded border px-3 py-2.5 text-[11.5px] leading-relaxed"
               style={{ borderColor: "var(--danger)33", background: "color-mix(in srgb, var(--danger) 8%, transparent)", color: "var(--danger)" }}>
            {error}
            {noKey && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
                <p className="mb-1.5">The server needs a Riot API key. Stop it (Ctrl+C), then restart with:</p>
                <code className="mono text-[10.5px] block rounded p-2" style={{ background: "var(--bg)", color: "var(--signal)" }}>
                  export RIOT_API_KEY=RGAPI-...<br />../.venv/bin/python server.py
                </code>
                <p className="mt-1.5">Development keys expire every 24 hours.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Queue tabs. Rendered from the breakdown the server returns, so
          limited-time modes appear on their own without a client-side list to
          keep up to date. */}
      {data?.queues?.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-4 border-b pb-2"
             style={{ borderColor: "var(--line)" }}>
          {[{ id: "all", label: "All queues", games: data.examined },
            ...data.queues.map((q) => ({ ...q, id: String(q.id) }))].map((q) => (
            <button key={q.id} onClick={() => setQueue(q.id)}
                    className="display text-[12.5px] px-3 py-1.5 rounded-t border-b-2 whitespace-nowrap transition-colors disabled:opacity-50"
                    style={{
                      borderColor: queue === q.id ? "var(--accent)" : "transparent",
                      color: queue === q.id ? "var(--text)" : "var(--dim)",
                    }}>
              {q.label}
              <span className="mono text-[10.5px] ml-1.5" style={{ color: "var(--muted)" }}>
                {q.games}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* A queue with no games is a normal outcome once tabs exist, not an
          error worth the red treatment. */}
      {data?.error && !data?.views && (
        <p className="text-[12px] rounded-lg border px-4 py-3 mb-4"
           style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
          {data.error}
        </p>
      )}

      {s && (
        <>
          {/* What the selected queue can and can't be measured against. The
              published stats are built from ranked only, so "vs. the field" is
              a ranked claim -- saying so beats quietly showing fewer cards. */}
          {!qview.field_comparable && (
            <div className="flex items-start gap-2 text-[11.5px] rounded px-3 py-2 border mb-4"
                 style={{ color: "var(--dim)", borderColor: "var(--line)" }}>
              <AlertCircle size={13} className="mt-[2px] shrink-0" />
              <span>
                {qview.queue_label} isn't compared against the tier list — the published stats
                are built from ranked games only.{" "}
                {qview.lobby_comparable
                  ? "Checks that compare you against your own lobby still apply."
                  : "Only checks that read your own boards apply here."}
              </span>
            </div>
          )}

          {s.low_sample && (
            <div className="flex items-start gap-2 text-[11.5px] rounded px-3 py-2 border mb-4"
                 style={{ color: "var(--warn)", borderColor: "var(--warn)33", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
              <AlertTriangle size={13} className="mt-[2px] shrink-0" />
              <span>Only {s.games} game{s.games === 1 ? "" : "s"} found. Patterns below are suggestive, not conclusive.</span>
            </div>
          )}

          <div className="rounded-lg border p-4 mb-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
              <span className="display text-[13px]">Your average placement</span>
              <span className="flex items-baseline gap-2">
                <span className="mono text-[26px]"
                      style={{ color: !qview.field_comparable ? "var(--text)"
                                    : s.avg_placement < s.field_avg ? "var(--signal)" : "var(--danger)" }}>
                  {s.avg_placement.toFixed(2)}
                </span>
                {qview.field_comparable && (
                  <span className="mono text-[11px]" style={{ color: "var(--dim)" }}>
                    field {s.field_avg.toFixed(2)}
                  </span>
                )}
              </span>
            </div>

            <div className="relative h-4 mb-1">
              {[1,2,3,4,5,6,7,8].map((t) => (
                <span key={t} className="absolute mono text-[9.5px] -translate-x-1/2"
                      style={{ left: `${axisPct(t)}%`, color: "var(--muted)" }}>{t}</span>
              ))}
            </div>
            <div className="relative h-6">
              <div className="absolute left-0 right-0 top-[11px] h-px" style={{ background: "var(--line)" }} />
              {qview.field_comparable && (
                <div className="absolute top-[4px] h-[15px] w-px"
                     style={{ left: `${axisPct(s.field_avg)}%`, background: "var(--dim)" }} />
              )}
              <div className="absolute top-[4px] transition-all duration-500"
                   style={{ left: `${axisPct(s.avg_placement)}%`, transform: "translateX(-50%)" }}>
                <div className="w-[15px] h-[15px] rotate-45 rounded-[3px]"
                     style={{ background: !qview.field_comparable ? "var(--dim)"
                                       : s.avg_placement < s.field_avg ? "var(--signal)" : "var(--danger)" }} />
              </div>
            </div>

            {/* The bar's percentage height needs a parent with a definite
                height to resolve against. The column is auto-height (its own
                content), so the bar gets its own flex-1 track -- without it
                every bar collapses to its 3px minimum. */}
            <div className="flex gap-1 h-20 mt-4">
              {Object.entries(s.placement_counts).map(([place, n]) => {
                const max = Math.max(...Object.values(s.placement_counts), 1);
                return (
                  <div key={place} className="flex-1 flex flex-col items-center gap-1">
                    <span className="mono text-[9.5px]" style={{ color: "var(--dim)" }}>{n || ""}</span>
                    <div className="w-full flex-1 flex items-end">
                      <div className="w-full rounded-t-[2px] transition-all"
                           style={{ height: `${(n / max) * 100}%`, minHeight: n ? 3 : 0,
                                    background: Number(place) <= 4 ? "var(--signal)" : "var(--faint)" }} />
                    </div>
                    <span className="mono text-[9.5px]" style={{ color: "var(--dim)" }}>{place}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-5 mt-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
              {[["top 4", `${(s.top4_rate*100).toFixed(0)}%`, "50% is even"],
                ["firsts", `${(s.win_rate*100).toFixed(0)}%`, "12.5% is even"],
                ["games", s.games, data.patch ? `patch ${data.patch}` : ""]].map(([l,v,sub]) => (
                <div key={l}>
                  <p className="text-[9.5px] uppercase tracking-wider" style={{ color: "var(--dim)" }}>{l}</p>
                  <p className="mono text-[15px]">{v}</p>
                  <p className="text-[9.5px]" style={{ color: "var(--muted)" }}>{sub}</p>
                </div>
              ))}
            </div>

            {qview.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
                {qview.tags.map((t) => (
                  <span key={t.id} title={`${t.detail} · ${t.criteria}`}
                        className="text-[11.5px] rounded-full border px-2.5 py-1"
                        style={{ color: TONE[t.tone] || "var(--dim)",
                                 borderColor: `color-mix(in srgb, ${TONE[t.tone] || "var(--dim)"} 45%, transparent)` }}>
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mb-3">
            <SegmentedToggle value={view} onChange={setView}
                             options={[["fixes", "Fix list"], ["tags", "Playstyle"],
                                       ["games", `Recent games (${data.recent.length})`]]} />
          </div>

          {view === "fixes" && (
            <>
              {qview.plan?.length > 0 ? (
                <div className="rounded-lg border p-4 mb-4"
                     style={{ background: "var(--surface)", borderColor: "var(--accent)33" }}>
                  <p className="display text-[13px] mb-0.5 flex items-center gap-1.5">
                    <Target size={14} style={{ color: "var(--accent)" }} />
                    Change these, in this order
                  </p>
                  <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
                    Ordered by what's costing you most. Three at a time — a list of eleven
                    things to fix is a list of nothing to fix.
                  </p>
                  <ol className="space-y-2.5">
                    {qview.plan.map((p, i) => (
                      <li key={p.leak} className="flex gap-3">
                        <span className="mono text-[13px] shrink-0" style={{ color: "var(--accent)" }}>{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-[12.5px] leading-relaxed">{p.do}</p>
                          <p className="text-[10.5px] mt-1 flex items-center gap-1.5 flex-wrap"
                             style={{ color: "var(--muted)" }}>
                            <span>{p.title} · {p.metric}</span>
                            {p.tailored && (
                              <span className="flex items-center gap-1" style={{ color: "var(--accent)" }}>
                                <Sparkles size={9} /> tailored to your playstyle
                              </span>
                            )}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="text-[12px] rounded-lg border px-4 py-3 mb-4"
                   style={{ borderColor: "var(--signal)33", color: "var(--signal)" }}>
                  Nothing measured here is costing you placements. At that point the gains are in
                  positioning and combat reads, which end-of-game data can't see.
                </p>
              )}

              <h3 className="display text-[13px] mb-2.5">Everything measured</h3>
              <div className="space-y-2">
                {qview.leaks.map((leak) => <LeakCard key={leak.id} leak={leak} />)}
              </div>
            </>
          )}

          {view === "tags" && (
            <div className="space-y-2">
              {qview.axes?.length > 0 && (
                <div className="rounded-lg border p-4 space-y-3"
                     style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                  {qview.axes.map((a) => <AxisBar key={a.id} axis={a} />)}
                  <p className="text-[10px] leading-snug pt-1" style={{ color: "var(--muted)" }}>
                    Two axes rather than the four an in-game overlay shows: damage type and board
                    role need per-unit combat data that match-v1 doesn't return, and deriving them
                    from unit names would be a guess dressed as a measurement.
                  </p>
                </div>
              )}
              {qview.tags?.map((t) => (
                <div key={t.id} className="rounded-lg border px-4 py-3 flex items-start gap-3 flex-wrap"
                     style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                  <span className="text-[12px] rounded-full border px-2.5 py-1 shrink-0"
                        style={{ color: TONE[t.tone] || "var(--dim)",
                                 borderColor: `color-mix(in srgb, ${TONE[t.tone] || "var(--dim)"} 45%, transparent)` }}>
                    {t.label}
                  </span>
                  <span className="text-[12.5px] flex-1 min-w-[200px]">{t.detail}</span>
                  <span className="text-[10.5px] italic shrink-0" style={{ color: "var(--muted)" }}>
                    {t.criteria}
                  </span>
                </div>
              ))}
            </div>
          )}

          {view === "games" && (
            <div className="space-y-1.5">
              {data.recent.map((g, i) => (
                <div key={i} className="rounded-lg border px-3 py-2.5 flex items-start gap-3 flex-wrap"
                     style={{ background: "var(--surface)", borderColor: "var(--line)",
                              borderLeftWidth: 2,
                              borderLeftColor: g.placement === 1 ? "var(--accent)"
                                             : g.placement <= 4 ? "var(--signal)" : "var(--line)" }}>
                  <div className="w-[104px] shrink-0">
                    <p className="mono text-[19px] leading-none"
                       style={{ color: g.placement <= 4 ? "var(--signal)" : "var(--dim)" }}>
                      {g.placement}
                      <span className="text-[10px] ml-1" style={{ color: "var(--muted)" }}>
                        {["st","nd","rd"][g.placement - 1] || "th"}
                      </span>
                    </p>
                    <p className="text-[11px] mt-1 truncate" title={g.comp}>{g.comp}</p>
                    <p className="mono text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                      {timeAgo(g.played_at)}
                    </p>
                    {g.queue && (
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--dim)" }}>
                        {g.queue}
                      </p>
                    )}
                  </div>

                  <div className="w-[92px] shrink-0 mono text-[10.5px] leading-relaxed"
                       style={{ color: "var(--dim)" }}>
                    <div>lv {g.level}</div>
                    <div>{g.gold}g left</div>
                    <div title="Gold-equivalent value of the board you finished with">
                      {num(g.board_value)} board
                    </div>
                  </div>

                  <div className="flex-1 min-w-[260px]">
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {g.traits?.map((t) => (
                        <TraitBadge key={t.name} name={t.name} units={t.units}
                                    meta={traitMeta[t.name]} showName={false} size={17} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.units?.map((u, j) => <BoardUnit key={j} unit={u} />)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] mt-5 leading-relaxed" style={{ color: "var(--muted)" }}>
            Post-game analysis of your own match history, compared against {data.compared_against}.
            Riot's TFT policy encourages this; it does not permit looking up opponents during a
            game, which this deliberately can't do.
          </p>
        </>
      )}

      {!s && !loading && !error && (
        <div className="rounded-lg border border-dashed py-14 text-center" style={{ borderColor: "var(--line)" }}>
          <p className="text-[12px]" style={{ color: "var(--dim)" }}>
            Enter your Riot ID to see what's costing you placements.
          </p>
        </div>
      )}
    </div>
  );
}
