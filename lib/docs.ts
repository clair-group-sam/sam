import { supabaseServer } from "@/lib/supabase-server";
import type { Session } from "@/lib/session";

export type Manual = { id: string; entity: string; code: string; title: string; owner_role: string; needs_signature: boolean; to_tmcad_repository: boolean; path: string | null };
export type Revision = { id: string; manual_id: string; issue: number; rev: string; step: string; authority_route: string | null; authority_ref: string | null; summary: string | null; published_at: string | null; created_at: string };
export type Section = { id: string; ord: number; ref: string; title: string | null; body: { html?: string; text?: string; pages?: string[]; headings?: Heading[]; structured?: boolean }; changed: boolean };
export type Certificate = { id: string; entity: string; scope: string; registration: string | null; kind: string; title: string; issuer: string | null; valid_until: string | null; file_path: string | null };

export const STEP_LABEL: Record<string, string> = {
  draft: "Draft", approved_np: "Approved by NP", approved_compliance: "Approved by Compliance", signed: "Signed",
  with_civil_aviation: "With civil aviation", published: "Published", repository: "Repository",
};
export const STEPS = ["draft", "approved_np", "approved_compliance", "signed", "with_civil_aviation", "published", "repository"];

export function entityFilter<T extends { eq: (c: string, v: string) => T }>(q: T, s: Session, col = "entity"): T {
  return s.entity === "ALL" ? q : q.eq(col, s.entity);
}

/** Manuals in scope with their current (latest published) and working (unpublished) revisions. */
export async function listManuals(s: Session): Promise<{ manual: Manual; current: Revision | null; working: Revision | null; workings: Revision[] }[]> {
  const sb = await supabaseServer();
  let mq = sb.from("manuals").select("*").order("path").order("code");
  if (s.entity !== "ALL") mq = mq.eq("entity", s.entity);
  const { data: manuals } = await mq;
  const ids = (manuals ?? []).map((m: Manual) => m.id);
  if (!ids.length) return [];
  const { data: revs } = await sb.from("revisions").select("*").in("manual_id", ids).order("published_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false });
  const byManual = new Map<string, Revision[]>();
  for (const r of (revs ?? []) as Revision[]) { const a = byManual.get(r.manual_id) ?? []; a.push(r); byManual.set(r.manual_id, a); }
  return (manuals as Manual[]).map((manual) => {
    const rs = byManual.get(manual.id) ?? [];
    const current = rs.filter((r) => r.step === "published" || r.step === "repository").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0] ?? null;
    const workings = rs.filter((r) => r.step !== "published" && r.step !== "repository").sort((a, b) => STEPS.indexOf(b.step) - STEPS.indexOf(a.step));
    const working = workings[0] ?? null;
    return { manual, current, working, workings };
  });
}

export function folderOf(m: Manual): string {
  return (m.path ?? "Unfiled").split(" › ")[0];
}
export function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - Date.now()) / 86400000);
}

/* ---------- reading structure ---------- */
export type Heading = { level: number; text: string; id: string };
export type Part = { key: string; label: string; color: string };
const PART_COLORS = ["#7d166d", "#0e8cc4", "#248a3d", "#b86e00", "#b43a0f", "#0d2a3f", "#6b5bd2", "#006c9c"];
export function partOf(ref: string): string {
  const m = /^([A-Za-z]+|\d+)/.exec(ref);
  return m ? m[1].toUpperCase() : "?";
}
export function partsOf(refs: string[]): Part[] {
  const keys: string[] = [];
  for (const r of refs) { const k = partOf(r); if (!keys.includes(k)) keys.push(k); }
  return keys.map((key, i) => ({ key, label: /^\d+$/.test(key) ? (key === "0" ? "Preliminary pages" : `Chapter ${key}`) : `Part ${key}`, color: PART_COLORS[i % PART_COLORS.length] }));
}
/** Adds ids to h2/h3 headings and returns them for the sub-table of contents. */
const ENT_MAP: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", deg: "°", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", ccedil: "ç", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", oelig: "œ", sup2: "²", sup3: "³", middot: "·", bull: "•", times: "×", euro: "€", copy: "©", reg: "®" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") { const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return ENT_MAP[e] ?? m;
  });
}
export function structureHtml(html: string, prefix: string, chapterRef?: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  let i = 0; let first = true;
  const out = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, attrs: string, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) return _m;
    // the chapter title itself is shown in the chapter header: do not repeat it
    if (first && chapterRef && text.replace(/\s+/g, "").toLowerCase().startsWith(chapterRef.replace(/\s+/g, "").toLowerCase())) { first = false; return ""; }
    first = false;
    const id = `${prefix}-${++i}`;
    headings.push({ level: Number(lvl), text, id });
    return `<h${lvl}${attrs} id="${id}">${inner}</h${lvl}>`;
  });
  return { html: out, headings };
}
export function stripHtml(h: string): string {
  return h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Turns chapter / sub-chapter references inside the manual's own table of contents into links. */
export function linkRefs(html: string, chapters: Map<string, string>, subs: Map<string, { ref: string; id: string }>, base: string): string {
  return html.replace(/<td>\s*([A-Z]{0,2}\d*(?:\.\d+){0,3})\s*<\/td>\s*<td>([\s\S]*?)<\/td>/g, (m, ref: string, title: string) => {
    const key = ref.trim();
    let href: string | null = null;
    if (chapters.has(key)) href = `${base}&sec=${encodeURIComponent(key)}`;
    else if (subs.has(key)) { const s = subs.get(key)!; href = `${base}&sec=${encodeURIComponent(s.ref)}#${s.id}`; }
    if (!href) return m;
    return `<td><a class="ref" data-nav href="${href}">${key}</a></td><td><a class="ref" data-nav href="${href}">${title}</a></td>`;
  });
}
