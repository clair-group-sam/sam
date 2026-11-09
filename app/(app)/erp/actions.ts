"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* ERP · activation mode: start (alert or activation, real or exercise), log, tick the checklists, close. The log is append-only. */
const db = () => supabaseAdmin();
export async function mayActivate(s: Session): Promise<boolean> {
  return s.role === "cmm" || s.role === "np" || s.role === "am" || s.roles.map(basePost).some((r) => ["AM", "CMM", "SM", "SUPERADMIN"].includes(r));
}
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); if (!(await mayActivate(s))) throw new Error("Your post cannot activate the ERP."); return s; }
async function inScope(s: Session, activationId: string): Promise<{ id: string; entity: string; status: string; title: string; exercise: boolean }> {
  const { data } = await db().from("erp_activations").select("id,entity,status,title,exercise").eq("id", activationId).maybeSingle();
  const a = data as { id: string; entity: string; status: string; title: string; exercise: boolean } | null;
  if (!a || (!s.group && !s.entities.includes(a.entity))) throw new Error("Out of your scope.");
  return a;
}

export async function startActivation(fd: FormData) {
  const s = await me();
  const entity = String(fd.get("entity") ?? "");
  if (!entity || (!s.group && !s.entities.includes(entity))) throw new Error("Pick an entity in your scope.");
  const title = String(fd.get("title") ?? "").trim();
  if (!title) throw new Error("Say in a few words what happened.");
  const exercise = fd.get("exercise") === "on";
  const level = fd.get("level") === "activation" ? "activation" : "alert";
  const plan = String(fd.get("plan") ?? "") || null;
  const { data, error } = await db().from("erp_activations").insert({ entity, title: title.slice(0, 200), exercise, level, plan_id: plan, started_by: s.person?.id ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  await db().from("erp_events").insert({ activation_id: id, person_id: s.person?.id ?? null, kind: "status", text: `${exercise ? "EXERCISE. " : ""}${level === "activation" ? "ERP activated" : "Alert raised"} by ${s.name}: ${title}` });
  // the crisis cell gets an Inbox item at once (and so a Teams card at the next sweep)
  const link = "/erp/activate";
  await db().from("tasks").insert(["AM", "SM", "CMM"].map((role) => ({ entity, kind: "erp", title: `${exercise ? "Exercise: " : ""}ERP ${level === "activation" ? "activated" : "alert"}: ${title}`.slice(0, 200), detail: "Join the crisis cell and open the activation log in S.A.M.", owner_role: role, status: "open", link, ref_id: id })));
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "erp_activation", object_id: id, action: exercise ? "erp_exercise_started" : "erp_activation_started", after: { level, title } });
  revalidatePath("/erp/activate"); revalidatePath("/home/tasks");
  redirect("/erp/activate");
}

export async function logEvent(fd: FormData) {
  const s = await me(); const a = await inScope(s, String(fd.get("id")));
  if (a.status !== "open") throw new Error("This activation is closed.");
  const text = String(fd.get("text") ?? "").trim(); if (!text) return;
  const kind = ["log", "decision", "contact"].includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "log";
  await db().from("erp_events").insert({ activation_id: a.id, person_id: s.person?.id ?? null, kind, text: text.slice(0, 2000) });
  revalidatePath("/erp/activate");
}

export async function tickAction(fd: FormData) {
  const s = await me(); const a = await inScope(s, String(fd.get("id")));
  if (a.status !== "open") throw new Error("This activation is closed.");
  const ref = String(fd.get("ref") ?? ""), text = String(fd.get("text") ?? "");
  const { data: done } = await db().from("erp_events").select("id").eq("activation_id", a.id).eq("kind", "check").eq("ref", ref).limit(1);
  if ((done ?? []).length) return;
  await db().from("erp_events").insert({ activation_id: a.id, person_id: s.person?.id ?? null, kind: "check", text: `Done: ${text}`.slice(0, 2000), ref });
  revalidatePath("/erp/activate");
}

export async function closeActivation(fd: FormData) {
  const s = await me(); const a = await inScope(s, String(fd.get("id")));
  const summary = String(fd.get("summary") ?? "").trim();
  if (!summary) throw new Error("Write a short closing summary.");
  await db().from("erp_events").insert({ activation_id: a.id, person_id: s.person?.id ?? null, kind: "status", text: `Closed by ${s.name}: ${summary}`.slice(0, 2000) });
  await db().from("erp_activations").update({ status: "closed", closed_at: new Date().toISOString(), closed_by: s.person?.id ?? null, summary }).eq("id", a.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "erp").eq("ref_id", a.id).eq("status", "open");
  if (a.exercise) await db().from("erp_exercises").insert({ entity: a.entity, held_on: new Date().toISOString().slice(0, 10), kind: "drill", scenario: a.title, lessons: summary, status: "done" });
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: a.entity, object_type: "erp_activation", object_id: a.id, action: "erp_activation_closed", after: { summary } });
  revalidatePath("/erp/activate"); revalidatePath("/erp/exer"); revalidatePath("/home/tasks");
  redirect("/erp/activate");
}
