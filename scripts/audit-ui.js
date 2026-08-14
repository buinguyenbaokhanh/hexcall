/**
 * HexCall UI audit — contrast, images, focus, landmarks, overflow.
 *
 * HOW TO RUN
 *   Open any HexCall build (localhost:5173 or the deployed site), open the
 *   browser console, paste this whole file, press enter. It walks every tab
 *   and prints a table of anything that fails.
 *
 * WHY IT'S A CONSOLE SCRIPT AND NOT A TEST
 *   These checks need a rendered page with real data in it -- computed colours
 *   against real backgrounds, images that actually 404, focus styles that only
 *   exist once an element is focused. Driving that from CI means Playwright and
 *   a browser download, several hundred megabytes of tooling for an app whose
 *   entire bundle is 92 KB. If this ever needs to gate a deploy, that's the
 *   time to add it; until then pasting costs nothing and catches the same
 *   things.
 *
 *   `/code-review` and `/simplify` cover the code side, but they read diffs --
 *   they cannot see that a colour is invisible once painted. The two halves
 *   don't overlap.
 *
 * WHAT IT WON'T CATCH
 *   Screen reader announcement order, keyboard traps, motion sensitivity, and
 *   anything needing judgement about whether a label is meaningful. Passing
 *   this is a floor, not a verdict.
 */
(async () => {
  const WCAG_NORMAL = 4.5;   // AA, body text
  const WCAG_LARGE = 3.0;    // AA, >=24px or >=18.66px bold
  const TABS = ["Advisor", "Items I hold", "Comps", "Augments", "Units",
                "Items", "Traits", "Trends", "Review My Games"];

  const srgb = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const ratio = (fg, bg) => {
    const [hi, lo] = [lum(parse(fg)), lum(parse(bg))].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  };

  // The background actually behind the text, not document.body's. Measuring
  // against the body reports dark-on-gold tier badges as failures and misses
  // real ones inside raised cards, which is how a first pass at this got both
  // a false positive and a false negative in the same run.
  const realBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };

  const byText = (t) => [...document.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === t);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A collapsed or hidden pane reports clientWidth 0, which makes every element
  // on the page look like it overflows. Bail rather than print nine false
  // positives.
  if (!window.innerWidth) {
    console.error("Viewport reports zero width — bring the window to the front and re-run.");
    return;
  }

  const contrast = new Map();
  const overflow = {};
  let imgs = 0, broken = 0, noAlt = 0, nodes = 0;

  for (const tab of TABS) {
    const b = byText(tab);
    if (!b) continue;
    b.click();
    await sleep(900);   // let images load and the table paint

    const tabImgs = [...document.querySelectorAll("main img")];
    imgs += tabImgs.length;
    broken += tabImgs.filter((i) => i.complete && i.naturalWidth === 0).length;
    noAlt += tabImgs.filter((i) => !i.hasAttribute("alt")).length;
    overflow[tab] = document.body.scrollWidth > window.innerWidth;

    for (const el of document.querySelectorAll("main *")) {
      // Leaf nodes only: a parent's computed colour isn't what you see if its
      // children set their own.
      if (!el.textContent.trim() || el.children.length) continue;
      nodes++;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const r = ratio(cs.color, realBg(el));
      const need = large ? WCAG_LARGE : WCAG_NORMAL;
      if (r < need) {
        contrast.set(cs.color + size, {
          tab, colour: cs.color, size: size + "px",
          ratio: +r.toFixed(2), needs: need, sample: el.textContent.trim().slice(0, 30),
        });
      }
    }
  }

  // Focus ring: check the RULE, not the computed style.
  //
  // :focus-visible is deliberately not matched by a programmatic .focus() on a
  // button -- the browser only applies it to focus it judges should be visible,
  // essentially keyboard navigation. So probing with el.focus() and reading
  // getComputedStyle always reports "no ring", even when tabbing to the same
  // button clearly draws one. Asserting the rule exists and paints something is
  // the check that actually corresponds to the behaviour.
  let hasRing = false;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }  // cross-origin sheet
    for (const rule of rules || []) {
      if (rule.selectorText?.includes(":focus-visible")
          && (rule.style?.outline || rule.style?.outlineStyle || rule.style?.boxShadow)) {
        hasRing = true;
      }
    }
  }

  const structure = {
    "h1 present": document.querySelectorAll("h1").length === 1,
    "landmarks (main/nav/header)": !!document.querySelector("main")
      && !!document.querySelector("nav") && !!document.querySelector("header"),
    "tabs use role=tablist": !!document.querySelector('[role="tablist"]'),
    "tabs expose aria-selected": document.querySelectorAll('[role="tab"][aria-selected]').length > 0,
    "tabpanel labelled": !!document.querySelector('[role="tabpanel"][aria-labelledby]'),
    "html lang set": !!document.documentElement.lang,
    "visible focus ring": !!hasRing,
    "images all load": broken === 0,
    "images all have alt": noAlt === 0,
    "no page overflow": Object.values(overflow).every((v) => !v),
  };

  console.log(`%cHexCall UI audit — ${nodes} text nodes, ${imgs} images, ${TABS.length} tabs`,
              "font-weight:bold;font-size:13px");
  console.table(structure);
  if (contrast.size) {
    console.log(`%c${contrast.size} contrast failures`, "color:#FF7A85;font-weight:bold");
    console.table([...contrast.values()]);
  } else {
    console.log("%cNo contrast failures", "color:#46E0B0;font-weight:bold");
  }
  const bad = Object.entries(overflow).filter(([, v]) => v).map(([k]) => k);
  if (bad.length) console.log("%cHorizontal overflow on: " + bad.join(", "), "color:#FF7A85");

  const failed = Object.entries(structure).filter(([, v]) => !v).map(([k]) => k);
  return { pass: failed.length === 0 && contrast.size === 0, failed, contrastFailures: contrast.size };
})();
