// Web Manuals export → S.A.M. sections. Pure functions (no I/O) so they can be unit-tested.
export type WmPage = { id: number; number: string; name: string; isChapter?: boolean; html: string };
export type WmToc = { chapter: string; pageId: number; pageNumber: string; title: string; parentChapter: string | null };
export type WmBundle = {
  format: string; kind?: "pages" | "pdf" | "file";
  manual: { wmId: number; name: string; type?: string; revisionId: number; issue?: string; rev?: string; revisionDate?: string; publishedDate?: string; pdfURL?: string; composite?: boolean; categoryId?: number; parts?: { wmId: number; name: string; rev?: string; revisionDate?: string; pages?: number }[] };
  toc: WmToc[]; pages: WmPage[]; images?: Record<string, { name: string; type: string; size: number; b64?: string }>;
  file?: { name: string; type: string; size: number; b64?: string };
};
export type PageMeta = { title: string; date: string; iss: string; rev: string; logo?: string };
export type BuiltSection = { ord: number; ref: string; title: string; html: string; text: string; pages: string[]; pageRevs: string[]; pageIds: string[]; pageMeta: (PageMeta | null)[]; start: { pg: string; date: string; rev: string; logo?: string } | null; changed: boolean };

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ecirc;/g, "ê").replace(/&acirc;/g, "â").replace(/&ocirc;/g, "ô").replace(/&icirc;/g, "î").replace(/&ucirc;/g, "û").replace(/&ccedil;/g, "ç").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "’").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&deg;/g, "°").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—");

export function pageRevision(html: string): string | null {
  const head = /manual-header[\s\S]*?<div class="manual-content/.exec(html)?.[0] ?? "";
  const marks = [...head.matchAll(/headerfooter-marker"\s*>([^<]*)</g)].map((m) => m[1].trim());
  return marks.length ? marks[marks.length - 1] : null;
}
/** DOC-15 · what the Web Manuals page header says of the page: the chapter title, the date and the issue / revision of that page. */
export function pageHeader(html: string): PageMeta | null {
  const head = /manual-header[\s\S]*?<div class="manual-content/.exec(html)?.[0] ?? "";
  if (!head) return null;
  const marks = [...head.matchAll(/headerfooter-marker"[^>]*>([^<]*)</g)].map((m) => decode(m[1]).trim()).filter(Boolean);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(head)?.[1] ?? "";
  const title = decode(h1.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const date = marks.find((x) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(x) || /^\d{4}-\d{2}-\d{2}$/.test(x)) ?? "";
  const tail = marks.filter((x) => x !== date && /^[A-Za-z0-9.]{1,6}$/.test(x));
  const rev = marks.length ? marks[marks.length - 1] : ""; const iss = tail.length >= 2 && tail[tail.length - 1] === rev ? tail[tail.length - 2] : "";
  const logo = /sam-img:\/\/(\d+)/.exec(head)?.[1];
  return { title, date, iss: /^\d/.test(iss) ? iss : "", rev: rev === date ? "" : rev, logo };
}
export function pageContent(html: string): string {
  const m = /<!-- CONTENT_MARKER_START -->([\s\S]*?)<!-- CONTENT_MARKER_END -->/.exec(html);
  return m ? m[1] : html;
}
/** Removes Web Manuals chrome: wrappers, inline styles, classes; keeps semantic tags, tables and images. */
export function cleanHtml(h: string, imgSrc: (id: string) => string): string {
  let s = h;
  s = s.replace(/(<h[1-6][^>]*>(?:\s|&nbsp;|<[^>]+>)*)\*(?:\s|&nbsp;)*/g, "$1"); // FB-057 · WM leaves a "* " in front of sub-chapter headings
  // Web Manuals "changed in this revision" marker: tooltip + warning icon → revision bar on the section
  s = s.replace(/<div class="sectionDifferenceToolTip">[\s\S]*?<\/svg>\s*<\/div>/g, "");
  s = s.replace(/<div class="section-wrapper[^"]*(?:sectionDifference|section-changed|section-new)[^"]*"[^>]*>/g, '<div data-samrev="1">');
  s = s.replace(/<svg[\s\S]*?<\/svg>/g, "");
  // DOC-15 · lettered and roman lists keep their markers ("§ d)" must still point at d). Web Manuals writes the letter d of a list cut by a
  // paragraph as roman 500, c as 100, l as 50, m as 1000: read back as letters.
  s = s.replace(/<ol([^>]*?)\sstyle="[^"]*list-style-type:\s*([a-z-]+)[^"]*"([^>]*)>/g, (m, a: string, t: string, b: string) => {
    const T = ({ "lower-alpha": "a", "lower-latin": "a", "upper-alpha": "A", "upper-latin": "A", "lower-roman": "i", "upper-roman": "I", decimal: "1" } as Record<string, string>)[t];
    if (!T) return m;
    let rest = (a + b).replace(/\stype="[^"]*"/, ""); let type = T;
    const st = /\sstart="(\d+)"/.exec(rest); const letter = ({ 50: 12, 100: 3, 500: 4, 1000: 13 } as Record<number, number>)[Number(st?.[1] ?? 0)];
    if ((T === "i" || T === "I") && letter) { type = T === "i" ? "a" : "A"; rest = rest.replace(/\sstart="\d+"/, ` start="${letter}"`); }
    return `<ol${rest} type="${type}" data-samol="${type === "a" ? "la" : type === "A" ? "ua" : type === "i" ? "lr" : type === "I" ? "ur" : "d"}">`;
  });
  // large lines (cover and title pages) keep their rank: three sizes above the body text
  s = s.replace(/<(p|span|strong|b|h[1-6]|td)([^>]*?)\sstyle="([^"]*font-size:\s*([\d.]+)(px|pt)[^"]*)"([^>]*)>/g, (m, tag: string, a: string, st: string, n: string, u: string, b: string) => {
    const px = Number(n) * (u === "pt" ? 1.333 : 1); const k = px >= 27 ? 3 : px >= 21 ? 2 : px >= 17 ? 1 : 0;
    return k ? `<${tag}${a} style="${st}"${b} data-samfs="${k}">` : m;
  });
  // centred lines (cover pages) stay centred
  s = s.replace(/<(p|h[1-6]|td)([^>]*?)(?:\sstyle="[^"]*text-align:\s*center[^"]*"|\salign="center")([^>]*)>/g, '<$1$2$3 data-samtc="1">');
  s = s.replace(/<div style="clear: both;"><\/div>/g, "");
  s = s.replace(/<span class="autoGeneratedSectionNbr">([\s\S]*?)<\/span>/g, (_m, n: string) => decode(n).trim() + " ");
  s = s.replace(/<img([^>]*)data-sam-img="(\d+)"[^>]*>/g, (_m, _a, id: string) => `<img src="${imgSrc(id)}" alt="figure" loading="lazy" />`);
  s = s.replace(/<img[^>]*src="sam-img:\/\/(\d+)"[^>]*>/g, (_m, id: string) => `<img src="${imgSrc(id)}" alt="figure" loading="lazy" />`);
  s = s.replace(/<(div|section)(?![^>]*data-samrev)[^>]*>/g, "<div>").replace(/<\/(section)>/g, "</div>");
  s = s.replace(/<div data-samrev="1">/g, '<div class="revbar">');
  s = s.replace(/\s(style|class|id|width|height|border|cellpadding|cellspacing|align|valign|bgcolor|data-[\w-]+)="[^"]*"/g, (m, attr: string) => (attr === "colspan" || attr === "rowspan" || m === ' class="revbar"' || m === ' data-samtc="1"' || /^ data-samfs="[123]"$/.test(m) || /^ data-samol="[a-z]+"$/.test(m) ? m : ""));
  s = s.replace(/ data-samol="([a-z]+)"/g, ' class="ol-$1"'); // the type attribute cannot tell a from A in a style rule
  s = s.replace(/<(\w+)(\s[^>]*data-sam(?:tc|fs)="\d"[^>]*)>/g, (_m, tag: string, at: string) => { const fs = /samfs="(\d)"/.exec(at)?.[1]; return `<${tag}${at.replace(/ data-sam(?:tc|fs)="\d"/g, "")} class="${[/samtc/.test(at) ? "tc" : "", fs ? "fs" + fs : ""].filter(Boolean).join(" ")}">`; });
  for (let i = 0; i < 6; i++) { const before = s; s = s.replace(/<span>\s*<\/span>/g, "").replace(/<span>((?:(?!<span>)[\s\S])*?)<\/span>/g, "$1"); if (s === before) break; }
  s = s.replace(/<p>(\s|&nbsp;)*<\/p>/g, "").replace(/<div>\s*<\/div>/g, "");
  s = s.replace(/<p(?: class="[a-z0-9 ]+")?>\s*(<img[^>]*>)\s*<\/p>/g, '<figure>$1</figure>');
  s = s.replace(/<(table|tbody|tr|td|th)\s*>/g, "<$1>");
  s = s.replace(/\s{2,}/g, " ");
  // a paragraph entirely in bold that starts with a number ("1. OBJECT", "3.2 Scope") is a heading: number in the margin, title in bold
  s = s.replace(/<p>((?:(?!<\/p>)[\s\S])*?)<\/p>/g, (m, inner: string) => {
    if (!/<(b|strong)>/.test(inner) || /<img/.test(inner)) return m;
    if (inner.replace(/<(b|strong)>[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() !== "") return m;
    const text = decode(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const h = /^(\d+(?:\.\d+)*)[.)]?\s+(\S.{1,110})$/.exec(text);
    if (!h) return m;
    return `<h4 class="nh"><span class="hn">${h[1]}</span>${h[2].replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h4>`;
  });
  return s.trim();
}
export function htmlToText(h: string): string {
  return decode(h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "").replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li|table|figure)>/g, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
/** Chapters = two-level toc entries (A.3, 0.2). Content is split at the heading that carries the chapter number. */
export function buildSections(bundle: WmBundle, imgSrc: (id: string) => string): BuiltSection[] {
  const rev = bundle.manual.rev ?? "";
  const chapters: { ref: string; title: string; pageId?: number }[] = [];
  // WM-02 · a composite manual (one WM document per chapter, A.8.1.0, B.3.2…): the top entries of each document's TOC are the chapters
  const composite = !!bundle.manual.composite;
  for (const t of bundle.toc) {
    const top = composite ? t.parentChapter === null && /^[A-Za-z0-9.]+$/.test(t.chapter) : /^[A-Za-z0-9]+\.\d+$/.test(t.chapter);
    // WM-03 · a top entry of the table of contents is a chapter too, whatever its depth (A.08.00, A.08.01… when chapter 8 is split)
    const root = !composite && t.parentChapter === null && /^[A-Za-z0-9]+(\.[A-Za-z0-9]+)+$/.test(t.chapter ?? "");
    if ((top || root) && !chapters.some((c) => c.ref === t.chapter)) chapters.push({ ref: t.chapter, title: decode(t.title), pageId: t.pageId });
  }
  // one stream with page markers
  const stream = bundle.pages.map((p) => `<!--pg:${p.number || "cover"}:${pageRevision(p.html) ?? ""}:${p.id ?? ""}-->` + pageContent(p.html)).join("\n");
  // split points: headings whose section number equals a chapter ref
  const cuts: { ref: string; title: string; idx: number }[] = [];
  if (chapters.length) {
    const re = /<h([1-4])[^>]*>\s*<span class="autoGeneratedSectionNbr">\s*([A-Za-z0-9.]+)(?:&nbsp;|\s)*<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stream))) { const ref = m[2].replace(/\.$/, ""); const c = chapters.find((x) => x.ref === ref); if (c && !cuts.some((x) => x.ref === ref)) cuts.push({ ref, title: c.title, idx: m.index }); }
    // a chapter whose number is only in the page header (its first heading is already A.01.0): it starts with the page the contents give it
    for (const c of chapters) { if (cuts.some((x) => x.ref === c.ref) || !c.pageId) continue; const at = stream.search(new RegExp(`<!--pg:[^:]*:[^:>]*:${c.pageId}-->`)); if (at >= 0 && !cuts.some((x) => x.idx === at)) cuts.push({ ref: c.ref, title: c.title, idx: at }); }
  } else {
    // no numbered chapters (policies, guides): one chapter per top-level heading, numbered 1..n
    const re = /<h([12])[^>]*>([\s\S]*?)<\/h\1>/g;
    let m: RegExpExecArray | null; let n = 0;
    while ((m = re.exec(stream))) { const text = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\*\s*/, "").trim(); if (!text) continue; n++; cuts.push({ ref: String(n), title: text, idx: m.index }); }
    if (!cuts.length) { const re3 = /<h3[^>]*>([\s\S]*?)<\/h3>/g; while ((m = re3.exec(stream))) { const text = decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\*\s*/, "").trim(); if (!text) continue; n++; cuts.push({ ref: String(n), title: text, idx: m.index }); } }
  }
  cuts.sort((a, b) => a.idx - b.idx);
  const pieces: { ref: string; title: string; html: string }[] = [];
  if (!cuts.length) {
    // a plain document without headings (short policy): one chapter named after the document
    // DOC-15 · its cover page (the first page, without a number) becomes the Cover; the rest takes the title its pages carry in their header
    const second = bundle.pages.length > 1 && !bundle.pages[0].number ? stream.indexOf("<!--pg:", 8) : -1;
    const bodyTitle = (second > 0 && pageHeader(bundle.pages[1].html)?.title) || bundle.manual.name;
    if (second > 0) { pieces.push({ ref: "0", title: "Cover", html: stream.slice(0, second) }); pieces.push({ ref: "1", title: bodyTitle, html: stream.slice(second) }); }
    else pieces.push({ ref: "1", title: bundle.manual.name, html: stream });
  } else
  pieces.push({ ref: "0", title: "Cover", html: stream.slice(0, cuts[0]?.idx ?? stream.length) });
  cuts.forEach((c, i) => pieces.push({ ref: c.ref, title: c.title, html: stream.slice(c.idx, cuts[i + 1]?.idx ?? stream.length) }));
  // chapters never found as headings (toc only) are appended empty so the TOC stays complete
  for (const c of chapters) if (!pieces.some((p) => p.ref === c.ref)) pieces.push({ ref: c.ref, title: c.title, html: "" });
  const allRevs = new Set(bundle.pages.map((p) => pageRevision(p.html) ?? ""));
  const usePageRevs = allRevs.size > 1;
  let lastRev = ""; let lastPage = ""; let lastId = "";
  const headers = new Map(bundle.pages.map((p) => [String(p.id ?? ""), pageHeader(p.html)]));
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return pieces.map((p, ord) => {
    const pages: string[] = []; const pageRevs: string[] = []; const pageIds: string[] = [];
    const prevPage = lastPage, prevId = lastId; let atStart = false;
    // marker: number : page revision : Web Manuals page id (the id is what cross-references point to)
    const body = p.html.replace(/<!--pg:([^:]*):([^:>]*)(?::(\d*))?-->/g, (_m, num: string, r: string, id?: string) => { lastPage = num; lastRev = r; lastId = id ?? ""; pages.push(num); pageRevs.push(r); pageIds.push(id ?? ""); return `<p>@@PG${pages.length - 1}@@</p>`; });
    if (!pages.length && lastPage) { pages.push(lastPage); pageRevs.push(lastRev); pageIds.push(lastId); }
    const pageMeta = pageIds.map((id) => headers.get(id) ?? null);
    // DOC-15 · where a Web Manuals page ends, a page mark stays in the text (number, date and revision of the page that starts): the reader
    // shows it as a discreet rule and keeps the page number the authority and the LEP refer to. No mark before the first line of a chapter.
    const html = cleanHtml(body, imgSrc).replace(/(?:<p>)?@@PG(\d+)@@(?:<\/p>)?/g, (_m, i: string, off: number, all: string) => {
      const n = Number(i); const before = all.slice(0, off);
      if (!/<img/.test(before) && before.replace(/<[^>]+>/g, "").replace(/@@PG\d+@@/g, "").trim() === "") { if (n === 0) atStart = true; return ""; }
      const pm = pageMeta[n];
      return `<div class="pgmark" data-pg="${esc(pages[n] || "cover")}" data-date="${esc(pm?.date ?? "")}" data-rev="${esc(pm ? [pm.iss, pm.rev].filter(Boolean).join(" / ") : "")}"></div>`;
    });
    // the page the chapter starts on: its first page mark when the chapter opens a page, otherwise the page already running
    const sm = atStart || !prevPage ? pageMeta[0] : headers.get(prevId) ?? null; const sp = atStart || !prevPage ? pages[0] ?? "" : prevPage;
    const start = sp || sm ? { pg: sp || "cover", date: sm?.date ?? "", rev: sm ? [sm.iss, sm.rev].filter(Boolean).join(" / ") : "", logo: sm?.logo ? imgSrc(sm.logo) : undefined } : null;
    return { ord, ref: p.ref, title: p.title, html, text: htmlToText(html), pages, pageRevs, pageIds, pageMeta, start, changed: html.includes('class="revbar"') || (!composite && usePageRevs && !!rev && pageRevs.includes(rev)) };
  });
}
export function imageExt(name: string, type: string): string {
  const fromName = /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return type.includes("png") ? "png" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("gif") ? "gif" : type.includes("svg") ? "svg" : "bin";
}
