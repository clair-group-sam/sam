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
      dates();
    };
    /* FB-134 · one date format on screen, whatever the page wrote: an ISO date (2026-11-19) is shown 19/11/2026.
     * Only text is touched, never a field, and never the text of a manual, a report narrative, code or raw data;
     * a reference that merely contains digits and dashes (FSR-2024-04-05) is left alone. */
    const ISO = /(?<![\w-])(20\d\d)-(\d\d)-(\d\d)(?![\w-])/g;
    const dates = () => {
      const root = document.querySelector("main"); if (!root) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.nodeValue || n.nodeValue.length < 10 || !/20\d\d-\d\d-\d\d/.test(n.nodeValue) || (n.parentElement?.closest("pre,code,textarea,script,style,[contenteditable],.ProseMirror,.reader,[data-keep-dates]")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const hits: Text[] = []; while (w.nextNode()) hits.push(w.currentNode as Text);
      for (const n of hits) { const v = n.nodeValue!.replace(ISO, "$3/$2/$1"); if (v !== n.nodeValue) n.nodeValue = v; }
    };
    pass();
    let t: ReturnType<typeof setTimeout> | undefined;
    const main = document.querySelector("main");
    const mo = main ? new MutationObserver(() => { clearTimeout(t); t = setTimeout(pass, 250); }) : null;
    if (main && mo) mo.observe(main, { childList: true, subtree: true, characterData: true });
    // the framework writes the default <title> after the page has streamed in: put the page's own title back when that happens
    const retitle = () => { const h1 = document.querySelector("main h1")?.textContent?.trim(); if (h1 && !document.title.startsWith(h1)) document.title = `${h1} · S.A.M.`; };
    const ho = new MutationObserver(retitle); ho.observe(document.head, { childList: true, subtree: true, characterData: true });
    const late = setTimeout(retitle, 1200);
    return () => { mo?.disconnect(); ho.disconnect(); clearTimeout(t); clearTimeout(late); };
  }, [path]);
  return null;
}

