import React, { createContext, useContext, useMemo, useState } from "react";

/**
 * What the player is currently looking at.
 *
 * The floating assistant is only worth more than a tab because it can see the
 * screen: with Jhin's row open on the Units tab, "what about his items" should
 * resolve without retyping the name. Nothing else in the app needs this, so it
 * stays a single small value rather than a state library -- a tab reports what
 * it expanded, and the dock reads it.
 *
 * Deliberately not persisted and not in the URL. It describes a moment, and a
 * stale focus is worse than none: answering about a unit the player closed ten
 * minutes ago is more confusing than asking them to name it.
 */
const FocusContext = createContext({
  focus: null, setFocus: () => {},
  nav: null, requestNav: () => {}, consumeNav: () => null,
});

export function FocusProvider({ children }) {
  const [focus, setFocus] = useState(null);
  // A pending "show me this" from the assistant. Held here rather than pushed
  // into each tab so the tab that owns it can pick it up when it renders, and
  // the ones that don't simply never see it.
  const [nav, setNav] = useState(null);

  const value = useMemo(() => ({
    focus, setFocus, nav,
    requestNav: (tab, query) => setNav({ tab, query, at: Date.now() }),
    // Claimed by exactly one tab, then cleared -- otherwise switching back to a
    // tab later would silently re-apply a search the player has moved on from.
    consumeNav: (tab) => {
      if (!nav || nav.tab !== tab) return null;
      setNav(null);
      return nav.query || "";
    },
  }), [focus, nav]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export const useFocus = () => useContext(FocusContext);

/**
 * Report an expanded row. Pass null when it collapses -- the dock should stop
 * claiming to see something the player has closed.
 */
export function useReportFocus() {
  const { setFocus } = useFocus();
  return (kind, name) => setFocus(name ? { kind, name } : null);
}

/**
 * Apply an incoming "show me this" once, if it is meant for this tab.
 *
 * The assistant answers about a unit and offers a link; clicking it switches
 * tab AND filters to that row, because landing on a 65-row table with no idea
 * which line was meant is barely better than not linking at all.
 */
export function useIncomingNav(tab, applyQuery) {
  const { nav, consumeNav } = useFocus();
  React.useEffect(() => {
    if (!nav || nav.tab !== tab) return;
    const q = consumeNav(tab);
    if (q !== null) applyQuery(q);
  }, [nav, tab]);
}
