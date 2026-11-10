import type { SupabaseClient } from "@supabase/supabase-js";
import { today } from "@/lib/authority";

/* COMP-04/05/06 · Compliance checks, internal auditors, subcontractors. S.A.M. computes what is due; the desk records what was done. */

export type CCheck = { id: string; entity: string; code: string; title: string; reference: string | null; domain: string | null; checklist_id: string | null; every_months: number; owner_role: string | null; owner_person: string | null; last_done_on: string | null; next_due: string | null; note: string | null; active: boolean };
export type CRun = { id: string; check_id: string; done_on: string; done_by: string | null; result: string; sample: string | null; comment: string | null; evidence: { name: string; path: string; size: number; at: string }[]; finding_id: string | null; audit_id: string | null; created_at: string };
export type Auditor = { id: string; person_id: string; entities: string[]; domains: string[]; exclusions: string[]; lead: boolean; status: string; approved_by: string | null; approved_on: string | null; valid_until: string | null; external: string | null; note: string | null };
export type AuditorItem = { id: string; auditor_id: string; ord: number; label: string; done: boolean; evidence: string | null; on_date: string | null; valid_until: string | null };
export type AuditorDoc = { id: string; auditor_id: string; name: string; kind: string | null; path: string | null; size: number | null; issued_on: string | null; valid_until: string | null; at: string };
export type Subcontractor = { id: string; entity: string; code: string | null; name: string; service: string | null; domain: string | null; approval_ref: string | null; contract_ref: string | null; contract_from: string | null; contract_until: string | null; access_clause: boolean | null; is_clause: boolean | null; every_months: number; contact: string | null; status_note: string | null; active: boolean; imported_from: string | null };

export const AUDITOR_STATUS: Record<string, string> = { in_qualification: "In qualification", approved: "Approved", suspended: "Suspended", withdrawn: "Withdrawn" };
export const AUDITOR_DOMAINS = ["Management system", "OPS", "Ground Ops", "Training", "CAMO", "CAE", "ATO", "FSTD", "Safety", "Part-IS", "Security", "DGR"];
/** PRO-CM-04 qualification path, seeded on each new auditor. */
export const QUALIFICATION_ITEMS = ["Auditor training (ISO 19011 / EASA auditing course)", "Regulatory knowledge of the domains authorised", "Practical experience — 2 audits as observer, 2 as co-auditor", "Independence declared from the audited departments", "Recurrent training ≤ 36 months", "Approved by the Accountable Manager"];
export const CHECK_RESULT_LABEL: Record<string, string> = { conforming: "Conforming", partial: "Partially conforming", non_conforming: "Not conforming" };
export const CHECK_RESULT_TONE: Record<string, string> = { conforming: "green", partial: "amber", non_conforming: "red" };

export const addMonthsD = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
export const daysTo = (d: string | null, t0 = today()) => (d ? Math.round((Date.parse(d) - Date.parse(t0)) / 86_400_000) : null);

/** Next due of a check = last run + cadence (or the date typed when nothing was run yet). */
export function nextDueOf(c: Pick<CCheck, "last_done_on" | "every_months" | "next_due">): string | null {
  return c.last_done_on ? addMonthsD(c.last_done_on, c.every_months) : c.next_due;
}

/** FB-073 · a recurring check with no passage recorded in S.A.M. yet takes its last date from the last audit done under the
 *  programme module it is linked to (history imported from the previous tool): same rule as the programme grid, used everywhere. */
export async function withProgrammeHistory<T extends Pick<CCheck, "id" | "last_done_on">>(db: SupabaseClient, checks: T[]): Promise<(T & { history_from?: string })[]> {
  const missing = checks.filter((c) => !c.last_done_on).map((c) => c.id);
  if (!missing.length) return checks;
  const { data: mods } = await db.from("audit_modules").select("id,check_ids").overlaps("check_ids", missing);
  const M = (mods ?? []) as { id: string; check_ids: string[] | null }[];
  if (!M.length) return checks;
  const { data: au } = await db.from("audits").select("number,module_id,done_on").in("module_id", M.map((m) => m.id)).eq("status", "closed").not("done_on", "is", null).order("done_on", { ascending: false }).limit(2000);
  const A = (au ?? []) as { number: string; module_id: string; done_on: string }[];
  return checks.map((c) => {
    if (c.last_done_on) return c;
    const ids = M.filter((m) => m.check_ids?.includes(c.id)).map((m) => m.id);
    const last = A.find((a) => ids.includes(a.module_id));
    return last ? { ...c, last_done_on: last.done_on.slice(0, 10), history_from: last.number } : c;
  });
}

/** Open Inbox tasks for checks due within 30 days (kind 'check'); closed when the check is run. Daily job. */
export async function sweepChecks(db: SupabaseClient): Promise<number> {
  const { data } = await db.from("compliance_checks").select("*").eq("active", true);
  const t0 = today(); let n = 0;
  for (const c of await withProgrammeHistory(db, (data ?? []) as CCheck[])) {
    const due = nextDueOf(c); const d = daysTo(due, t0);
    if (d === null || d > 30) { await db.from("tasks").update({ status: "done" }).eq("ref_id", c.id).eq("kind", "check").eq("status", "open"); continue; }
    const { data: ex } = await db.from("tasks").select("id").eq("ref_id", c.id).eq("kind", "check").eq("status", "open").limit(1);
    if (ex?.length) continue;
    await db.from("tasks").insert({ entity: c.entity, kind: "check", title: `Compliance check · ${c.code} ${c.title}`.slice(0, 200), detail: `${c.reference ?? ""}${c.every_months ? ` · every ${c.every_months} months` : ""}${c.last_done_on ? ` · last ${c.last_done_on}` : " · never recorded"}`.trim(), due, owner_role: c.owner_person ? null : c.owner_role ?? "CMM", owner_person: c.owner_person, status: "open", link: `/comp/checks?c=${c.id}`, ref_id: c.id });
    n++;
  }
  return n;
}

/** Can this person lead an audit of this entity / domain today? (approved, valid, entity and domain authorised, domain not excluded) */
export function eligibility(a: Auditor | null | undefined, entity: string, domain: string | null, t0 = today()): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (!a) return { ok: false, why: ["not in the register of internal auditors"] };
  if (a.status !== "approved") why.push(`status: ${AUDITOR_STATUS[a.status] ?? a.status}`);
  if (a.valid_until && a.valid_until < t0) why.push(`approval expired ${a.valid_until}`);
  if (!a.entities.includes(entity)) why.push(`not approved for ${entity}`);
  if (domain && a.domains.length && !a.domains.some((d) => d.toUpperCase() === domain.toUpperCase())) why.push(`domain ${domain} not authorised`);
  if (domain && a.exclusions.some((x) => x.toUpperCase().includes(domain.toUpperCase()))) why.push(`cannot audit ${domain} (own department)`);
  return { ok: !why.length, why };
}

/** Subcontractor control: last closed audit linked to it, next control = last + cadence. */
export function controlOf(s: Subcontractor, audits: { subcontractor_id: string | null; status: string; done_on: string | null; planned_month: string }[], t0 = today()) {
  const mine = audits.filter((a) => a.subcontractor_id === s.id);
  const done = mine.filter((a) => a.status === "closed" && a.done_on).sort((a, b) => (b.done_on ?? "").localeCompare(a.done_on ?? ""));
  const planned = mine.filter((a) => ["planned", "in_progress", "report"].includes(a.status)).sort((a, b) => a.planned_month.localeCompare(b.planned_month));
  const last = done[0]?.done_on ?? null;
  const next = last ? addMonthsD(last, s.every_months) : null;
  const d = daysTo(next, t0);
  const contractOk = !s.contract_until || s.contract_until >= t0;
  const status = !contractOk ? "contract_expired" : !last ? (planned.length ? "control_planned" : "not_controlled") : d !== null && d < 0 ? "control_overdue" : d !== null && d <= 60 ? "control_due" : "under_control";
  return { last, next, planned: planned[0] ?? null, status, contractOk };
}
export const CONTROL_LABEL: Record<string, string> = { under_control: "Under control", control_due: "Control due", control_overdue: "Control overdue", control_planned: "Control planned", not_controlled: "Never controlled", contract_expired: "Contract expired" };
export const CONTROL_TONE: Record<string, string> = { under_control: "green", control_due: "amber", control_overdue: "red", control_planned: "", not_controlled: "amber", contract_expired: "red" };

/** Approvals and certificates of auditors ending within 90 days → one Inbox task each for the desk (kind certificate_validity). Daily job. */
export async function sweepAuditors(db: SupabaseClient): Promise<number> {
  const t0 = today(); let n = 0;
  const { data: as } = await db.from("auditors").select("id,person_id,entities,status,valid_until").eq("status", "approved");
  const { data: ds } = await db.from("auditor_docs").select("id,auditor_id,name,valid_until").not("valid_until", "is", null);
  const { data: ppl } = await db.from("people").select("id,display_name").limit(800);
  const name = (id: string) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === id)?.display_name ?? "auditor";
  const want: { ref: string; entity: string; title: string; due: string; link: string }[] = [];
  for (const a of (as ?? []) as { id: string; person_id: string; entities: string[]; valid_until: string | null }[]) { const d = daysTo(a.valid_until, t0); if (d !== null && d <= 90) want.push({ ref: a.id, entity: a.entities[0] ?? "ASJMT", title: `Auditor approval · ${name(a.person_id)} ends ${a.valid_until}`, due: a.valid_until!, link: `/comp/auditors?a=${a.id}` }); }
  for (const d of (ds ?? []) as { id: string; auditor_id: string; name: string; valid_until: string }[]) { const dd = daysTo(d.valid_until, t0); const a = ((as ?? []) as { id: string; person_id: string; entities: string[] }[]).find((x) => x.id === d.auditor_id); if (dd !== null && dd <= 90 && a) want.push({ ref: d.id, entity: a.entities[0] ?? "ASJMT", title: `Auditor certificate · ${name(a.person_id)}, ${d.name} ends ${d.valid_until}`, due: d.valid_until, link: `/comp/auditors?a=${a.id}` }); }
  for (const w of want) {
    const { data: ex } = await db.from("tasks").select("id").eq("ref_id", w.ref).eq("kind", "certificate_validity").eq("status", "open").limit(1);
    if (ex?.length) continue;
    await db.from("tasks").insert({ entity: w.entity, kind: "certificate_validity", title: w.title.slice(0, 200), detail: "Renew the training or the approval before the date; record the new document in Internal auditors.", due: w.due, owner_role: "CMM", status: "open", link: w.link, ref_id: w.ref });
    n++;
  }
  return n;
}
