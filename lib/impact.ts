import type { SupabaseClient } from "@supabase/supabase-js";
import { KNOWN_TEXTS } from "@/lib/regulation";
import { CERT_BY_KEY } from "@/lib/impact-keys";
import { ruleCodesIn } from "@/lib/regulation-items";
import { findCitations, type Citation, type Entry } from "@/lib/watch";

/* REG-08 (26/11, Guillaume) · when a text or a page of the watch changes: which manuals (and so which NP) and which certificates are
 * concerned, what changed (before / after, from the EAR articles when they are loaded) and Claude's reading of the impact.
 * Replaces « Texts cited in our manuals ». S.A.M. signals; Compliance decides. Never throws. */

export type ImpactManual = { id: string; code: string; title: string; owner_role: string; sections: { ref: string; title: string | null; snippet: string; via: string }[] };
export type ImpactCert = { id: string; title: string; kind: string; reference: string | null; registration: string | null; folder: string | null; valid_until: string | null; why: string };
export type ImpactChange = { ref: string; change: string; title: string | null; before: string | null; after: string | null; cited_in: string[] };
export type Impact = {
  at: string; model: string; texts: string[]; codes: string[];
  manuals: ImpactManual[]; certificates: ImpactCert[];
  changes: ImpactChange[]; changes_note: string | null;
  analysis: { summary: string; changes: { ref: string; before: string; after: string; impact: string }[]; manuals: { code: string; ref: string; why: string; action: string }[]; certificates: { title: string; why: string; action: string }[]; notify: string[] } | null;
};

/** aircraft type tokens, as written in titles and in the certificate folders ("Aircraft › C510 9H-XXX") */
const TYPE_RE = /\b(C510|C525[AB]?|C560XL|C68A|C680|C700|C750|FA7X|F7X|FA8X|F900|F2TH|GL7T|G7500|GLEX|GL5T|CL60|C172|DA42|DA40|AL250|PC-?12|PC-?24|TBM ?9\d0|E55P|Phenom ?300|CAP ?10[BC]?)\b/gi;
const normType = (t: string) => t.toUpperCase().replace(/\s+/g, "").replace(/^PC(\d)/, "PC-$1").replace(/^F7X$/, "FA7X");

const clip = (t: string | null | undefined, n: number) => { const s = (t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

/** text of a public HTML page (for Claude's reading of a publication), or null */
async function pageText(url: string | null): Promise<string | null> {
  if (!url || /\.pdf($|\?)/i.test(url)) return null;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 S.A.M.-watch", accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) return null;
    const html = await r.text();
    const body = (html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html).replace(/<(script|style|noscript|svg|header|nav|footer|form)[\s\S]*?<\/\1>/gi, " ");
    return clip(body.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&"), 9000) || null;
  } catch { return null; }
}

export async function impactFor(db: SupabaseClient, e: Entry): Promise<Impact> {
  const regId = (e as Entry & { regulation_id?: string | null }).regulation_id ?? null;
  const hay = `${e.title} ${e.reference ?? ""}`;
  const { data: reg } = regId ? await db.from("regulations").select("id,key,title,short,number,current_version,items_version").eq("id", regId).maybeSingle() : { data: null };
  const R = reg as { id: string; key: string; title: string; short: string; number: string | null; current_version: string | null; items_version: string | null } | null;
  // what the entry is about: the texts it names, its reference, the rule codes it cites
  const known = KNOWN_TEXTS.filter((k) => hay.toLowerCase().includes(k.pattern.toLowerCase()) || (R && k.key === R.key));
  const refs = (e.reference ?? "").split(/[,;]| and /).map((x) => x.trim()).filter((x) => x.length >= 4);
  const codes = ruleCodesIn(hay);
  const texts = [...new Set([...known.map((k) => k.label), ...(R ? [R.title] : [])])];

  // before / after: the articles of the EAR that changed in the version this entry is about
  let changes: ImpactChange[] = []; let changesNote: string | null = null;
  if (R) {
    if (!R.items_version) changesNote = `The articles of ${R.short} are not loaded in S.A.M. yet: load them in Regulation to see what changed article by article.`;
    else if (R.current_version && R.items_version !== R.current_version) changesNote = `The articles loaded are those of ${R.items_version}, not of ${R.current_version}: load the new version in Regulation to compare.`;
    else {
      const { data: ch } = await db.from("regulation_items").select("ref,code,title,change,body_text").eq("regulation_id", R.id).eq("version", R.items_version).in("change", ["new", "modified", "removed"]).order("ord").limit(400);
      const rows = (ch ?? []) as { ref: string; code: string; title: string | null; change: string; body_text: string | null }[];
      const { data: vs } = await db.from("regulation_versions").select("version,seen_on").eq("regulation_id", R.id).order("seen_on", { ascending: false }).limit(5);
      const prev = ((vs ?? []) as { version: string }[]).map((v) => v.version).find((v) => v !== R.items_version) ?? null;
      const { data: old } = prev && rows.length ? await db.from("regulation_items").select("ref,body_text").eq("regulation_id", R.id).eq("version", prev).in("ref", rows.slice(0, 200).map((r) => r.ref)) : { data: [] };
      const before = new Map(((old ?? []) as { ref: string; body_text: string | null }[]).map((o) => [o.ref, o.body_text]));
      changes = rows.map((r) => ({ ref: r.ref, change: r.change, title: r.title, before: clip(before.get(r.ref) ?? null, 1200) || null, after: r.change === "removed" ? null : clip(r.body_text, 1200) || null, cited_in: [] }));
      if (!rows.length) changesNote = "No article changed between the two loaded versions (wording of the consolidation only).";
      if (rows.length && !prev) changesNote = "The previous version's articles are not in S.A.M.: the new text is shown without the former one.";
    }
  }

  // manuals: chapters citing the reference, the texts named, the rule codes (and the changed rules of the EAR)
  const needles: [string, string][] = [...refs.map((r) => [r, "reference"] as [string, string]), ...known.map((k) => [k.pattern, k.label] as [string, string]), ...codes.map((c) => [c, "rule cited"] as [string, string])];
  const changedCodes = [...new Set(changes.map((c) => c.ref.replace(/^(AMC|GM|CS)\d*\s+/, "").replace(/\(.*$/, "").trim()))].slice(0, 40);
  for (const c of changedCodes) needles.push([c, "changed rule"]);
  const hits: (Citation & { via: string })[] = [];
  for (const [n, via] of needles.slice(0, 50)) for (const c of await findCitations(db, e.entity, n)) hits.push({ ...c, via: `${via}: ${n}` });
  for (const ch of changes) { const code = ch.ref.replace(/^(AMC|GM|CS)\d*\s+/, "").replace(/\(.*$/, "").trim(); ch.cited_in = [...new Set(hits.filter((h) => h.via.endsWith(`: ${code}`)).map((h) => `${h.code} ${h.ref}`))].slice(0, 6); }
  const { data: mans } = await db.from("manuals").select("id,code,title,owner_role").eq("entity", e.entity);
  const byId = new Map(((mans ?? []) as { id: string; code: string; title: string; owner_role: string }[]).map((m) => [m.id, m]));
  const manuals = new Map<string, ImpactManual>();
  for (const h of hits) {
    const m = byId.get(h.manual_id); if (!m) continue;
    const x = manuals.get(m.id) ?? { ...m, sections: [] };
    if (!x.sections.some((s) => s.ref === h.ref)) x.sections.push({ ref: h.ref, title: h.section_title, snippet: clip(h.snippet, 260), via: h.via });
    manuals.set(m.id, x);
  }

  // certificates: those the text bears on (by the regulation, the type of aircraft, or a direct mention)
  const { data: cd } = await db.from("certificates").select("id,title,kind,reference,registration,folder,valid_until,summary,scope").eq("entity", e.entity).is("archived_at", null).limit(600);
  const certs = (cd ?? []) as (Omit<ImpactCert, "why"> & { summary: string | null; scope: string })[];
  const types = [...new Set([...hay.matchAll(TYPE_RE)].map((m) => normType(m[1])))];
  const keyRe = [R?.key, ...known.map((k) => k.key)].filter(Boolean).map((k) => CERT_BY_KEY[k!]).filter(Boolean) as RegExp[];
  const certificates: ImpactCert[] = [];
  for (const c of certs) {
    const text = `${c.title} ${c.kind} ${c.reference ?? ""} ${c.folder ?? ""} ${c.summary ?? ""}`;
    const t = [...text.matchAll(TYPE_RE)].map((m) => normType(m[1]));
    const why = refs.find((r) => text.toLowerCase().includes(r.toLowerCase())) ? "mentions the reference"
      : types.length && t.some((x) => types.includes(x)) ? `aircraft type ${t.find((x) => types.includes(x))}`
      : keyRe.some((re) => re.test(text)) ? `granted under ${texts[0] ?? "this text"}` : null;
    if (why) certificates.push({ id: c.id, title: c.title, kind: c.kind, reference: c.reference, registration: c.registration, folder: c.folder, valid_until: c.valid_until, why });
  }

  const out: Impact = { at: new Date().toISOString(), model: "rules", texts, codes, manuals: [...manuals.values()].sort((a, b) => b.sections.length - a.sections.length), certificates: certificates.slice(0, 40), changes: changes.slice(0, 120), changes_note: changesNote, analysis: null };
  if (!process.env.ANTHROPIC_API_KEY) return out;
  try {
    const { callClaude } = await import("@/lib/ai");
    const page = changes.length ? null : await pageText(e.url);
    const user = [
      `ENTITY ${e.entity}. WATCH ENTRY ${e.number}: ${e.title}`,
      `Reference: ${e.reference ?? "—"} · source: ${e.source_kind ?? "—"} · link: ${e.url ?? "—"} · published ${e.published_on ?? "—"} · applicable ${e.applicable_on ?? "—"}`,
      texts.length ? `Texts concerned: ${texts.join("; ")}` : "",
      changes.length ? `ARTICLES CHANGED (${changes.length}${changes.length > 25 ? ", first 25" : ""}):\n` + changes.slice(0, 25).map((c) => `- ${c.ref} [${c.change}]${c.cited_in.length ? ` (cited in ${c.cited_in.join(", ")})` : ""}\n  BEFORE: ${clip(c.before, 600) || "—"}\n  AFTER: ${clip(c.after, 600) || "—"}`).join("\n") : changesNote ?? "",
      page ? `PAGE OF THE PUBLICATION (extract):\n${page}` : "",
      out.manuals.length ? `OUR MANUALS CITING IT:\n` + out.manuals.slice(0, 12).map((m) => `- ${m.code} (owner ${m.owner_role}): ` + m.sections.slice(0, 5).map((s) => `${s.ref} "${s.snippet}"`).join(" | ")).join("\n") : "No chapter of our published manuals cites it.",
      out.certificates.length ? `OUR CERTIFICATES POSSIBLY CONCERNED:\n` + out.certificates.slice(0, 20).map((c) => `- ${c.title} (${c.kind}${c.reference ? `, ${c.reference}` : ""}${c.registration ? `, ${c.registration}` : ""}${c.valid_until ? `, valid until ${c.valid_until}` : ""}): ${c.why}`).join("\n") : "No certificate found that it bears on.",
    ].filter(Boolean).join("\n\n");
    const { text, model } = await callClaude({ agent: "check", personId: null, entity: e.entity, system: SYSTEM, user, maxTokens: 2500 });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) return out;
    const j = JSON.parse(m[0]) as NonNullable<Impact["analysis"]>;
    const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    out.analysis = { summary: String(j.summary ?? "").slice(0, 900), changes: arr<{ ref: string; before: string; after: string; impact: string }>(j.changes).slice(0, 15), manuals: arr<{ code: string; ref: string; why: string; action: string }>(j.manuals).slice(0, 20), certificates: arr<{ title: string; why: string; action: string }>(j.certificates).slice(0, 15), notify: arr<string>(j.notify).map(String).slice(0, 8) };
    out.model = model;
  } catch { /* the facts above stand without the reading */ }
  return out;
}

const SYSTEM = `You assist the Compliance Monitoring Manager of an EASA operator group (AOC, CAMO, ATO, FSTD; authorities TM-CAD Malta, DSAC France, OSAC). A text or page followed by the regulatory watch has changed. You are given what changed (articles before / after when available, otherwise an extract of the publication), the chapters of the organisation's published manuals that cite it (with the post owning each manual) and the certificates / approvals it may bear on.
Say, in neutral professional English, what changes and what it means for this organisation. You signal; a human decides.
Answer ONLY with JSON: {"summary":"3 sentences max: what changed, for whom, by when","changes":[{"ref":"article","before":"one line","after":"one line","impact":"one line, for us"}],"manuals":[{"code":"manual code","ref":"section","why":"one sentence","action":"amend | check | none"}],"certificates":[{"title":"certificate as given","why":"one sentence","action":"variation to apply for | check the scope | none"}],"notify":["posts to warn, e.g. NPFO, NPCA, CMM, SM, HT"]}
Keep only manuals, sections and certificates really concerned, from those given. Never invent an article or a requirement.`;
