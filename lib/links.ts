import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Links inside manuals. Web Manuals cross-references look like /reader/#/<wmManualId>/p/<wmPageId>.
 * They are resolved against the manuals imported in S.A.M.: same manual → its chapter, another manual → that manual in S.A.M.,
 * unknown → the S.A.M. resolver page (/docs/link/wm/…), which explains why it cannot be opened. Real web addresses stay as they are.
 */
export type LinkIndex = {
  byWm: Map<string, { manualId: string; entity: string; code: string; title: string }>;
  pageRef: Map<string, { manualId: string; ref: string }>; // "<wmManualId>:<wmPageId>"
  refs: Map<string, Set<string>>; // manualId → chapter refs (to find the chapter from the link text)
  uidRef: Map<string, string>; // "<manualId>:<chapter uid>" → current chapter number (links made in S.A.M.)
};

export async function linkIndex(db: SupabaseClient): Promise<LinkIndex> {
  const { data: revs } = await db.from("revisions").select("id,manual_id,step,published_at,wm:source->manualId,manuals(entity,code,title)").in("step", ["published", "repository"]).order("published_at", { ascending: false });
  type R = { id: string; manual_id: string; wm: number | string | null; manuals: { entity: string; code: string; title: string } | null };
  const latest = new Map<string, R>();
  for (const r of (revs ?? []) as unknown as R[]) if (!latest.has(r.manual_id)) latest.set(r.manual_id, r);
  const byWm: LinkIndex["byWm"] = new Map();
  for (const r of latest.values()) if (r.wm) byWm.set(String(r.wm), { manualId: r.manual_id, entity: r.manuals?.entity ?? "", code: r.manuals?.code ?? "", title: r.manuals?.title ?? "" });
  const pageRef: LinkIndex["pageRef"] = new Map();
  const refs: LinkIndex["refs"] = new Map();
  const uidRef: LinkIndex["uidRef"] = new Map();
  const ids = [...latest.values()].map((r) => r.id);
  if (ids.length) {
    const { data: secs } = await db.from("revision_sections").select("revision_id,ref,deleted_at,uid:body->>uid,page_ids:body->page_ids").in("revision_id", ids);
    const wmOf = new Map([...latest.values()].map((r) => [r.id, { wm: String(r.wm), manualId: r.manual_id }]));
    for (const x of (secs ?? []) as { revision_id: string; ref: string; deleted_at: string | null; uid: string | null; page_ids: string[] | null }[]) {
      const w = wmOf.get(x.revision_id); if (!w || x.deleted_at) continue;
      if (x.uid) uidRef.set(`${w.manualId}:${x.uid}`, x.ref);
      if (!refs.has(w.manualId)) refs.set(w.manualId, new Set()); refs.get(w.manualId)!.add(x.ref);
      for (const pid of x.page_ids ?? []) if (pid && !pageRef.has(`${w.wm}:${pid}`)) pageRef.set(`${w.wm}:${pid}`, { manualId: w.manualId, ref: x.ref });
    }
  }
  return { byWm, pageRef, refs, uidRef };
}

const WM = /(?:https?:\/\/[a-z0-9.-]*webmanuals\.aero)?\/reader\/#\/(\d+)\/p\/(\d+)/i;

export function rewriteLinks(html: string, o: {
  idx: LinkIndex | null; selfManualId: string; base: string; // base: "" in the app, the site origin in a PDF
  self: (ref: string | null, inner: string) => string | null; // href for a place in the same manual (anchor in the PDF, ?sec= in the app)
  textTarget?: (inner: string) => string | null; // same-manual target found from the link text (e.g. "A.5.3")
  selfUids?: Map<string, string>; // chapter uid → number in the revision being shown
  newTab?: boolean; // in the app: web addresses in a new tab, links inside the manual handled by the reader (data-nav)
}): string {
  const nav = o.newTab ? " data-nav" : "";
  // innermost anchors only (a link nested in another one is handled on its own)
  return html.replace(/<a\b([^>]*)>((?:(?!<a\b)[\s\S])*?)<\/a>/gi, (all, attrs: string, inner: string) => {
    const href = /href="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    if (/^(mailto|tel):/i.test(href)) return `<a href="${href}">${inner}</a>`;
    const ch = /^(?:https?:\/\/[^/]+)?\/docs\/link\/ch\/([0-9a-f-]{36})\/([0-9a-f-]+)$/i.exec(href);
    if (ch) { // link made in S.A.M. to a chapter (stable id): resolved to its current number
      const [, mid, uid] = ch;
      if (mid === o.selfManualId && o.selfUids?.has(uid)) { const h = o.self(o.selfUids.get(uid)!, inner); if (h) return `<a href="${h}"${nav}>${inner}</a>`; }
      const ref = o.idx?.uidRef.get(`${mid}:${uid}`);
      return ref ? `<a href="${o.base}/docs/manual/${mid}?sec=${encodeURIComponent(ref)}">${inner}</a>` : `<a href="${o.base}${href.replace(/^https?:\/\/[^/]+/, "")}">${inner}</a>`;
    }
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
      if (man) {
        // the chapter: from the page when known, else from a chapter number in the link text (e.g. "MOE 2.3")
        let ref = page?.ref ?? null;
        if (!ref) { const set = o.idx?.refs.get(man.manualId); const txt = inner.replace(/<[^>]+>/g, " "); for (const m of txt.matchAll(/\b([A-Z]{0,2}\d*(?:\.\d+){1,4})\b/g)) { let k = m[1]; while (k && !set?.has(k)) k = k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : ""; if (k) { ref = k; break; } } }
        return `<a href="${o.base}/docs/manual/${man.manualId}${ref ? `?sec=${encodeURIComponent(ref)}` : ""}">${inner}</a>`;
      }
      return `<a href="${o.base}/docs/link/wm/${wmId}/${pageId}">${inner}</a>`;
    }
    if (/^https?:\/\/[a-z0-9.-]*webmanuals\.aero/i.test(href)) return `<a href="${o.base}/docs/lib">${inner}</a>`;
    if (/^https?:\/\//i.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${inner}</a>`; // genuine web address
    const h = o.textTarget?.(inner) ?? null; // any other relative link from the source system
    return h ? `<a href="${h}"${nav}>${inner}</a>` : inner;
  });
}

/** Before publication: links to chapters (made in S.A.M.) whose target no longer exists. */
export async function checkLinks(db: SupabaseClient, revisionId: string, manualId: string): Promise<{ chapter: string; text: string; why: string }[]> {
  const { data } = await db.from("revision_sections").select("ref,deleted_at,uid:body->>uid,html:body->>html").eq("revision_id", revisionId).order("ord");
  const rows = (data ?? []) as { ref: string; deleted_at: string | null; uid: string | null; html: string | null }[];
  const self = new Set(rows.filter((r) => !r.deleted_at && r.uid).map((r) => r.uid!));
  const deletedSelf = new Set(rows.filter((r) => r.deleted_at && r.uid).map((r) => r.uid!));
  let idx: LinkIndex | null = null;
  const out: { chapter: string; text: string; why: string }[] = [];
  for (const r of rows) {
    if (r.deleted_at || !r.html) continue;
    for (const m of r.html.matchAll(/<a\b[^>]*href="[^"]*\/docs\/link\/ch\/([0-9a-f-]{36})\/([0-9a-f-]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const [, mid, uid, inner] = m; const text = inner.replace(/<[^>]+>/g, "").trim().slice(0, 80);
      if (mid === manualId) { if (!self.has(uid)) out.push({ chapter: r.ref, text, why: deletedSelf.has(uid) ? "points to a chapter deleted in this revision" : "points to a chapter that no longer exists" }); continue; }
      idx ??= await linkIndex(db);
      if (!idx.uidRef.has(`${mid}:${uid}`)) out.push({ chapter: r.ref, text, why: "points to a chapter missing from the current revision of the other manual" });
    }
  }
  return out;
}
