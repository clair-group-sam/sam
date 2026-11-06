"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { today } from "@/lib/authority";
import { breakdown, hintsFor, history, instantiateChecks, RESULTS, textFor, type Check } from "@/lib/audit-run";
import { nextFindingNumber, syncFindingTasks, type Finding } from "@/lib/findings";
import type { Audit } from "@/lib/audit-programme";
import { eligibility, type Auditor } from "@/lib/compliance-registers";

/* AUD-02 · the audit run: start, check by check (result, comment, evidence), finding from a check, report, close. Lead auditor / auditors / Compliance desk. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
type A = Audit & { checklist_id: string | null; started_on: string | null; report_summary: string | null; report_at: string | null };
async function audit(id: string): Promise<A> { const { data } = await db().from("audits").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Audit not found"); return data as A; }
const team = (s: Session, a: A) => desk(s) || a.lead_auditor === s.person?.id || (!!s.person && a.auditors.includes(s.person.id));
const touch = (id: string, prog?: string | null) => { revalidatePath("/comp/audits"); revalidatePath(`/comp/audits/${id}`); if (prog) revalidatePath(`/comp/prog/${prog}`); revalidatePath("/comp/prog"); };
async function log(s: Session, a: A, action: string, after: unknown) { await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: a.entity, object_type: "audit", object_id: a.id, action, after }); }
async function event(s: Session, a: A, status: string, reason?: string | null) { await db().from("audit_events").insert({ audit_id: a.id, by: s.person?.id ?? null, kind: "status", status, reason: reason ?? null }); }

export async function startAudit(fd: FormData) {
  const s = await me(); const a = await audit(String(fd.get("id")));
  if (!team(s, a)) throw new Error("Lead auditor, auditors or Compliance desk only.");
  if (a.status !== "planned") throw new Error("Already started.");
  // ENR-CM-09: the lead auditor must be approved for the entity and the domain (the desk may override with a reason, kept in the history)
  if (a.lead_auditor && a.kind !== "authority") {
    const { data: ar } = await db().from("auditors").select("*").eq("person_id", a.lead_auditor).maybeSingle();
    const el = eligibility(ar as Auditor | null, a.entity, a.domain);
    if (!el.ok) { const why = str(fd, "override"); if (!why || !desk(s)) throw new Error(`Lead auditor not eligible: ${el.why.join(", ")}. Change the auditor, update the register, or (desk) start with an override reason.`); await db().from("audit_events").insert({ audit_id: a.id, by: s.person?.id ?? null, kind: "note", reason: `Started with a non-eligible lead auditor (${el.why.join(", ")}): ${why}` }); }
  }
  const checklistId = str(fd, "checklist") ?? a.checklist_id;
  if (checklistId && checklistId !== a.checklist_id) await db().from("audits").update({ checklist_id: checklistId }).eq("id", a.id);
  const n = await instantiateChecks(db(), { ...a, checklist_id: checklistId });
  await db().from("audits").update({ status: "in_progress", started_on: today(), planned_on: a.planned_on ?? today(), updated_at: new Date().toISOString() }).eq("id", a.id);
  await event(s, a, "in_progress", n ? `${n} checks from the checklist` : "no checklist");
  await log(s, a, "audit_started", { checks: n, checklist: checklistId });
  touch(a.id, a.programme_id);
}
export async function setCheck(fd: FormData) {
  const s = await me(); const id = String(fd.get("id"));
  const { data: cd } = await db().from("audit_checks").select("*").eq("id", id).maybeSingle(); if (!cd) throw new Error("Check not found");
  const c = cd as Check; const a = await audit(c.audit_id);
  if (!team(s, a)) throw new Error("Audit team only."); if (!["in_progress", "report"].includes(a.status)) throw new Error("The audit is not open.");
  const result = str(fd, "result"); if (result && !RESULTS.includes(result)) throw new Error("Unknown result.");
  const row: Record<string, unknown> = { comment: str(fd, "comment") };
  if (fd.has("result")) { row.result = result; row.checked_by = result ? s.person?.id ?? null : null; row.checked_at = result ? new Date().toISOString() : null; }
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) throw new Error("File larger than 25 MB.");
    const safe = file.name.replace(/[^\w.\-() ]+/g, "_"); const path = `${a.entity}/${a.id}/${c.id}/${Date.now()}-${safe}`;
    const { error } = await db().storage.from("audits").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
    if (error) throw new Error(error.message);
    row.evidence = [...c.evidence, { name: safe, path: `audits/${path}`, size: file.size, at: new Date().toISOString(), by: s.person?.id ?? null }];
  }
  await db().from("audit_checks").update(row).eq("id", c.id);
  touch(a.id);
}
export async function addCheck(fd: FormData) {
  const s = await me(); const a = await audit(String(fd.get("audit")));
  if (!team(s, a)) throw new Error("Audit team only."); if (a.status !== "in_progress") throw new Error("The audit is not open.");
  const code = str(fd, "code"); if (!code) throw new Error("Give the rule code or a short code.");
  const { data: regs } = await db().from("regulations").select("id,items_version").eq("id", str(fd, "regulation") ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const { count } = await db().from("audit_checks").select("id", { count: "exact", head: true }).eq("audit_id", a.id);
  await db().from("audit_checks").insert({ audit_id: a.id, ord: (count ?? 0) + 1, section: str(fd, "section") ?? "Added during the audit", code: code.toUpperCase(), regulation_id: (regs as { id: string } | null)?.id ?? null, version: (regs as { items_version: string | null } | null)?.items_version ?? null, question: str(fd, "question") });
  touch(a.id);
}
/** A finding raised from a check: the rule becomes the requirement, the comment the description; the NP answers as in FND-03. */
export async function raiseFinding(fd: FormData) {
  const s = await me(); const id = String(fd.get("check"));
  const { data: cd } = await db().from("audit_checks").select("*").eq("id", id).maybeSingle(); if (!cd) throw new Error("Check not found");
  const c = cd as Check; const a = await audit(c.audit_id);
  if (!team(s, a)) throw new Error("Audit team only.");
  if (c.finding_id) redirect(`/comp/find/${c.finding_id}`);
  const title = str(fd, "title") ?? `${c.code} — ${c.question ?? "non-conformity found in audit"}`.slice(0, 300);
  if (!str(fd, "owner_role") && !str(fd, "owner_person")) throw new Error("Name the nominated person who answers (post or person).");
  const number = await nextFindingNumber(db(), a.entity);
  const row = { entity: a.entity, number, source: a.kind === "authority" ? "authority" : a.kind === "subcontractor" ? "subcontractor" : "internal_audit", authority: a.authority, audit_ref: a.number, audit_id: a.id, check_id: c.id, level: str(fd, "level") ?? "2", requirement: c.ref ? `${c.code} ${c.ref}` : c.code, title, description: str(fd, "description") ?? c.comment,
    owner_role: str(fd, "owner_role")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person"), notified: today(), due: str(fd, "due"), status: "open", category: str(fd, "category"), cause: str(fd, "cause"), created_by: s.person?.id ?? null };
  const { data, error } = await db().from("findings").insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Finding not created.");
  const f = data as Finding;
  await db().from("audit_checks").update({ finding_id: f.id, result: c.result ?? (f.level === "obs" ? "partial" : "non_conforming"), checked_by: c.checked_by ?? s.person?.id ?? null, checked_at: c.checked_at ?? new Date().toISOString() }).eq("id", c.id);
  await syncFindingTasks(db(), f);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: f.entity, object_type: "finding", object_id: f.id, action: "finding_created", after: { ...row, via: "audit" } });
  touch(a.id); revalidatePath("/comp/find");
  redirect(`/comp/find/${f.id}`);
}
export async function reportAudit(fd: FormData) {
  const s = await me(); const a = await audit(String(fd.get("id")));
  if (!team(s, a)) throw new Error("Audit team only.");
  const { data } = await db().from("audit_checks").select("*").eq("audit_id", a.id).limit(5000);
  const b = breakdown((data ?? []) as Check[]);
  const summary = str(fd, "summary");
  const toStatus = str(fd, "to") === "closed" ? "closed" : "report";
  if (toStatus === "closed" && !desk(s)) throw new Error("The Compliance desk closes the audit.");
  if (toStatus === "report" && b.done < b.total) throw new Error(`${b.total - b.done} check(s) without a result.`);
  const row: Record<string, unknown> = { status: toStatus, report_summary: summary ?? a.report_summary, updated_at: new Date().toISOString() };
  if (toStatus === "report" && !a.report_at) row.report_at = new Date().toISOString();
  if (toStatus === "closed") { row.closed_at = new Date().toISOString(); row.closed_by = s.person?.id ?? null; row.done_on = a.done_on ?? today(); }
  await db().from("audits").update(row).eq("id", a.id);
  await event(s, a, toStatus, toStatus === "report" ? `${b.conforming} C · ${b.partial} P · ${b.non_conforming} NC · ${b.not_applicable} N/A · ${b.not_covered} not covered` : null);
  await log(s, a, toStatus === "closed" ? "audit_closed" : "audit_reported", { ...b, summary });
  touch(a.id, a.programme_id);
}
export async function reopenAudit(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const a = await audit(String(fd.get("id")));
  await db().from("audits").update({ status: "in_progress", closed_at: null, closed_by: null, updated_at: new Date().toISOString() }).eq("id", a.id);
  await event(s, a, "in_progress", str(fd, "reason") ?? "reopened"); touch(a.id, a.programme_id);
}
/** S.A.M. reads the rule again (fresh hints). */
export async function refreshHints(fd: FormData) {
  const s = await me(); const id = String(fd.get("check"));
  const { data: cd } = await db().from("audit_checks").select("*").eq("id", id).maybeSingle(); if (!cd) throw new Error("Check not found");
  const c = cd as Check; const a = await audit(c.audit_id); if (!team(s, a)) throw new Error("Audit team only.");
  const text = await textFor(db(), c); const h = await history(db(), a.entity, c.code, a.id);
  await hintsFor(db(), a.entity, c, text, h.previous, true);
  touch(a.id);
}
