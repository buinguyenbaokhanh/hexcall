import React, { useState, useRef, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";

const GAP = 8;      // space between the anchor and the card
const MARGIN = 8;   // keep this far clear of the viewport edges

/**
 * Positions a floating card next to an anchor element using fixed coordinates.
 *
 * Rendered through a portal rather than inside the anchor, because the places
 * these are used (champion rows, comp cards, table rows) are `overflow-hidden`
 * containers that would otherwise crop the card. Fixed positioning also lets
 * it flip below the anchor when there isn't room above, instead of running off
 * the top of the window.
 */
export function useAnchoredPosition(anchorRef, cardRef, open, width) {
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const height = cardRef.current?.offsetHeight ?? 0;

    const roomAbove = a.top - GAP - MARGIN;
    const below = height > roomAbove && a.bottom + GAP + height + MARGIN <= window.innerHeight;
    const top = below ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - height);

    const left = Math.min(
      Math.max(MARGIN, a.left + a.width / 2 - width / 2),
      window.innerWidth - width - MARGIN,
    );
    setPos({ top, left, below });
  }, [anchorRef, cardRef, width]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    // Fixed coords are viewport-relative, so anything that moves the anchor
    // invalidates them.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return pos;
}

/**
 * Wraps any element so that hovering it shows `card` in a floating panel.
 * `as` lets the wrapper render as a table cell/row child where a <span> would
 * be invalid markup.
 */
export function HoverCard({ children, card, width = 260, className = "", as: Tag = "span" }) {
  const [hover, setHover] = useState(false);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const pos = useAnchoredPosition(anchorRef, cardRef, hover && Boolean(card), width);

  return (
    <Tag ref={anchorRef} className={className}
         onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {children}
      {hover && card && createPortal(
        <span
          ref={cardRef}
          role="tooltip"
          className="rounded-lg border p-3 text-left shadow-xl"
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width,
            zIndex: 70,
            background: "var(--raised)",
            borderColor: "var(--line)",
            pointerEvents: "none",
            visibility: pos ? "visible" : "hidden",
          }}
        >
          {card}
        </span>,
        document.body,
      )}
    </Tag>
  );
}
