import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Regulation } from "@/lib/regulation";

/* REG-03 · Articles of an EAR, from the EASA XML export (a zip holding one Word flat-XML file).
 * Headings: Heading<n>IR = rule, Heading<n>AMC / GM / CS = material; "Dxshortdesc" under the heading = source; ListLevel<k> = indent. */

export type Item = { ref: string; kind: "ir" | "amc" | "gm" | "cs" | "other"; code: string; title: string | null; source: string | null; annex: string | null; section: string | null; body: { l: number; t: string }[]; ord: number };
export type RegItem = Item & { id: string; regulation_id: string; version: string; body_text: string | null; hash: string; change: string | null };

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** The document.xml part out of the zip. */
export function unzipDocument(zip: Buffer): string {
  // end of central directory → first central header → local header → deflate slice
  let i = zip.length - 22;
  while (i > 0 && !(zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 5 && zip[i + 3] === 6)) i--;
  if (i <= 0) throw new Error("Not a zip file");
  const cd = zip.readUInt32LE(i + 16);
  const method = zip.readUInt16LE(cd + 10), csize = zip.readUInt32LE(cd + 20), lho = zip.readUInt32LE(cd + 42);
  const nl = zip.readUInt16LE(lho + 26), el = zip.readUInt16LE(lho + 28);
  const start = lho + 30 + nl + el;
  const raw = method === 8 ? inflateRawSync(zip.subarray(start, start + csize)) : zip.subarray(start, start + csize);
  const s = raw.toString("utf8");
  const a = s.indexOf('<pkg:part pkg:name="/word/document.xml"');
  if (a < 0) throw new Error("No word/document.xml in the export");
  return s.slice(a, s.indexOf("</pkg:part>", a));
}

/** The version label in the export, when present (docProps title / cover). */
export function parseItems(doc: string): Item[] {
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const items: Item[] = [];
  let cur: Item | null = null, annex: string | null = null, section: string | null = null, ord = 0, m: RegExpExecArray | null, inToc = false;
  const push = () => { if (cur) { items.push(cur); cur = null; } };
  while ((m = re.exec(doc))) {
    const p = m[0];
    const style = (p.match(/w:pStyle w:val="([^"]+)"/) || [])[1] ?? "";
    const text = decodeXml([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((z) => z[1]).join("")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (style === "Heading1") { push(); inToc = /table of contents/i.test(text); annex = /^ANNEX|^Cover regulation|^Part-|^Subpart/i.test(text) ? text : annex; section = null; continue; }
    if (inToc || /^TOC\d/.test(style)) continue;
    if (/^Heading[23]$/.test(style)) { push(); section = text; continue; }
    // cover-regulation / Basic Regulation articles: "Article 5 – Scope" under Heading…CR or a plain Heading4/5
    const art = /^Heading\d(CR)?$/.test(style) && text.match(/^(Article \d+[a-z]?)\s*[–—-]?\s*(.*)$/);
    if (art) { push(); cur = { ref: art[1], kind: "ir", code: art[1], title: art[2] || null, source: null, annex, section, body: [], ord: ord++ }; continue; }
    const h = style.match(/^Heading\d(IR|AMC|GM|CS|GMtoAMC)$/);
    if (h) {
      push();
      const kind = h[1] === "IR" ? "ir" : h[1] === "CS" ? "cs" : h[1].startsWith("GM") ? "gm" : "amc";
      // "AMC1 ORO.GEN.200(a)(1);(2) Management system" → ref = "AMC1 ORO.GEN.200(a)(1);(2)", code = "ORO.GEN.200", title = "Management system"
      const mm = text.match(/^((?:(?:AMC|GM|CS)\d*(?: to )?(?:AMC\d*)?\s+)?([A-Z]{2,4}(?:\.[A-Z0-9-]+)+(?:\([a-z0-9]+\))*(?:[;,&]\s*\([a-z0-9]+\)(?:\([a-z0-9]+\))*)*)(?:\s*(?:,|and|&)\s*[A-Z]{2,4}(?:\.[A-Z0-9-]+)+(?:\([a-z0-9]+\))*)*)\s*(.*)$/);
      const ref = mm ? mm[1].trim() : text.slice(0, 120);
      const code = mm ? mm[2].replace(/\(.*$/, "") : text.split(" ")[0];
      cur = { ref, kind, code, title: mm && mm[3] ? mm[3].trim() || null : null, source: null, annex, section, body: [], ord: ord++ };
      continue;
    }
    if (!cur) continue;
    if (style === "Dxshortdesc") { if (!cur.source && !cur.body.length) cur.source = text; else cur.body.push({ l: -2, t: text }); continue; }
    const lvl = style.match(/^(?:ListLevel|bullet|Normal)(\d)$/);
    const l = /^Heading\d(OrgManual)?$|^Formaltitle$|^TableHead$/.test(style) ? -1 : lvl ? Number(lvl[1]) : 0;
    cur.body.push({ l, t: text });
  }
  push();
  return items;
}

export const itemHash = (it: Pick<Item, "title" | "body">) => createHash("sha1").update((it.title ?? "") + "\n" + it.body.map((b) => `${b.l}|${b.t}`).join("\n")).digest("hex");

/** Download the XML export of an EAR, parse it, store the articles under the regulation's current version; diff against the previous loaded version. */
export async function loadItems(db: SupabaseClient, r: Regulation & { items_version?: string | null }, by: string | null): Promise<{ count: number; version: string; new: number; modified: number; removed: number }> {
  if (!r.xml_url) throw new Error("No XML export for this text.");
  const version = r.current_version ?? "unknown";
  const res = await fetch(r.xml_url, { headers: { "user-agent": "Mozilla/5.0 (compatible; S.A.M. regulatory watch; Clair Group)" }, cache: "no-store", signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`EASA download HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const items = parseItems(unzipDocument(zip));
  if (items.length < 20) throw new Error(`Only ${items.length} articles found — export layout changed?`);
  // previous version for the diff
  const prevVersion = r.items_version && r.items_version !== version ? r.items_version : null;
  const prev = new Map<string, string>();
  if (prevVersion) {
    const { data } = await db.from("regulation_items").select("ref,hash").eq("regulation_id", r.id).eq("version", prevVersion).limit(20000);
    for (const x of (data ?? []) as { ref: string; hash: string }[]) prev.set(x.ref, x.hash);
  }
  await db.from("regulation_items").delete().eq("regulation_id", r.id).eq("version", version);
  let nNew = 0, nMod = 0;
  const seen = new Set<string>();
  const rows = items.filter((it) => { if (seen.has(it.ref)) return false; seen.add(it.ref); return true; }).map((it) => {
    const hash = itemHash(it);
    const change = !prevVersion ? null : !prev.has(it.ref) ? (nNew++, "new") : prev.get(it.ref) !== hash ? (nMod++, "modified") : "unchanged";
    return { regulation_id: r.id, version, ref: it.ref, kind: it.kind, code: it.code, title: it.title, source: it.source, annex: it.annex, section: it.section, body: it.body, body_text: it.body.map((b) => b.t).join("\n").slice(0, 20000), hash, ord: it.ord, change };
  });
  for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from("regulation_items").insert(rows.slice(i, i + 200)); if (error) throw new Error(error.message); }
  let removed = 0;
  if (prevVersion) {
    const gone = [...prev.keys()].filter((ref) => !seen.has(ref));
    removed = gone.length;
    if (gone.length) await db.from("regulation_items").insert(gone.map((ref, i) => ({ regulation_id: r.id, version, ref, kind: "other", code: ref.replace(/^(AMC|GM|CS)\d*\s+/, "").replace(/\(.*$/, ""), title: null, body: [], body_text: null, hash: "", ord: 100000 + i, change: "removed" })));
  }
  if (prevVersion && (nNew || nMod || removed)) { const { flagChangedItems } = await import("@/lib/audit-run"); await flagChangedItems(db, r.id, version); }
  await db.from("regulations").update({ items_version: version, items_count: rows.length, items_loaded_at: new Date().toISOString(), items_note: prevVersion ? `vs ${prevVersion}: ${nNew} new · ${nMod} modified · ${removed} removed` : null }).eq("id", r.id);
  await db.from("audit_log").insert({ actor: by, entity: r.entities[0] ?? null, object_type: "regulation", object_id: r.id, action: "regulation_items_loaded", after: { version, count: rows.length, new: nNew, modified: nMod, removed } });
  return { count: rows.length, version, new: nNew, modified: nMod, removed };
}

/** The current text of a rule and its AMC / GM, for the audit screen. */
export async function itemsForCode(db: SupabaseClient, regulationId: string, version: string, code: string): Promise<RegItem[]> {
  const { data } = await db.from("regulation_items").select("*").eq("regulation_id", regulationId).eq("version", version).eq("code", code).or("change.is.null,change.neq.removed").order("ord");
  return (data ?? []) as RegItem[];
}

/** EASA rule codes found in a text (ORO.GEN.200, CAO.A.095, CAMO.A.305, M.A.201, 145.A.30, FCL.055, ML.A.403, IS.I.OR.200, 21.A.3…). */
export function ruleCodesIn(text: string): string[] {
  const re = /\b((?:ORO|ORA|CAT|SPA|NCC|NCO|SPO|ARO|ARA|FCL|MED|CC|ATCO|ADR|SERA|CAO|CAMO|ML|CS|IS)(?:\.[A-Z]{1,4})*\.\d{2,4}[A-Z]?|(?:M|T|145|147|66|21)\.[AB]\.\d{2,4}[A-Z]?|IS\.[ID]\.OR\.\d{3})\b/g;
  return [...new Set((text.match(re) ?? []).map((c) => c.toUpperCase()))].slice(0, 12);
}

/** FB-050 · official text (IR + AMC/GM) of the rules cited, across the EARs of an entity, as a compact block for the assistant. */
export async function officialTextsFor(db: SupabaseClient, entity: string, codes: string[], maxChars = 24000): Promise<string> {
  if (!codes.length) return "";
  const { data: regs } = await db.from("regulations").select("id,key,title,items_version").contains("entities", [entity]).not("items_version", "is", null);
  const out: string[] = []; let used = 0;
  for (const r of (regs ?? []) as { id: string; key: string; title: string; items_version: string }[]) {
    const { data } = await db.from("regulation_items").select("ref,kind,code,title,body_text").eq("regulation_id", r.id).eq("version", r.items_version).in("code", codes).or("change.is.null,change.neq.removed").order("ord").limit(60);
    for (const it of (data ?? []) as { ref: string; kind: string; code: string; title: string | null; body_text: string | null }[]) {
      const block = `[${r.title} · ${r.items_version}] ${it.ref}${it.title ? ", " + it.title : ""}\n${(it.body_text ?? "").slice(0, it.kind === "ir" ? 4000 : 1500)}`;
      if (used + block.length > maxChars) return out.join("\n\n");
      out.push(block); used += block.length;
    }
  }
  return out.join("\n\n");
}

/** 10/11 · the rules cited by a finding (its « requirement » field), found in the EARs of the entity: per code, the text and where to read it in full. */
export async function rulesCited(db: SupabaseClient, entity: string, text: string | null): Promise<{ code: string; reg: { key: string; title: string; version: string; online_url: string | null } | null; items: RegItem[] }[]> {
  const codes = ruleCodesIn(text ?? ""); if (!codes.length) return [];
  const { data: regs } = await db.from("regulations").select("id,key,title,items_version,online_url").contains("entities", [entity]).not("items_version", "is", null);
  const rs = (regs ?? []) as { id: string; key: string; title: string; items_version: string; online_url: string | null }[];
  const out: { code: string; reg: { key: string; title: string; version: string; online_url: string | null } | null; items: RegItem[] }[] = [];
  for (const code of codes) {
    let hit: (typeof out)[number] = { code, reg: null, items: [] };
    for (const r of rs) {
      const { data } = await db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", r.items_version).eq("code", code).or("change.is.null,change.neq.removed").order("ord").limit(40);
      if (data?.length) { hit = { code, reg: { key: r.key, title: r.title, version: r.items_version, online_url: r.online_url }, items: data as RegItem[] }; break; }
    }
    out.push(hit);
  }
  return out;
}
