import React, { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertTriangle, Database, X, MessageCircle, ArrowUpRight } from "lucide-react";
import { useFocus } from "./focus.jsx";

const STARTERS = [
  "What are the best comps right now?",
  "What got better since the last patch?",
  "Which augment is best?",
];

/** Which published data an answer was read from. */
const TOOL_LABEL = {
  list_slices: "data cuts",
  get_unit: "unit stats",
  get_item: "item stats",
  get_trait: "trait stats",
  tier_list: "tier list",
  biggest_movers: "patch changes",
  augment_data_availability: "augment coverage",
};

const OPEN_KEY = "hexcall.ask.open";

/**
 * Where an answer came from, as somewhere you can go.
 *
 * Built from what the tools actually resolved, never from the model's prose --
 * so a link cannot point at a unit that was never looked up, or at a tab
 * holding nothing about it. Clicking switches tab and filters to that row,
 * because landing on a 65-row table with no idea which line was meant is
 * barely better than not linking at all.
 */
function References({ refs, onOpen }) {
  if (!refs?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {refs.map((r, i) => (
        <button key={i} onClick={() => onOpen(r)}
                className="flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-full border transition-colors row-hover"
                style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
          {r.name}
          <ArrowUpRight size={10} />
        </button>
      ))}
    </div>
  );
}

function Bubble({ turn, onOpen }) {
  const mine = turn.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[92%] rounded-lg px-3 py-2 border"
           style={{
             background: mine ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--bg)",
             borderColor: mine ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--line)",
           }}>
        <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{turn.content}</p>
        {!mine && <References refs={turn.refs} onOpen={onOpen} />}
        {turn.tools?.length > 0 && (
          <p className="text-[9.5px] mt-1.5 flex items-center gap-1 flex-wrap"
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
 * The assistant, as a panel available from every tab.
 *
 * A tab could not see what the player was reading; this can, which is the only
 * reason it earns permanent screen space. It deliberately avoids everything
 * that makes a support widget unwelcome: it never opens itself, never shows a
 * badge or a greeting, never animates for attention, and remembers being
 * dismissed. Closed, it is an icon.
 */
export default function ChatDock({ apiBase, staticMode, sliceId, patchLabel, tabLabel }) {
  const { focus, requestNav } = useFocus();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
  });
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* private mode */ }
  }, [open]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); },
            [turns, busy, open]);

  // "/" opens it the way a search field does, Escape closes. Ignored while the
  // player is typing anywhere else, so it never steals a keystroke.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.key === "/" && !typing && !open) { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);

  // A static deploy has nowhere to hold a key, so a permanently broken button
  // would be clutter rather than a feature. The Review tab already explains the
  // server requirement for anyone who goes looking.
  if (staticMode) return null;

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
        body: JSON.stringify({
          question: q, history, slice: sliceId || "global-all",
          // What the player is looking at, so "his items" resolves.
          viewing: { tab: tabLabel, focus: focus ? `${focus.kind}: ${focus.name}` : null },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setTurns((t) => [...t, { role: "assistant", content: j.answer,
                               tools: j.tools_used, refs: j.references }]);
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-label="Ask about the data"
              title="Ask about the data  ( / )"
              className="fixed bottom-5 right-5 z-40 w-11 h-11 rounded-full border flex items-center justify-center transition-colors row-hover"
              style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
        <MessageCircle size={17} style={{ color: "var(--dim)" }} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(390px,calc(100vw-2.5rem))] rounded-xl border shadow-2xl flex flex-col"
         style={{ background: "var(--surface)", borderColor: "var(--line)", maxHeight: "min(70vh, 620px)" }}>

      <div className="flex items-start gap-2 px-3.5 py-2.5 border-b shrink-0"
           style={{ borderColor: "var(--line)" }}>
        <div className="min-w-0 flex-1">
          <p className="display text-[12.5px]">Ask about the data</p>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>
            patch {patchLabel || "—"} · {sliceId || "global-all"}
            {focus && ` · ${focus.name}`}
          </p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close"
                className="shrink-0 p-1 rounded row-hover" style={{ color: "var(--dim)" }}>
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto scroll-thin px-3.5 py-3 space-y-2 flex-1">
        {turns.length === 0 && (
          <>
            <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
              Answers come from the published files, not from memory. Each one says which
              data it read.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(focus ? [`How good is ${focus.name}?`, ...STARTERS] : STARTERS).map((s) => (
                <button key={s} onClick={() => ask(s)} disabled={busy}
                        className="text-[11px] px-2 py-1 rounded-full border transition-colors disabled:opacity-50"
                        style={{ borderColor: "var(--line)", color: "var(--dim)" }}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {turns.map((t, i) => (
          <Bubble key={i} turn={t}
                  onOpen={(r) => {
                    // A tier-list reference means "show me the ranking", so it
                    // opens the tab unfiltered; a named entity filters to it.
                    requestNav(r.tab, /tier list/i.test(r.name) ? "" : r.name);
                  }} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--dim)" }}>
            <Loader2 size={12} className="animate-spin" /> reading the published data…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-[11px] rounded px-2.5 py-2 border"
               style={{ color: "var(--danger)", borderColor: "var(--danger)33",
                        background: "color-mix(in srgb, var(--danger) 8%, transparent)" }}>
            <AlertTriangle size={12} className="mt-[2px] shrink-0" />
            <span>
              {error}
              {/ANTHROPIC_API_KEY|credential/i.test(error) && (
                <code className="mono text-[10px] block rounded p-1.5 mt-1.5"
                      style={{ background: "var(--bg)", color: "var(--signal)" }}>
                  export ANTHROPIC_API_KEY=sk-ant-…
                </code>
              )}
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex gap-1.5 px-3 py-2.5 border-t shrink-0" style={{ borderColor: "var(--line)" }}>
        <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && ask()}
               placeholder={focus ? `Ask about ${focus.name}…` : "Ask about a unit, item or comp…"}
               maxLength={500}
               className="flex-1 min-w-0 rounded px-2.5 py-1.5 text-[12px] border outline-none focus:border-[var(--accent)] transition-colors"
               style={{ background: "var(--bg)", borderColor: "var(--line)", color: "var(--text)" }} />
        <button onClick={() => ask()} disabled={busy || !draft.trim()}
                aria-label="Send"
                className="shrink-0 px-2.5 rounded flex items-center disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--bg)" }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>
    </div>
  );
}
