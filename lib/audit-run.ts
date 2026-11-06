import type { SupabaseClient } from "@supabase/supabase-js";
import { findCitations, type Citation } from "@/lib/watch";
import type { RegItem } from "@/lib/regulation-items";
import type { Audit } from "@/lib/audit-programme";

/* AUD-02 · Checklists (templates) and the audit run. S.A.M. shows the official text and helps the auditor look; it never decides the result. */

export type Checklist = { id: string; entity: string; code: string; title: string; domain: string | null; regulation_id: string | null; note: string | null; imported_from: string | null; active: boolean; created_at: string; updated_at: string };
export type Section = { id: string; checklist_id: string; ord: number; code: string | null; title: string };
export type ClItem = { id: string; checklist_id: string; section_id: string | null; ord: number; code: string; ref: string | null; regulation_id: string | null; question: string | null; guidance: string | null; review_flag: boolean; review_note: string | null; active: boolean };
export type Check = { id: string; audit_id: string; item_id: string | null; ord: number; section: string | null; code: string; ref: string | null; regulation_id: string | null; version: string | null; question: string | null; guidance: string | null;
  result: string | null; comment: string | null; evidence: { name: string; path: string; size: number; at: string; by: string | null }[]; finding_id: string | null; checked_by: string | null; checked_at: string | null; imported: Record<string, unknown> | null };
export type Hints = { chapters: { manual: string; ref: string; why: string }[]; evidence: string[]; ask: string[]; model: string; at: string };

export const RESULT_LABEL: Record<string, string> = { conforming: "Conforming", partial: "Partially conforming", non_conforming: "Not conforming", not_applicable: "Not applicable", not_covered: "Not covered" };
export const RESULT_TONE: Record<string, string> = { conforming: "green", partial: "amber", non_conforming: "red", not_applicable: "", not_covered: "" };
export const RESULTS = ["conforming", "partial", "non_conforming", "not_applicable", "not_covered"];

export type Breakdown = { total: number; done: number; pct: number } & Record<string, number>;
export function breakdown(checks: Check[]): Breakdown {
  const b: Breakdown = { total: checks.length, done: 0, pct: 0, conforming: 0, partial: 0, non_conforming: 0, not_applicable: 0, not_covered: 0 };
  for (const c of checks) if (c.result) { b.done++; b[c.result] = (b[c.result] ?? 0) + 1; }
  b.pct = b.total ? Math.round((100 * b.done) / b.total) : 0;
  return b;
}

export async function loadChecklist(db: SupabaseClient, id: string) {
  const { data: c } = await db.from("checklists").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  const [{ data: s }, { data: i }] = await Promise.all([
    db.from("checklist_sections").select("*").eq("checklist_id", id).order("ord"),
    db.from("checklist_items").select("*").eq("checklist_id", id).eq("active", true).order("ord").limit(5000),
  ]);
  return { cl: c as Checklist, sections: (s ?? []) as Section[], items: (i ?? []) as ClItem[] };
}

/** Start: the checklist becomes the checks of the audit (snapshot), with the EAR version loaded today. */
export async function instantiateChecks(db: SupabaseClient, audit: Audit & { checklist_id: string | null }): Promise<number> {
  if (!audit.checklist_id) return 0;
  const x = await loadChecklist(db, audit.checklist_id); if (!x) return 0;
  const { data: regs } = await db.from("regulations").select("id,items_version");
  const ver = new Map(((regs ?? []) as { id: string; items_version: string | null }[]).map((r) => [r.id, r.items_version]));
  const secTitle = new Map(x.sections.map((s) => [s.id, s.code ? `${s.code} — ${s.title}` : s.title]));
  const rows = x.items.map((it, i) => ({ audit_id: audit.id, item_id: it.id, ord: i, section: it.section_id ? secTitle.get(it.section_id) ?? null : null, code: it.code, ref: it.ref, regulation_id: it.regulation_id ?? x.cl.regulation_id, version: ver.get(it.regulation_id ?? x.cl.regulation_id ?? "") ?? null, question: it.question, guidance: it.guidance }));
  for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from("audit_checks").insert(rows.slice(i, i + 200)); if (error) throw new Error(error.message); }
  return rows.length;
}

/** Official text for a check: the rule and its AMC / GM in the version shown. */
export async function textFor(db: SupabaseClient, c: Pick<Check, "regulation_id" | "version" | "code">): Promise<RegItem[]> {
  if (!c.regulation_id || !c.version) return [];
  const { data } = await db.from("regulation_items").select("*").eq("regulation_id", c.regulation_id).eq("version", c.version).eq("code", c.code).or("change.is.null,change.neq.removed").order("ord");
  return (data ?? []) as RegItem[];
}

/** Previous results on the same rule for the entity (last 5 audits), and open findings citing it. */
export async function history(db: SupabaseClient, entity: string, code: string, exceptAudit: string) {
  const { data: a } = await db.from("audits").select("id,number,title,done_on,planned_month").eq("entity", entity).neq("id", exceptAudit).in("status", ["closed", "report"]).order("planned_month", { ascending: false }).limit(40);
  const ids = ((a ?? []) as { id: string }[]).map((x) => x.id);
  const { data: c } = ids.length ? await db.from("audit_checks").select("audit_id,result,comment,checked_at").in("audit_id", ids).eq("code", code).not("result", "is", null).order("checked_at", { ascending: false }).limit(5) : { data: [] };
  const { data: f } = await db.from("findings").select("id,number,title,status,level,requirement").eq("entity", entity).ilike("requirement", `%${code}%`).order("created_at", { ascending: false }).limit(5);
  const audits = (a ?? []) as { id: string; number: string; title: string; done_on: string | null; planned_month: string }[];
  return { previous: ((c ?? []) as { audit_id: string; result: string; comment: string | null; checked_at: string | null }[]).map((x) => ({ ...x, audit: audits.find((y) => y.id === x.audit_id) })), findings: (f ?? []) as { id: string; number: string; title: string; status: string; level: string; requirement: string | null }[] };
}

const SYSTEM = `You help an internal auditor of an EASA operator (AOC / CAMO / ATO / FSTD; authorities TM-CAD, DSAC, OSAC) prepare one check of a compliance audit. You are given the rule (and its AMC/GM when available), the chapters of the organisation's own manuals that cite it, and the previous results on this rule.
Say where to look and what to ask — never whether the organisation complies. Neutral professional English, short.
Answer ONLY with JSON: {"chapters":[{"manual":"code","ref":"section","why":"one line"}],"evidence":["typical records or documents that show compliance, max 5"],"ask":["questions to ask or things to sample, max 4"]}. List only chapters from those given (or clearly implied by the rule); none if nothing.`;

/** S.A.M.'s hints for a rule, cached per EAR version and entity. Never throws. */
export async function hintsFor(db: SupabaseClient, entity: string, c: Pick<Check, "regulation_id" | "version" | "code">, text: RegItem[], prev: { result: string; comment: string | null }[], force = false): Promise<{ hints: Hints | null; citations: Citation[] }> {
  const citations = await findCitations(db, entity, c.code).catch(() => [] as Citation[]);
  if (!c.regulation_id || !c.version) return { hints: null, citations };
  if (!force) {
    const { data } = await db.from("regulation_hints").select("hints").eq("regulation_id", c.regulation_id).eq("version", c.version).eq("code", c.code).eq("entity", entity).maybeSingle();
    if (data) return { hints: (data as { hints: Hints }).hints, citations };
  }
  if (!process.env.ANTHROPIC_API_KEY) return { hints: null, citations };
  try {
    const { callClaude } = await import("@/lib/ai");
    const ir = text.filter((t) => t.kind === "ir" || t.kind === "cs").map((t) => `${t.ref} ${t.title ?? ""}\n${t.body.map((b) => b.t).join("\n")}`).join("\n\n").slice(0, 5000);
    const amc = text.filter((t) => t.kind !== "ir" && t.kind !== "cs").map((t) => `${t.ref} ${t.title ?? ""}\n${t.body.map((b) => b.t).join("\n")}`).join("\n\n").slice(0, 3500);
    const user = `ENTITY ${entity}\nRULE ${c.code}\n${ir || "(text not loaded)"}\n\nAMC / GM\n${amc || "(none)"}\n\nCHAPTERS OF OUR MANUALS CITING ${c.code}\n${citations.slice(0, 12).map((x) => `${x.code} ${x.ref} ${x.section_title ?? ""}: ${x.snippet}`).join("\n") || "(none found)"}\n\nPREVIOUS RESULTS\n${prev.map((p) => `${RESULT_LABEL[p.result] ?? p.result}${p.comment ? ` — ${p.comment.slice(0, 200)}` : ""}`).join("\n") || "(none)"}`;
    const { text: out, model } = await callClaude({ agent: "check", personId: null, entity, system: SYSTEM, user, maxTokens: 1400 });
    const m = /\{[\s\S]*\}/.exec(out); if (!m) return { hints: null, citations };
    let j: Partial<Hints>;
    try { j = JSON.parse(m[0]) as Partial<Hints>; }
    catch { // cut by the token limit: keep the complete arrays only
      const cut = m[0].slice(0, Math.max(m[0].lastIndexOf("]"), 0) + 1).replace(/,\s*$/, "") + "}";
      try { j = JSON.parse(cut) as Partial<Hints>; } catch { return { hints: null, citations }; }
    }
    const hints: Hints = { chapters: (j.chapters ?? []).slice(0, 8).map((x) => ({ manual: String(x.manual ?? ""), ref: String(x.ref ?? ""), why: String(x.why ?? "").slice(0, 200) })), evidence: (j.evidence ?? []).slice(0, 5).map(String), ask: (j.ask ?? []).slice(0, 4).map(String), model, at: new Date().toISOString() };
    await db.from("regulation_hints").upsert({ regulation_id: c.regulation_id, version: c.version, code: c.code, entity, hints }, { onConflict: "regulation_id,version,code,entity" });
    return { hints, citations };
  } catch { return { hints: null, citations }; }
}

/** After a new EAR version is loaded: flag the checklist items whose rule changed. */
export async function flagChangedItems(db: SupabaseClient, regulationId: string, version: string): Promise<number> {
  const { data } = await db.from("regulation_items").select("code,ref,change").eq("regulation_id", regulationId).eq("version", version).in("change", ["new", "modified", "removed"]).limit(20000);
  const by = new Map<string, string[]>();
  for (const r of (data ?? []) as { code: string; ref: string; change: string }[]) by.set(r.code, [...(by.get(r.code) ?? []), `${r.ref}: ${r.change}`]);
  if (!by.size) return 0;
  const { data: items } = await db.from("checklist_items").select("id,code").eq("regulation_id", regulationId).in("code", [...by.keys()]);
  let n = 0;
  for (const it of (items ?? []) as { id: string; code: string }[]) { await db.from("checklist_items").update({ review_flag: true, review_note: `${version}: ${by.get(it.code)!.slice(0, 6).join(" · ")}` }).eq("id", it.id); n++; }
  return n;
}
