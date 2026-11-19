import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { groups, navigate, pageFor } from "./Navigation.jsx";

const normalize = (text) => text.toLowerCase().replace(/['’]/g, "").trim();

function buildSearchIndex(stats, championMeta, augmentMeta, traitMeta, itemMeta) {
  const results = [];
  const seen = new Set();
  function add(page, label, kind, isPage = false, alias) {
    if (!label) return;
    const term = normalize(label);
    const key = [page, kind, term].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    const terms = alias ? [term, normalize(alias)] : [term];
    results.push({ key, page, label, terms, kind, isPage });
  }
  for (const group of groups)
    for (const { id, title, navLabel } of group.pages) add(id, title, group.label, true, navLabel);
  for (const id of new Set([...Object.keys(championMeta), ...Object.keys(stats.champions || {})]))
    add("champions", championMeta[id]?.name || stats.champion_names?.[id] || id, "Unit");
  for (const id of Object.keys(stats.items || {}))
    add("items", itemMeta[id]?.name || stats.item_names?.[id] || id, "Item");
  for (const id of Object.keys(stats.traits || {}))
    add("traits", traitMeta[id]?.name || stats.trait_names?.[id] || id, "Trait");
  for (const id of Object.keys(stats.comps || {})) add("comps", stats.comp_names?.[id] || id, "Comp");
  for (const entry of Object.values(augmentMeta)) add("augments", entry.name, "Augment");
  return results;
}

export default function SiteSearch({ onClose, stats, championMeta, augmentMeta, traitMeta, itemMeta }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const [query, setQuery] = useState("");
  const index = useMemo(() => buildSearchIndex(stats, championMeta, augmentMeta, traitMeta, itemMeta),
    [stats, championMeta, augmentMeta, traitMeta, itemMeta]);
  const term = normalize(query);
  const results = useMemo(() => {
    if (!term) return index.filter((r) => r.isPage);
    const rank = (r) => r.terms.includes(term) ? 0 : r.terms.some((s) => s.startsWith(term)) ? 1 : 2;
    return index.filter((r) => r.terms.some((s) => s.includes(term)))
      .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)).slice(0, 15);
  }, [term, index]);

  useEffect(() => {
    const el = dialog.current;
    el.showModal();
    input.current.focus();
    return () => el.close();
  }, []);

  function choose(result) {
    onClose();
    navigate(result.page, result.isPage ? undefined : result.label);
    document.querySelector("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function moveFocus(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const buttons = [...list.current.querySelectorAll("button")];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = index + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) input.current.focus();
      else buttons[Math.min(next, buttons.length - 1)].focus();
    } else if (e.key === "Enter" && document.activeElement === input.current) {
      e.preventDefault();
      choose(results[0]);
    }
  }
  return (
    <dialog ref={dialog} className="site-search" aria-label="Search HexCall"
            onCancel={onClose} onKeyDown={moveFocus}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-body">
        <div className="search-entry">
          <Search size={19} aria-hidden="true" />
          <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search pages, units, comps…" aria-label="Search pages and game data" />
          <button aria-label="Close search" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="jump-results scroll-thin" ref={list}>
          <p className="jump-caption">{term ? "Results" : "All Pages"}</p>
          {results.map((r) => {
            const { Icon } = pageFor(r.page);
            return <button key={r.key} onClick={() => choose(r)}>
              <Icon size={17} /><span>{r.label}</span><small>{r.kind}</small><ArrowUpRight size={14} />
            </button>;
          })}
          {results.length === 0 && <p className="jump-empty" role="status">No matches for “{query.trim()}”.</p>}
        </div>
      </div>
    </dialog>
  );
}
