import type { SupabaseClient } from "@supabase/supabase-js";
import { linkRefs, numberParas, structureHtml, type Heading } from "@/lib/docs";
import { linkIndex, rewriteLinks } from "@/lib/links";
import { renderCharts } from "@/lib/orgchart";

/* DOC-16 · one chapter made ready to read: its headings, the links copied from the source system (same manual → its chapter, other manuals →
 * S.A.M., web addresses in a new tab) and the plain chapter numbers of the manual's own table of contents turned into links.
 * Shared by the manual page (first display) and by /api/docs/section (every chapter opened after that, without reloading the page). */
export type ChapterMeta = { id: string; ref: string; uid?: string | null; headings: Heading[] };
export type ChapterBody = { html?: string; text?: string; structured?: boolean; headings?: Heading[]; pages?: string[]; page_start?: { pg: string; date: string; rev: string; logo?: string } | null };
export type ChapterRow = { id: string; ord: number; ref: string; title: string | null; body: ChapterBody };

export function chapterStructure(active: ChapterRow): { html: string; headings: Heading[] } {
  return active.body.structured ? { html: active.body.html ?? "", headings: active.body.headings ?? [] } : structureHtml(active.body.html ?? `<p>${active.body.text ?? ""}</p>`, `s${active.ord}`, active.ref);
}

export async function chapterHtml(admin: () => SupabaseClient, o: { manualId: string; revId: string | null; sections: ChapterMeta[]; active: ChapterRow; structured?: { html: string; headings: Heading[] } }): Promise<string> {
  const st = o.structured ?? chapterStructure(o.active);
  const chapterRefs = new Map(o.sections.map((x) => [x.ref, x.id]));
  const subRefs = new Map<string, { ref: string; id: string }>();
  for (const x of o.sections) for (const h of (x.id === o.active.id ? st.headings : x.headings)) { const mm = /^([A-Z]{0,2}\d*(?:\.\d+){1,3})\b/.exec(h.text); if (mm && !chapterRefs.has(mm[1])) subRefs.set(mm[1], { ref: x.ref, id: h.id }); }
  const selfUids = new Map<string, string>(); for (const x of o.sections) if (x.uid) selfUids.set(x.uid, x.ref);
  const base = o.revId ? `/docs/manual/${o.manualId}?rev=${o.revId}` : `/docs/manual/${o.manualId}?x=1`;
  const refHref = (inner: string): string | null => {
    const mm = /^\s*([A-Z]{0,2}\d*(?:\.\d+){0,4})\b/.exec(inner.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
    let k = mm?.[1] ?? "";
    while (k) { if (chapterRefs.has(k)) return `${base}&sec=${encodeURIComponent(k)}`; const sr = subRefs.get(k); if (sr) return `${base}&sec=${encodeURIComponent(sr.ref)}#${sr.id}`; k = k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : ""; }
    return null;
  };
  const src = st.html;
  const linked = /<a\b/i.test(src)
    ? rewriteLinks(src, { idx: /\/reader\/#\/|\/docs\/link\/ch\//.test(src) ? await linkIndex(admin()) : null, selfManualId: o.manualId, base: "", newTab: true, selfUids, self: (ref) => (ref ? `${base}&sec=${encodeURIComponent(ref)}` : null), textTarget: refHref })
    : src;
  return numberParas(renderCharts(/table des mati|contents|sommaire/i.test(o.active.title ?? "") ? linkRefs(linked, chapterRefs, subRefs, base) : linked));
}
