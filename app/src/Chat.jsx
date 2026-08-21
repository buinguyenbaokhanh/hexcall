import React, { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertTriangle, Database, Sparkles } from "lucide-react";

// Openers that demonstrate the range without the player having to guess what
// the data can answer. Each maps to a different tool, which is the point.
const STARTERS = [
  "What should I build on Jhin?",
  "What are the best comps right now?",
  "What got better since the last patch?",
  "Is Blue Buff worth building?",
  "Which augment is best?",
];

/** Which published data the answer was actually read from. */
const TOOL_LABEL = {
  list_slices: "data cuts",
  get_unit: "unit stats",
  get_item: "item stats",
  get_trait: "trait stats",
  tier_list: "tier list",
  biggest_movers: "patch changes",
  augment_data_availability: "augment coverage",
};

function Bubble({ turn }) {
  const mine = turn.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] rounded-lg px-3.5 py-2.5 border"
           style={{
             background: mine ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--surface)",
             borderColor: mine ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--line)",
           }}>
        <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{turn.content}</p>
        {/* The whole design is that an answer is traceable to published files.
            Saying which were read is what makes it checkable. */}
        {turn.tools?.length > 0 && (
          <p className="text-[10px] mt-1.5 flex items-center gap-1 flex-wrap"
             style={{ color: "var(--muted)" }}>
            <Database size={9} />
            read {[...new Set(turn.tools)].map((t) => TOOL_LABEL[t] || t).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Ask the published data a question.
 *
 * The model has no statistics in its context -- it calls tools that read the
 * same files every other tab reads, so it can only state numbers it retrieved.
 * That is the only version of this feature worth shipping on a site whose
 * whole claim is that its numbers are honest about their sample.
 */
export default function Chat({ apiBase, staticMode, sliceId, patchLabel }) {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const ask = async (question) => {
    const q = (question ?? draft).trim();
    if (!q || busy) return;
    setDraft(""); setError(null); setBusy(true);
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    try {
      const r = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, slice: sliceId || "global-all" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setTurns((t) => [...t, { role: "assistant", content: j.answer, tools: j.tools_used }]);
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(false); }
  };

  // Same constraint as Review: this calls a model at request time, so it needs
  // a server holding a key. A static deploy has nowhere to put one.
  if (staticMode) {
    return (
      <div className="max-w-[760px]">
        <div className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
          <h2 className="display text-[13px] mb-1">Ask about the data</h2>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--dim)" }}>
            This needs the stats server running, because it calls a model at request time —
            the rest of the app reads pre-published files and works without one. Run{" "}
            <code className="mono">./run-dev.sh</code> locally to use it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[820px]">
      <div className="mb-4">
        <h2 className="display text-[19px] font-semibold">Ask about the data</h2>
        <p className="text-[12px] mt-1 leading-relaxed max-w-[620px]" style={{ color: "var(--dim)" }}>
          Answers come from the same published files the other tabs read — patch{" "}
          {patchLabel || "—"}, {sliceId || "global-all"}. Every number is retrieved rather than
          recalled, and each answer says which data it consulted.
        </p>
      </div>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {STARTERS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}
                    className="text-[11.5px] px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50"
                    style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5 mb-3">
        {turns.map((t, i) => <Bubble key={i} turn={t} />)}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] px-1" style={{ color: "var(--dim)" }}>
            <Loader2 size={13} className="animate-spin" /> reading the published data…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[11.5px] rounded px-3 py-2.5 border mb-3"
             style={{ color: "var(--danger)", borderColor: "var(--danger)33",
                      background: "color-mix(in srgb, var(--danger) 8%, transparent)" }}>
          <AlertTriangle size={13} className="mt-[2px] shrink-0" />
          <span>
            {error}
            {/ANTHROPIC_API_KEY|credential/i.test(error) && (
              <span className="block mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
                Set it before starting the server:
                <code className="mono text-[10.5px] block rounded p-2 mt-1"
                      style={{ background: "var(--bg)", color: "var(--signal)" }}>
                  export ANTHROPIC_API_KEY=sk-ant-…
                </code>
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && ask()}
               placeholder="Ask about a unit, item, trait or comp…"
               maxLength={500}
               className="flex-1 rounded px-3 py-2 text-[12.5px] border outline-none focus:border-[var(--accent)] transition-colors"
               style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }} />
        <button onClick={() => ask()} disabled={busy || !draft.trim()}
                className="display text-[12.5px] px-4 py-2 rounded flex items-center gap-1.5 disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--bg)" }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Ask
        </button>
      </div>

      <p className="text-[10.5px] mt-4 leading-relaxed max-w-[680px]" style={{ color: "var(--muted)" }}>
        <Sparkles size={9} className="inline mr-1" />
        Built for planning between games and reviewing finished ones. It reads only what the
        pipeline published, so it will tell you when something isn't measurable — augments have
        no statistics in Riot's match API, and nothing here knows what happened during a game.
      </p>
    </div>
  );
}
