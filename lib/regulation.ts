import type { SupabaseClient } from "@supabase/supabase-js";
import { nextEntryNumber, syncEntryTask, type Entry, type Topic } from "@/lib/watch";
import { today } from "@/lib/authority";

/* REG-02 · Regulation (03/11): the Easy Access Rules we use, always the latest version, linked to the regulatory watch.
 * The EASA page title carries the revision ("Easy Access Rules for Air Operations - Revision 24, March 2026 — Available in PDF…");
 * a new one becomes the current version and raises a watch entry "to analyse" per entity concerned. */

export type Regulation = { id: string; key: string; kind: string; title: string; short: string; number: string | null; page_url: string; pdf_url: string | null; online_url: string | null; xml_url: string | null;
  entities: string[]; domains: string[]; current_version: string | null; version_since: string | null; checked_at: string | null; check_result: string | null; check_note: string | null; sort: number; active: boolean };
export type RegVersion = { id: string; regulation_id: string; version: string; seen_on: string; pdf_url: string | null; online_url: string | null; xml_url: string | null; watch_entry_ids: string[]; recorded_by: string | null };

const UA = "Mozilla/5.0 (compatible; S.A.M. regulatory watch; Clair Group)";
const abs = (h: string) => (h.startsWith("http") ? h : `https://www.easa.europa.eu${h.startsWith("/") ? "" : "/"}${h}`);
const decode = (t: string) => t.replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Version and links from an EASA EAR page. */
export function parseEarPage(html: string): { version: string | null; pdf: string | null; online: string | null; xml: string | null; title: string | null } {
  const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "") || null;
  // "… - Revision 24, March 2026 — Available …", "… - Revision from October 2026 — Available …", "… - Initial issue …"
  const m = title?.match(/\s[-–—]\s*((?:Revision|Initial issue|Issue|Amendment)[^—|]*?)\s*(?:[-–—]\s*Available|\||$)/i);
  const version = m ? m[1].replace(/[,\s]+$/, "") : null;
  const link = (label: string) => { const r = new RegExp(`<a[^>]+href="([^"]+)"[^>]*>(?:(?!</a>).)*?\\(${label}\\)`, "is"); const h = html.match(r)?.[1]; return h ? abs(decode(h)) : null; };
  return { version, pdf: link("PDF"), online: link("Online"), xml: link("XML"), title };
}

/** The watch stream an EASA revision goes to for an entity: compliance by default, ATO & FSTD for Astonfly crew / FSTD texts. */
async function topicFor(db: SupabaseClient, entity: string, r: Regulation): Promise<Topic | null> {
  const { data } = await db.from("watch_topics").select("*").eq("active", true).contains("entities", [entity]);
  const ts = (data ?? []) as Topic[];
  const want = entity === "ASFFR" && ["aircrew", "aeroplane-fstd"].includes(r.key) ? "ato_fstd" : "compliance";
  return ts.find((t) => t.domain === want) ?? ts.find((t) => t.domain === "compliance") ?? ts[0] ?? null;
}

/** A new version: record it, make it current, raise one watch entry per entity (to analyse), tasks to the stream owner. */
export async function recordVersion(db: SupabaseClient, r: Regulation, v: { version: string; pdf?: string | null; online?: string | null; xml?: string | null }, by: string | null): Promise<{ entries: string[] }> {
  const first = !r.current_version;
  const entries: string[] = [];
  if (!first) for (const entity of r.entities) {
    const t = await topicFor(db, entity, r);
    const row = { number: await nextEntryNumber(db, entity), entity, topic_id: t?.id ?? null, source_kind: r.kind === "ear" ? "easa" : "misc", domain: t?.domain ?? "compliance",
      title: `${r.title}, ${v.version}`.slice(0, 300), reference: r.number, url: r.page_url, published_on: today(), applicability: "to_analyse", owner_role: t?.owner_role ?? "CMM", owner_person: t?.owner_person ?? null, status: "open", regulation_id: r.id, created_by: by,
      impact: `New version of the ${r.short} Easy Access Rules (previous: ${r.current_version}). See what changed and the manuals concerned.` };
    const { data } = await db.from("watch_entries").insert(row).select("*").single();
    if (data) { entries.push((data as Entry).id); await syncEntryTask(db, data as Entry); }
  }
  await db.from("regulation_versions").upsert({ regulation_id: r.id, version: v.version, pdf_url: v.pdf ?? r.pdf_url, online_url: v.online ?? r.online_url, xml_url: v.xml ?? r.xml_url, watch_entry_ids: entries, recorded_by: by }, { onConflict: "regulation_id,version" });
  await db.from("regulations").update({ current_version: v.version, version_since: today(), pdf_url: v.pdf ?? r.pdf_url, online_url: v.online ?? r.online_url, xml_url: v.xml ?? r.xml_url, check_result: first ? "ok" : "changed" }).eq("id", r.id);
  return { entries };
}

/** Read the EASA page of one EAR; record a new version when the revision changed. Never throws. */
export async function checkRegulation(db: SupabaseClient, r: Regulation): Promise<{ key: string; result: string; version: string | null; note?: string; entries?: number }> {
  const at = new Date().toISOString();
  if (r.kind !== "ear") { await db.from("regulations").update({ checked_at: at, check_result: "manual", check_note: "Not an EASA EAR page: new versions are recorded by hand." }).eq("id", r.id); return { key: r.key, result: "manual", version: r.current_version }; }
  try {
    const res = await fetch(r.page_url, { headers: { "user-agent": UA, accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const p = parseEarPage(await res.text());
    if (!p.version) throw new Error(`No revision in the page title (${(p.title ?? "no title").slice(0, 120)})`);
    if (p.version === r.current_version) {
      await db.from("regulations").update({ checked_at: at, check_result: "ok", check_note: null, pdf_url: p.pdf ?? r.pdf_url, online_url: p.online ?? r.online_url, xml_url: p.xml ?? r.xml_url }).eq("id", r.id);
      return { key: r.key, result: "ok", version: p.version };
    }
    const { entries } = await recordVersion(db, r, { version: p.version, pdf: p.pdf, online: p.online, xml: p.xml }, null);
    await db.from("regulations").update({ checked_at: at, check_note: r.current_version ? `${r.current_version} → ${p.version}` : null }).eq("id", r.id);
    return { key: r.key, result: r.current_version ? "changed" : "ok", version: p.version, entries: entries.length };
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    await db.from("regulations").update({ checked_at: at, check_result: "unreachable", check_note: note.slice(0, 300) }).eq("id", r.id);
    return { key: r.key, result: "unreachable", version: r.current_version, note };
  }
}

export async function checkAll(db: SupabaseClient) {
  const { data } = await db.from("regulations").select("*").eq("active", true).order("sort");
  const out = [];
  for (const r of (data ?? []) as Regulation[]) out.push(await checkRegulation(db, r));
  return out;
}

/* ---------- what our manuals cite ---------- */
export const KNOWN_TEXTS: { pattern: string; label: string; key?: string }[] = [
  { pattern: "965/2012", label: "Air Operations (EU) 965/2012", key: "air-operations" },
  { pattern: "1178/2011", label: "Aircrew (EU) 1178/2011", key: "aircrew" },
  { pattern: "CS-FSTD", label: "CS-FSTD", key: "aeroplane-fstd" },
  { pattern: "1321/2014", label: "Continuing Airworthiness (EU) 1321/2014", key: "continuing-airworthiness" },
  { pattern: "2018/1139", label: "Basic Regulation (EU) 2018/1139", key: "basic-regulation" },
  { pattern: "216/2008", label: "Former Basic Regulation (EC) 216/2008", key: "basic-regulation" },
  { pattern: "2022/1645", label: "Part-IS (EU) 2022/1645", key: "information-security" },
  { pattern: "2023/203", label: "Part-IS (EU) 2023/203", key: "information-security" },
  { pattern: "376/2014", label: "Occurrence reporting (EU) 376/2014", key: "occurrence-reporting" },
  { pattern: "2015/1018", label: "Occurrence classification (EU) 2015/1018" },
  { pattern: "923/2012", label: "SERA (EU) 923/2012" },
  { pattern: "748/2012", label: "Initial Airworthiness / Part-21 (EU) 748/2012" },
  { pattern: "452/2014", label: "Third Country Operators (EU) 452/2014" },
  { pattern: "2025/23", label: "Ground handling (EU) 2025/23" },
  { pattern: "139/2014", label: "Aerodromes (EU) 139/2014" },
  { pattern: "2017/373", label: "ATM/ANS (EU) 2017/373" },
  { pattern: "2019/947", label: "Unmanned aircraft (EU) 2019/947" },
  { pattern: "CS-MMEL", label: "CS-MMEL" },
  { pattern: "CS-GEN-MMEL", label: "CS-GEN-MMEL" },
  { pattern: "Doc 9284", label: "ICAO Doc 9284. Technical Instructions (dangerous goods)" },
  { pattern: "1199/2011", label: "(EU) 1199/2011" },
  { pattern: "2021/1296", label: "Fuel / energy planning (EU) 2021/1296" },
];
export type Cited = { pattern: string; label: string; key?: string; count: number; manuals: { entity: string; code: string; sections: number }[] };

/** Texts cited in the current published revision of each manual (scope = entities). */
export async function citedTexts(db: SupabaseClient, entities: string[]): Promise<Cited[]> {
  const { data: mans } = await db.from("manuals").select("id,code,entity").in("entity", entities);
  const ms = (mans ?? []) as { id: string; code: string; entity: string }[];
  if (!ms.length) return [];
  const { data: revs } = await db.from("revisions").select("id,manual_id,published_at").in("manual_id", ms.map((m) => m.id)).in("step", ["published", "repository"]).order("published_at", { ascending: false, nullsFirst: false });
  const cur = new Map<string, string>();
  for (const r of (revs ?? []) as { id: string; manual_id: string }[]) if (!cur.has(r.manual_id)) cur.set(r.manual_id, r.id);
  const byRev = new Map<string, { entity: string; code: string }>();
  for (const m of ms) { const r = cur.get(m.id); if (r) byRev.set(r, { entity: m.entity, code: m.code }); }
  const revIds = [...byRev.keys()];
  if (!revIds.length) return [];
  const out: Cited[] = [];
  for (const k of KNOWN_TEXTS) {
    const { data } = await db.from("revision_sections").select("revision_id").in("revision_id", revIds).ilike("body_text", `%${k.pattern}%`).limit(1000);
    const rows = (data ?? []) as { revision_id: string }[];
    const per = new Map<string, { entity: string; code: string; sections: number }>();
    for (const r of rows) { const m = byRev.get(r.revision_id); if (!m) continue; const x = per.get(r.revision_id) ?? { ...m, sections: 0 }; x.sections++; per.set(r.revision_id, x); }
    out.push({ ...k, count: rows.length, manuals: [...per.values()].sort((a, b) => b.sections - a.sections) });
  }
  return out;
}
