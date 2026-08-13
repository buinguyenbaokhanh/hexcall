import React, { useState } from "react";
import { Search, AlertTriangle, AlertCircle, CheckCircle2, Loader2, ChevronDown } from "lucide-react";

const PLATFORMS = [
  ["na1","NA"],["euw1","EUW"],["eun1","EUNE"],["kr","KR"],["jp1","JP"],["br1","BR"],
  ["sg2","SEA"],["vn2","VN"],["th2","TH"],["ph2","PH"],["tw2","TW"],["oc1","OCE"],
  ["la1","LAN"],["la2","LAS"],["tr1","TR"],["ru","RU"],
];

const SEV = {
  high:   { Icon: AlertTriangle, color: "var(--danger)", rank: "Fix first" },
  medium: { Icon: AlertCircle,   color: "var(--warn)",   rank: "Watch" },
  ok:     { Icon: CheckCircle2,  color: "var(--signal)", rank: "Fine" },
};

const P_MIN = 1, P_MAX = 8;
const pct = (p) => ((p - P_MIN) / (P_MAX - P_MIN)) * 100;

export default function Review({ apiBase, sliceId, staticMode }) {
  const [riotId, setRiotId] = useState("");
  const [platform, setPlatform] = useState("na1");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showGames, setShowGames] = useState(false);

  const run = async () => {
    if (!riotId.includes("#")) { setError("Enter your Riot ID as GameName#TAG"); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(
        `${apiBase}/review?riot_id=${encodeURIComponent(riotId)}&platform=${platform}&slice=${sliceId || "global-apex"}`
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(String(e.message || e)); setData(null);
    } finally { setLoading(false); }
  };

  const s = data?.summary;
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
    <div className="max-w-[760px]">
      {/* Search */}
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
          <button onClick={run} disabled={loading}
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
                  $env:RIOT_API_KEY = "RGAPI-..."<br />..\.venv\Scripts\python.exe server.py
                </code>
                <p className="mt-1.5">Development keys expire every 24 hours.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {s && (
        <>
          {s.low_sample && (
            <div className="flex items-start gap-2 text-[11.5px] rounded px-3 py-2 border mb-4"
                 style={{ color: "var(--warn)", borderColor: "var(--warn)33", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
              <AlertTriangle size={13} className="mt-[2px] shrink-0" />
              <span>Only {s.games} games found. Patterns below are suggestive, not conclusive.</span>
            </div>
          )}

          {/* Headline: your placement vs field, on the same axis as everything else */}
          <div className="rounded-lg border p-4 mb-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
              <span className="display text-[13px]">Your average placement</span>
              <span className="flex items-baseline gap-2">
                <span className="mono text-[26px]"
                      style={{ color: s.avg_placement < s.field_avg ? "var(--signal)" : "var(--danger)" }}>
                  {s.avg_placement.toFixed(2)}
                </span>
                <span className="mono text-[11px]" style={{ color: "var(--dim)" }}>
                  field {s.field_avg.toFixed(2)}
                </span>
              </span>
            </div>

            <div className="relative h-4 mb-1">
              {[1,2,3,4,5,6,7,8].map((t) => (
                <span key={t} className="absolute mono text-[9.5px] -translate-x-1/2"
                      style={{ left: `${pct(t)}%`, color: "var(--faint)" }}>{t}</span>
              ))}
            </div>
            <div className="relative h-6">
              <div className="absolute left-0 right-0 top-[11px] h-px" style={{ background: "var(--line)" }} />
              <div className="absolute top-[4px] h-[15px] w-px" style={{ left: `${pct(s.field_avg)}%`, background: "var(--dim)" }} />
              <div className="absolute top-[4px] transition-all duration-500"
                   style={{ left: `${pct(s.avg_placement)}%`, transform: "translateX(-50%)" }}>
                <div className="w-[15px] h-[15px] rotate-45 rounded-[3px]"
                     style={{ background: s.avg_placement < s.field_avg ? "var(--signal)" : "var(--danger)" }} />
              </div>
            </div>

            {/* Placement histogram */}
            <div className="flex items-end gap-1 h-16 mt-4">
              {Object.entries(s.placement_counts).map(([place, n]) => {
                const max = Math.max(...Object.values(s.placement_counts), 1);
                return (
                  <div key={place} className="flex-1 flex flex-col items-center gap-1">
                    <span className="mono text-[9.5px]" style={{ color: "var(--dim)" }}>{n || ""}</span>
                    <div className="w-full rounded-t-[2px] transition-all"
                         style={{ height: `${(n / max) * 100}%`, minHeight: n ? 3 : 0,
                                  background: Number(place) <= 4 ? "var(--signal)" : "var(--faint)" }} />
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
                  <p className="text-[9.5px]" style={{ color: "var(--faint)" }}>{sub}</p>
                </div>
              ))}
            </div>
          </div>

          <h3 className="display text-[13px] mb-2.5">What's costing you placements</h3>
          <div className="space-y-2">
            {data.leaks.map((leak) => {
              const cfg = SEV[leak.severity] || SEV.ok;
              const { Icon } = cfg;
              return (
                <div key={leak.id} className="rounded-lg border px-4 py-3.5"
                     style={{ background: "var(--surface)", borderColor: "var(--line)",
                              borderLeftWidth: 2, borderLeftColor: cfg.color }}>
                  <div className="flex items-start gap-3">
                    <Icon size={15} style={{ color: cfg.color }} className="mt-[2px] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <span className="display text-[13px]">{leak.title}</span>
                        <span className="mono text-[11.5px] shrink-0" style={{ color: cfg.color }}>
                          {leak.metric}
                        </span>
                      </div>
                      <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--dim)" }}>
                        {leak.detail}
                      </p>

                      {leak.table && (
                        <div className="mt-2.5 space-y-1">
                          {leak.table.map((r) => (
                            <div key={r.comp} className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="truncate">{r.comp}
                                <span className="mono ml-1.5" style={{ color: "var(--faint)" }}>{r.games}g</span>
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
                        <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--faint)" }}>
                          {leak.caveat}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={() => setShowGames((v) => !v)}
                  className="flex items-center gap-1.5 text-[11.5px] mt-4 mb-2" style={{ color: "var(--dim)" }}>
            <ChevronDown size={13} className={showGames ? "rotate-180 transition-transform" : "transition-transform"} />
            {data.recent.length} games behind this
          </button>
          {showGames && (
            <div className="space-y-[3px]">
              {data.recent.map((g, i) => (
                <div key={i} className="flex items-center gap-3 text-[11px] rounded border px-3 py-2"
                     style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                  <span className="mono text-[14px] w-5 shrink-0"
                        style={{ color: g.placement <= 4 ? "var(--signal)" : "var(--dim)" }}>
                    {g.placement}
                  </span>
                  <span className="w-36 shrink-0 truncate">{g.comp}</span>
                  <span className="mono shrink-0" style={{ color: "var(--dim)" }}>
                    lv{g.level} · r{g.round} · {g.gold}g
                  </span>
                  <span className="truncate" style={{ color: "var(--faint)" }}>{g.augments.join(" · ")}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] mt-5 leading-relaxed" style={{ color: "var(--faint)" }}>
            Post-game analysis of your own match history. Riot's TFT policy encourages this; it
            does not permit looking up opponents during a game, which this deliberately can't do.
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
