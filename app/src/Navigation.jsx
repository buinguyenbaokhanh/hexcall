import React, { useEffect, useRef, useState } from "react";
import {
  ChevronRight, Gem, History, Layers, LayoutGrid, Shield, Sparkles,
  Swords, TrendingUp, Users, Zap,
} from "lucide-react";

export const groups = [
  { label: "Explore the Meta", pages: [
    { id: "comps", title: "Team Comps", Icon: Swords,
      description: "Explore ranked boards, their carries, and the items that tie them together." },
    { id: "trends", title: "Meta Trends", navLabel: "Trends", Icon: TrendingUp,
      description: "Track placements and play rates across match days." },
  ] },
  { label: "Plan a Build", pages: [
    { id: "advisor", title: "Build Advisor", Icon: Sparkles,
      description: "Find boards that fit your augment choices." },
    { id: "planner", title: "Item Planner", Icon: Layers,
      description: "Turn your components into items and find the units that use them." },
  ] },
  { label: "Game Reference", pages: [
    { id: "champions", title: "Unit Tier List", navLabel: "Units", Icon: Users,
      description: "Compare unit placements, traits, and item builds." },
    { id: "items", title: "Item Tier List", navLabel: "Items", Icon: Gem,
      description: "Find strong item holders and the components for each recipe." },
    { id: "traits", title: "Trait Breakpoints", navLabel: "Traits", Icon: Shield,
      description: "Compare each synergy across its active levels." },
    { id: "augments", title: "Augment Library", navLabel: "Augments", Icon: Zap,
      description: "Look up effects, rarity, and related champions." },
  ] },
  { label: "My Games", pages: [
    { id: "review", title: "Match Review", Icon: History,
      description: "Look up your games and compare your boards with the ranked sample." },
  ] },
];

const pages = new Map(groups.flatMap((group) =>
  group.pages.map((page) => [page.id, { ...page, group: group.label }])));
export const pageFor = (id) => pages.get(id);
export const currentPage = () => {
  const id = window.location.hash.slice(2).split("?")[0];
  return pages.has(id) ? id : "advisor";
};

export function pageLink(id, query) {
  return `#/${id}${query == null ? "" : "?" + new URLSearchParams({ q: query })}`;
}

export function navigate(id, query) {
  if (!pages.has(id)) return;
  const hash = pageLink(id, query);
  if (hash !== window.location.hash) window.location.hash = hash;
  else window.dispatchEvent(new Event("hashchange"));
}

function routeQuery() {
  const start = window.location.hash.indexOf("?");
  return start < 0 ? null : new URLSearchParams(window.location.hash.slice(start + 1)).get("q");
}

// A selected search result creates a history entry. Editing the text updates
// that entry in place so Back returns to the previous page in a single step.
export function usePageQuery(page, onLinkedSearch) {
  const [query, setQuery] = useState(() => routeQuery() || "");
  const resetFilters = useRef(onLinkedSearch);
  resetFilters.current = onLinkedSearch;
  useEffect(() => {
    function restore() {
      if (currentPage() !== page) return;
      const text = routeQuery();
      setQuery(text || "");
      if (text !== null) resetFilters.current?.();
    }
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [page]);
  function edit(text) {
    setQuery(text);
    window.history.replaceState(window.history.state, "", pageLink(page, text || null));
  }
  return [query, edit];
}

export default function Navigation({ active, onBrowse }) {
  return (
    <nav className="site-navigation" aria-label="Main navigation">
      <div className="section-links">
        {groups.map(({ label, pages: entries }) => (
          <div className="nav-group" key={label}>
            <p>{label}</p>
            {entries.map(({ id, title, navLabel, Icon }) => (
              <a key={id} href={`#/${id}`} aria-current={active === id ? "page" : undefined}>
                <Icon size={17} aria-hidden="true" />{navLabel || title}
                {active === id && <ChevronRight className="nav-pointer" size={14} />}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="mobile-nav">
        {[["comps", "Comps"], ["champions", "Units"], ["planner", "Planner"]].map(([id, name]) => {
          const { Icon } = pageFor(id);
          return <a key={id} href={`#/${id}`} aria-current={active === id ? "page" : undefined}>
            <Icon size={19} />{name}
          </a>;
        })}
        <button onClick={onBrowse} aria-haspopup="dialog" data-selected={!(["comps", "champions", "planner"].includes(active)) || undefined}><LayoutGrid size={19} />All Pages</button>
      </div>
    </nav>
  );
}
