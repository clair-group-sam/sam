import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Links inside manuals. Web Manuals cross-references look like /reader/#/<wmManualId>/p/<wmPageId>.
 * They are resolved against the manuals imported in S.A.M.: same manual → its chapter, another manual → that manual in S.A.M.,
 * unknown → the S.A.M. resolver page (/docs/link/wm/…), which explains why it cannot be opened. Real web addresses stay as they are.
 */
export type LinkIndex = {
  byWm: Map<string, { manualId: string; entity: string; code: string; title: string }>;
  pageRef: Map<string, { manualId: string; ref: string }>; // "<wmManualId>:<wmPageId>"
};

export async function linkIndex(db: SupabaseClient): Promise<LinkIndex> {
  const { data: revs } = await db.from("revisions").select("id,manual_id,step,published_at,wm:source->manualId,manuals(entity,code,title)").in("step", ["published", "repository"]).order("published_at", { ascending: false });
  type R = { id: string; manual_id: string; wm: number | string | null; manuals: { entity: string; code: string; title: string } | null };
  const latest = new Map<string, R>();
  for (const r of (revs ?? []) as unknown as R[]) if (r.wm && !latest.has(r.manual_id)) latest.set(r.manual_id, r);
  const byWm: LinkIndex["byWm"] = new Map();
  for (const r of latest.values()) byWm.set(String(r.wm), { manualId: r.manual_id, entity: r.manuals?.entity ?? "", code: r.manuals?.code ?? "", title: r.manuals?.title ?? "" });
  const pageRef: LinkIndex["pageRef"] = new Map();
  const ids = [...latest.values()].map((r) => r.id);
  if (ids.length) {
    const { data: secs } = await db.from("revision_sections").select("revision_id,ref,page_ids:body->page_ids").in("revision_id", ids);
    const wmOf = new Map([...latest.values()].map((r) => [r.id, { wm: String(r.wm), manualId: r.manual_id }]));
    for (const x of (secs ?? []) as { revision_id: string; ref: string; page_ids: string[] | null }[]) {
      const w = wmOf.get(x.revision_id); if (!w) continue;
      for (const pid of x.page_ids ?? []) if (pid && !pageRef.has(`${w.wm}:${pid}`)) pageRef.set(`${w.wm}:${pid}`, { manualId: w.manualId, ref: x.ref });
    }
  }
  return { byWm, pageRef };
}

const WM = /(?:https?:\/\/[a-z0-9.-]*webmanuals\.aero)?\/reader\/#\/(\d+)\/p\/(\d+)/i;

export function rewriteLinks(html: string, o: {
  idx: LinkIndex | null; selfManualId: string; base: string; // base: "" in the app, the site origin in a PDF
  self: (ref: string | null, inner: string) => string | null; // href for a place in the same manual (anchor in the PDF, ?sec= in the app)
  textTarget?: (inner: string) => string | null; // same-manual target found from the link text (e.g. "A.5.3")
  newTab?: boolean; // in the app: web addresses in a new tab, links inside the manual handled by the reader (data-nav)
}): string {
  const nav = o.newTab ? " data-nav" : "";
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (all, attrs: string, inner: string) => {
    const href = /href="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    if (/^(mailto|tel):/i.test(href)) return `<a href="${href}">${inner}</a>`;
    if (/^\/docs\/|^#(ch-|s\d)/.test(href)) return all; // already a S.A.M. link
    const wm = WM.exec(href);
    if (wm) {
      const [, wmId, pageId] = wm;
      const page = o.idx?.pageRef.get(`${wmId}:${pageId}`) ?? null;
      const man = o.idx?.byWm.get(wmId) ?? null;
      if (man && man.manualId === o.selfManualId) {
        const h = o.textTarget?.(inner) ?? o.self(page?.ref ?? null, inner);
        return h ? `<a href="${h}"${nav}>${inner}</a>` : inner;
      }
      if (man) return `<a href="${o.base}/docs/manual/${man.manualId}${page ? `?sec=${encodeURIComponent(page.ref)}` : ""}">${inner}</a>`;
      return `<a href="${o.base}/docs/link/wm/${wmId}/${pageId}">${inner}</a>`;
    }
    if (/^https?:\/\/[a-z0-9.-]*webmanuals\.aero/i.test(href)) return `<a href="${o.base}/docs/lib">${inner}</a>`;
    if (/^https?:\/\//i.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${inner}</a>`; // genuine web address
    const h = o.textTarget?.(inner) ?? null; // any other relative link from the source system
    return h ? `<a href="${h}"${nav}>${inner}</a>` : inner;
  });
}
