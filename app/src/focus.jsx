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
});

export function FocusProvider({ children }) {
  const [focus, setFocus] = useState(null);
  const value = useMemo(() => ({ focus, setFocus }), [focus]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export const useFocus = () => useContext(FocusContext);

/**
 * Report an expanded row. Pass null when it collapses -- the dock should stop
 * claiming to see something the player has closed.
 */
export function useReportFocus() {
  const { setFocus } = useFocus();
  React.useEffect(() => () => setFocus(null), [setFocus]);
  return (kind, name) => setFocus(name ? { kind, name } : null);
}
