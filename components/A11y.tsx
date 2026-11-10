"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/* FB-114 / FB-115 · what a screen reader needs and the markup did not always give:
   - a name for every field (from its placeholder or its column header) and every icon-only button or link (from its title);
   - card titles announced as level-2 headings;
   - a browser-tab title per page ("Audit programme · S.A.M."), so tabs and history can be told apart.
   Runs after each render of the page; it only adds attributes, never changes what is shown. */
export function A11y() {
  const path = usePathname();
  useEffect(() => {
    const name = (el: Element) => {
      const f = el as HTMLInputElement;
      if (f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.closest("label") || (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`))) return;
      const td = f.closest("td"); const tr = td?.parentElement; const table = td?.closest("table");
      const th = td && tr && table ? table.querySelector(`thead th:nth-child(${[...tr.children].indexOf(td) + 1})`)?.textContent?.trim() : "";
      const label = f.placeholder || f.title || th || (f.name ? f.name.replace(/[_-]+/g, " ") : "");
      if (label) f.setAttribute("aria-label", label);
    };
    const pass = () => {
      document.querySelectorAll("input:not([type=hidden]),select,textarea").forEach(name);
      document.querySelectorAll("button,a").forEach((el) => { if (!el.getAttribute("aria-label") && !(el.textContent ?? "").trim() && (el as HTMLElement).title) el.setAttribute("aria-label", (el as HTMLElement).title); });
      document.querySelectorAll("main .card > .ch > .eyebrow:not(h2)").forEach((el) => { if (!el.getAttribute("role")) { el.setAttribute("role", "heading"); el.setAttribute("aria-level", "2"); } });
      const h1 = document.querySelector("main h1")?.textContent?.trim();
      if (h1 && !document.title.startsWith(h1)) document.title = `${h1} · S.A.M.`;
    };
    pass();
    let t: ReturnType<typeof setTimeout> | undefined;
    const main = document.querySelector("main");
    const mo = main ? new MutationObserver(() => { clearTimeout(t); t = setTimeout(pass, 250); }) : null;
    if (main && mo) mo.observe(main, { childList: true, subtree: true });
    // the framework writes the default <title> after the page has streamed in: put the page's own title back when that happens
    const retitle = () => { const h1 = document.querySelector("main h1")?.textContent?.trim(); if (h1 && !document.title.startsWith(h1)) document.title = `${h1} · S.A.M.`; };
    const ho = new MutationObserver(retitle); ho.observe(document.head, { childList: true, subtree: true, characterData: true });
    const late = setTimeout(retitle, 1200);
    return () => { mo?.disconnect(); ho.disconnect(); clearTimeout(t); clearTimeout(late); };
  }, [path]);
  return null;
}

