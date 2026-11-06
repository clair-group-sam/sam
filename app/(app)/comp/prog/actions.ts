"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { today } from "@/lib/authority";
import { addMonths, lines, loadProgramme, monthStart, monthsBetween, nextAuditNumber, PROG_REF, type Audit, type Programme } from "@/lib/audit-programme";

/* AUD-01 · Audit programme — Compliance desk writes the programme; the lead auditor may move his own audit (with a reason). */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
const touch = (id?: string | null) => { revalidatePath("/comp/prog"); if (id) revalidatePath(`/comp/prog/${id}`); };
async function log(s: Session, entity: string, type: string, id: string, action: string, after: unknown) {
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: type, object_id: id, action, after });
}
async function prog(id: string): Promise<Programme> { const { data } = await db().from("audit_programmes").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Programme not found"); return data as Programme; }
async function audit(id: string): Promise<Audit> { const { data } = await db().from("audits").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Audit not found"); return data as Audit; }
const endOf = (start: string, months: number) => { const d = new Date(Date.parse(addMonths(start, months)) - 86_400_000); return d.toISOString().slice(0, 10); };

/* ---------- programme ---------- */
export async function createProgramme(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const entity = String(fd.get("entity"));
  if (!s.group && !s.entities.includes(entity)) throw new Error("Not your entity.");
  const cycle = Math.min(36, Math.max(6, Number(fd.get("cycle_months") ?? 12) || 12));
  const start = monthStart(str(fd, "starts_on") ?? today());
  const ref = PROG_REF[entity];
  const row = { entity, title: str(fd, "title") ?? `Audit programme ${start.slice(0, 4)}`, reference: str(fd, "reference") ?? ref?.reference ?? null, domains: ref?.domains ?? [], cycle_months: cycle, starts_on: start, ends_on: endOf(start, cycle), requirements: lines(str(fd, "requirements")), created_by: s.person?.id ?? null };
  const { data, error } = await db().from("audit_programmes").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  await log(s, entity, "audit_programme", data.id, "audit_programme_created", row);
  touch(); redirect(`/comp/prog/${data.id}`);
}
export async function saveProgramme(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const p = await prog(String(fd.get("id")));
  const cycle = Math.min(36, Math.max(6, Number(fd.get("cycle_months") ?? p.cycle_months) || p.cycle_months));
  const start = monthStart(str(fd, "starts_on") ?? p.starts_on);
  const row = { title: str(fd, "title") ?? p.title, reference: str(fd, "reference"), cycle_months: cycle, starts_on: start, ends_on: endOf(start, cycle), requirements: lines(str(fd, "requirements")), note: str(fd, "note"), updated_at: new Date().toISOString() };
  await db().from("audit_programmes").update(row).eq("id", p.id);
  await log(s, p.entity, "audit_programme", p.id, "audit_programme_updated", row);
  touch(p.id);
}
export async function approveProgramme(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const p = await prog(String(fd.get("id")));
  const row = { status: "approved", approved_by: s.person?.id ?? null, approved_at: new Date().toISOString(), approval_note: str(fd, "note") };
  await db().from("audit_programmes").update(row).eq("id", p.id);
  await log(s, p.entity, "audit_programme", p.id, "audit_programme_approved", row);
  touch(p.id);
}
export async function closeProgramme(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const p = await prog(String(fd.get("id")));
  await db().from("audit_programmes").update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", p.id);
  await log(s, p.entity, "audit_programme", p.id, "audit_programme_closed", { note: str(fd, "note") });
  touch(p.id);
}
/** Next cycle as a draft: same modules, audits at the same place in the cycle (dates to confirm). */
export async function planNextCycle(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const x = await loadProgramme(db(), String(fd.get("id"))); if (!x) throw new Error("Programme not found");
  const { p, mods, audits } = x;
  const start = addMonths(p.ends_on, 1);
  const y0 = Number(start.slice(0, 4)), y1 = Number(endOf(start, p.cycle_months).slice(0, 4));
  const row = { entity: p.entity, title: `Audit programme ${y0}${y1 !== y0 ? `-${y1}` : ""}`, reference: p.reference, domains: p.domains, cycle_months: p.cycle_months, starts_on: start, ends_on: endOf(start, p.cycle_months), requirements: p.requirements, previous_id: p.id, created_by: s.person?.id ?? null };
  const { data: np, error } = await db().from("audit_programmes").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const m of mods.filter((m) => m.active)) {
    const { data } = await db().from("audit_modules").insert({ programme_id: np.id, code: m.code, title: m.title, domain: m.domain, kind: m.kind, requirements: m.requirements, sort: m.sort, checklist_id: (m as { checklist_id?: string | null }).checklist_id ?? null }).select("id").single();
    if (data) map.set(m.id, data.id);
  }
  for (const a of audits.filter((a) => a.status !== "cancelled" && a.kind !== "authority")) {
    const month = addMonths(start, monthsBetween(monthStart(p.starts_on), a.planned_month));
    const number = await nextAuditNumber(db(), p.entity, Number(month.slice(0, 4)));
    const { data } = await db().from("audits").insert({ entity: p.entity, number, programme_id: np.id, module_id: a.module_id ? map.get(a.module_id) ?? null : null, checklist_id: (a as { checklist_id?: string | null }).checklist_id ?? null, kind: a.kind, domain: a.domain, title: a.title, planned_month: month, lead_auditor: a.lead_auditor, auditors: a.auditors, external_auditor: a.external_auditor, subcontractor: a.subcontractor, scope: a.scope, created_by: s.person?.id ?? null }).select("id").single();
    if (data) await db().from("audit_events").insert({ audit_id: data.id, by: s.person?.id ?? null, kind: "planned", to_month: month, reason: `Carried over from ${a.number}` });
  }
  await log(s, p.entity, "audit_programme", np.id, "audit_programme_next_cycle", { from: p.id });
  touch(p.id); redirect(`/comp/prog/${np.id}`);
}

/* ---------- modules ---------- */
export async function saveModule(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const p = await prog(String(fd.get("programme")));
  const id = str(fd, "id");
  const row = { programme_id: p.id, code: (str(fd, "code") ?? "MOD").toUpperCase(), title: str(fd, "title") ?? "Module", domain: str(fd, "domain"), kind: str(fd, "kind") ?? "internal", requirements: lines(str(fd, "requirements")), sort: Number(fd.get("sort") ?? 0) || 0 };
  if (id) await db().from("audit_modules").update(row).eq("id", id); else await db().from("audit_modules").insert(row);
  touch(p.id);
}
export async function archiveModule(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  await db().from("audit_modules").update({ active: false }).eq("id", String(fd.get("id")));
  touch(str(fd, "programme"));
}

/* ---------- audits in the programme ---------- */
export async function addAudit(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const p = await prog(String(fd.get("programme")));
  const month = monthStart(str(fd, "month") ?? p.starts_on);
  const moduleId = str(fd, "module");
  const { data: m } = moduleId ? await db().from("audit_modules").select("code,title,domain,kind,checklist_id").eq("id", moduleId).maybeSingle() : { data: null };
  const mod = m as { code: string; title: string; domain: string | null; kind: string; checklist_id: string | null } | null;
  const kind = str(fd, "kind") ?? mod?.kind ?? "internal";
  const number = await nextAuditNumber(db(), p.entity, Number(month.slice(0, 4)));
  const subName = str(fd, "subcontractor") ?? (kind === "subcontractor" ? mod?.title ?? null : null);
  const { data: subRow } = subName ? await db().from("subcontractors").select("id").eq("entity", p.entity).eq("active", true).ilike("name", `%${subName.split(" (")[0]}%`).limit(1).maybeSingle() : { data: null };
  const row = { entity: p.entity, number, programme_id: p.id, module_id: moduleId, checklist_id: mod?.checklist_id ?? null, subcontractor_id: (subRow as { id: string } | null)?.id ?? null, kind, domain: str(fd, "domain") ?? mod?.domain ?? null, title: str(fd, "title") ?? (mod ? `${mod.code} — ${mod.title}` : "Audit"), planned_month: month,
    planned_on: str(fd, "planned_on"), lead_auditor: str(fd, "lead_auditor"), external_auditor: str(fd, "external_auditor"), authority: kind === "authority" ? str(fd, "authority") ?? PROG_REF[p.entity]?.authority ?? null : null, subcontractor: subName, scope: str(fd, "scope"), created_by: s.person?.id ?? null };
  const { data, error } = await db().from("audits").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  await db().from("audit_events").insert({ audit_id: data.id, by: s.person?.id ?? null, kind: "planned", to_month: month });
  await log(s, p.entity, "audit", data.id, "audit_planned", row);
  touch(p.id);
}
/** Move an audit to another month: the reason is mandatory and kept. */
export async function replanAudit(fd: FormData) {
  const s = await me(); const a = await audit(String(fd.get("id")));
  if (!desk(s) && a.lead_auditor !== s.person?.id) throw new Error("Compliance desk or the lead auditor only.");
  const to = monthStart(String(fd.get("month") ?? "")); const reason = str(fd, "reason");
  if (!/^\d{4}-\d{2}-01$/.test(to)) throw new Error("Pick the new month.");
  if (!reason) throw new Error("Say why the audit moves.");
  if (to === a.planned_month) return;
  await db().from("audits").update({ planned_month: to, planned_on: null, planned_end: null, replanned: a.replanned + 1, updated_at: new Date().toISOString() }).eq("id", a.id);
  await db().from("audit_events").insert({ audit_id: a.id, by: s.person?.id ?? null, kind: "replanned", from_month: a.planned_month, to_month: to, reason });
  await log(s, a.entity, "audit", a.id, "audit_replanned", { from: a.planned_month, to, reason });
  touch(a.programme_id);
}
export async function cancelAudit(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const a = await audit(String(fd.get("id"))); const reason = str(fd, "reason");
  if (!reason) throw new Error("Say why the audit is cancelled.");
  await db().from("audits").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", a.id);
  await db().from("audit_events").insert({ audit_id: a.id, by: s.person?.id ?? null, kind: "cancelled", from_month: a.planned_month, reason });
  await log(s, a.entity, "audit", a.id, "audit_cancelled", { reason });
  touch(a.programme_id);
}
export async function saveAuditPlan(fd: FormData) {
  const s = await me(); const a = await audit(String(fd.get("id")));
  if (!desk(s) && a.lead_auditor !== s.person?.id) throw new Error("Compliance desk or the lead auditor only.");
  const status = str(fd, "status") ?? a.status;
  if (status === "closed" && (str(fd, "done_on") ?? today()) > today()) throw new Error("An audit cannot be done at a future date."); // FB-059
  const row = { title: str(fd, "title") ?? a.title, planned_on: str(fd, "planned_on"), planned_end: str(fd, "planned_end"), lead_auditor: desk(s) ? str(fd, "lead_auditor") : a.lead_auditor, external_auditor: str(fd, "external_auditor"), scope: str(fd, "scope"),
    status, done_on: status === "closed" ? str(fd, "done_on") ?? a.done_on ?? today() : a.done_on, updated_at: new Date().toISOString() };
  await db().from("audits").update(row).eq("id", a.id);
  if (status !== a.status) await db().from("audit_events").insert({ audit_id: a.id, by: s.person?.id ?? null, kind: "status", status, reason: str(fd, "reason") });
  await log(s, a.entity, "audit", a.id, "audit_updated", row);
  touch(a.programme_id);
}
