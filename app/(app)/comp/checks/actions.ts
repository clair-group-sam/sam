"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { today } from "@/lib/authority";
import { nextDueOf, type CCheck } from "@/lib/compliance-registers";
import { nextFindingNumber, syncFindingTasks, type Finding } from "@/lib/findings";

/* COMP-04 · recurring compliance checks: the desk defines them; the owner records each run (result, sample, evidence), a finding when needed. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
async function check(id: string): Promise<CCheck> { const { data } = await db().from("compliance_checks").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Check not found"); return data as CCheck; }
const owns = (s: Session, c: CCheck) => desk(s) || (!!c.owner_person && c.owner_person === s.person?.id) || (!!c.owner_role && s.roles.map(basePost).includes(basePost(c.owner_role)) && s.entities.includes(c.entity));
const touch = () => { revalidatePath("/comp/checks"); revalidatePath("/comp/over"); revalidatePath("/home/tasks"); };

export async function saveCheck(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const id = str(fd, "id");
  const row = { entity: str(fd, "entity"), code: (str(fd, "code") ?? "CC").toUpperCase(), title: str(fd, "title") ?? "Check", reference: str(fd, "reference"), domain: str(fd, "domain"), checklist_id: str(fd, "checklist"), every_months: Math.max(1, Number(fd.get("every_months") ?? 6) || 6), owner_role: str(fd, "owner_role")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person"), next_due: str(fd, "next_due"), note: str(fd, "note") };
  if (id) { const { entity: _e, ...patch } = row; void _e; await db().from("compliance_checks").update(patch).eq("id", id); }
  else { if (!row.entity) throw new Error("Entity."); const { error } = await db().from("compliance_checks").insert(row); if (error) throw new Error(error.message); }
  touch();
}
export async function archiveCheck(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  await db().from("compliance_checks").update({ active: false }).eq("id", String(fd.get("id"))); await db().from("tasks").update({ status: "done" }).eq("ref_id", String(fd.get("id"))).eq("kind", "check").eq("status", "open"); touch();
}
/** One run: result, what was sampled, comment, one file; the next due date moves; a not-conforming result may raise a finding. */
export async function recordRun(fd: FormData) {
  const s = await me(); const c = await check(String(fd.get("id")));
  if (!owns(s, c)) throw new Error("Owner of the check or Compliance desk only.");
  const result = str(fd, "result"); if (!result || !["conforming", "partial", "non_conforming"].includes(result)) throw new Error("Pick the result.");
  const done_on = str(fd, "done_on") ?? today();
  const evidence: { name: string; path: string; size: number; at: string }[] = [];
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) throw new Error("File larger than 25 MB.");
    const safe = file.name.replace(/[^\w.\-() ]+/g, "_"); const path = `${c.entity}/checks/${c.id}/${Date.now()}-${safe}`;
    const { error } = await db().storage.from("audits").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
    if (error) throw new Error(error.message);
    evidence.push({ name: safe, path: `audits/${path}`, size: file.size, at: new Date().toISOString() });
  }
  const { data: run, error } = await db().from("compliance_check_runs").insert({ check_id: c.id, done_on, done_by: s.person?.id ?? null, result, sample: str(fd, "sample"), comment: str(fd, "comment"), evidence }).select("id").single();
  if (error) throw new Error(error.message);
  await db().from("compliance_checks").update({ last_done_on: done_on, next_due: nextDueOf({ last_done_on: done_on, every_months: c.every_months, next_due: null }) }).eq("id", c.id);
  await db().from("tasks").update({ status: "done" }).eq("ref_id", c.id).eq("kind", "check").eq("status", "open");
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: c.entity, object_type: "compliance_check", object_id: c.id, action: "check_run", after: { run: run?.id, result, done_on } });
  if (result !== "conforming" && fd.get("raise_finding")) {
    if (!str(fd, "owner_role_f") && !str(fd, "owner_person_f")) throw new Error("Name the nominated person who answers the finding.");
    const number = await nextFindingNumber(db(), c.entity);
    const row = { entity: c.entity, number, source: "internal_audit", audit_ref: `${c.code} · ${done_on}`, level: result === "non_conforming" ? "2" : "obs", requirement: c.reference, title: `${c.code} — ${str(fd, "title_f") ?? c.title}`.slice(0, 300), description: str(fd, "comment"), owner_role: str(fd, "owner_role_f")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person_f"), notified: done_on, due: str(fd, "due_f"), status: "open", category: str(fd, "category_f"), cause: str(fd, "cause_f"), created_by: s.person?.id ?? null };
    const { data: f } = await db().from("findings").insert(row).select("*").single();
    if (f) { await db().from("compliance_check_runs").update({ finding_id: (f as Finding).id }).eq("id", run!.id); await syncFindingTasks(db(), f as Finding); revalidatePath("/comp/find"); }
  }
  touch();
}
