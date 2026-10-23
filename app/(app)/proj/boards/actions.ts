"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { addDays, routeFor, syncTasks, today, type AuthorityFile, type FileType } from "@/lib/authority";
import { instantiate, type Project, type ProjectTemplate, type Task, type TaskStatus } from "@/lib/projects";

type Db = ReturnType<typeof supabaseAdmin>;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const paths = (id?: string) => { revalidatePath("/proj/boards"); revalidatePath("/proj/rex"); revalidatePath("/proj/auth"); if (id) revalidatePath(`/proj/boards/${id}`); };

async function guard(id: string): Promise<{ s: Session; db: Db; p: Project; cmm: boolean; owner: boolean }> {
  const s = await getSession();
  if (!s) throw new Error("Not signed in");
  const db = supabaseAdmin();
  const { data } = await db.from("projects").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("Project not found");
  const p = data as Project;
  if (!s.group && !s.entities.includes(p.entity)) throw new Error("Out of scope");
  const cmm = isCmm(s);
  const owner = p.owner_person ? s.person?.id === p.owner_person : !!p.owner_role && s.roles.map(basePost).includes(basePost(p.owner_role));
  return { s, db, p, cmm, owner };
}
async function audit(db: Db, s: Session, p: Project, action: string, after: unknown) {
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: p.entity, object_type: "project", object_id: p.id, action, after });
}
/** A task may be worked by the project owner, Compliance, or the holder (or deputy) of the task's post. */
function mayWork(s: Session, cmm: boolean, owner: boolean, t: Task): boolean {
  if (cmm || owner) return true;
  if (t.owner_person) return s.person?.id === t.owner_person;
  return !!t.owner_role && s.roles.map(basePost).includes(basePost(t.owner_role));
}

/** New project: blank, or every phase and task of a template (dependencies kept). Any office role may open one. */
export async function createProject(formData: FormData) {
  const s = await getSession();
  if (!s || s.role === "user") throw new Error("Not allowed");
  const entity = str(formData, "entity");
  if (!s.group && !s.entities.includes(entity)) throw new Error("Out of scope");
  const db = supabaseAdmin();
  const code = opt(formData, "template_code");
  const { data: t } = code ? await db.from("project_templates").select("*").eq("code", code).maybeSingle() : { data: null };
  const tpl = (t as ProjectTemplate | null) ?? null;
  const pivot: Record<string, string> = {};
  for (const k of ["aircraft_type", "aircraft_reg", "np_post_code"]) { const v = opt(formData, `pivot_${k}`); if (v) pivot[k] = k === "aircraft_reg" || k === "np_post_code" ? v.toUpperCase() : v; }
  const title = str(formData, "title") || (tpl ? `${tpl.name}${pivot.aircraft_type ? ` — ${pivot.aircraft_type}` : ""}${pivot.aircraft_reg ? ` ${pivot.aircraft_reg}` : ""}${pivot.np_post_code ? ` — ${pivot.np_post_code}` : ""}` : "New project");
  const row = { entity, template_code: tpl?.code ?? null, title, description: opt(formData, "description") ?? tpl?.description ?? null, owner_role: opt(formData, "owner_role") ?? "CMM", owner_person: formData.get("owner_me") === "on" ? s.person?.id ?? null : null,
    pivot, started_at: opt(formData, "started_at") ?? today(), target_date: opt(formData, "target_date"), created_by: s.person?.id ?? null };
  const { data: created, error } = await db.from("projects").insert(row).select("*").single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the project");
  const p = created as Project;
  let n = 0;
  if (tpl) n = await instantiate(db, p.id, tpl);
  else await db.from("project_phases").insert([{ project_id: p.id, ord: 1, key: "todo", label: "Tasks" }]);
  await audit(db, s, p, "project_created", { ...row, tasks: n });
  paths(p.id);
  redirect(`/proj/boards/${p.id}`);
}

export async function saveProject(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  if (!cmm && !owner) throw new Error("Not allowed");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "description", "owner_role", "target_date", "started_at", "lessons"]) if (formData.has(k)) patch[k] = opt(formData, k);
  if (formData.has("status")) {
    const st = str(formData, "status");
    if (["open", "on_hold", "closed"].includes(st)) { patch.status = st; patch.closed_at = st === "closed" ? today() : null; }
  }
  const pivot = { ...(p.pivot ?? {}) };
  for (const k of ["aircraft_type", "aircraft_reg", "np_post_code"]) if (formData.has(`pivot_${k}`)) { const v = opt(formData, `pivot_${k}`); if (v) pivot[k] = v; else delete pivot[k]; }
  patch.pivot = pivot;
  await db.from("projects").update(patch).eq("id", p.id);
  await audit(db, s, p, "project_updated", patch);
  paths(p.id);
}

export async function addPhase(formData: FormData) {
  const { db, p, cmm, owner } = await guard(str(formData, "id"));
  if (!cmm && !owner) throw new Error("Not allowed");
  const label = str(formData, "label"); if (!label) return;
  const { count } = await db.from("project_phases").select("id", { count: "exact", head: true }).eq("project_id", p.id);
  await db.from("project_phases").insert({ project_id: p.id, ord: (count ?? 0) + 1, key: `p${Date.now().toString(36)}`, label });
  paths(p.id);
}

export async function addTask(formData: FormData) {
  const { db, p, cmm, owner } = await guard(str(formData, "id"));
  if (!cmm && !owner) throw new Error("Not allowed");
  const title = str(formData, "title"); if (!title) return;
  const { count } = await db.from("project_tasks").select("id", { count: "exact", head: true }).eq("project_id", p.id);
  const link = opt(formData, "link_kind");
  const row = { project_id: p.id, phase_id: opt(formData, "phase_id"), ord: (count ?? 0) + 1, key: `t${Date.now().toString(36)}`, title, owner_role: opt(formData, "owner_role")?.toUpperCase() ?? null, days: str(formData, "days") ? Number(str(formData, "days")) : null, due: opt(formData, "due"),
    link_kind: link && ["manual", "authority_file", "certificate", "moc"].includes(link) ? link : null, link_ref: opt(formData, "link_ref")?.toUpperCase() ?? null };
  const { data: created } = await db.from("project_tasks").insert(row).select("id").single();
  const deps = formData.getAll("depends_on").map(String).filter(Boolean);
  if (created && deps.length) await db.from("project_task_deps").insert(deps.map((d) => ({ task_id: (created as { id: string }).id, depends_on: d })));
  paths(p.id);
}

/** Status, owner, dates, note, dependencies of one task. "Not needed" needs a reason (kept for the authority, as in Monday). */
export async function updateTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const taskId = str(formData, "task_id");
  const { data: t } = await db.from("project_tasks").select("*").eq("id", taskId).eq("project_id", p.id).maybeSingle();
  if (!t) return;
  const task = t as Task;
  if (!mayWork(s, cmm, owner, task)) throw new Error("Not allowed");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (formData.has("status")) {
    const st = str(formData, "status") as TaskStatus;
    if (["todo", "in_progress", "waiting", "blocked", "done", "not_needed"].includes(st)) {
      patch.status = st;
      if (st === "done") { patch.done_at = opt(formData, "done_at") ?? today(); patch.done_by = s.person?.id ?? null; }
      else if (task.status === "done") { patch.done_at = null; patch.done_by = null; }
      if (st === "in_progress" && !task.started_at) patch.started_at = today();
      if (st === "not_needed") { const why = opt(formData, "not_needed_reason"); if (!why) throw new Error("Say why this task is not needed for this project."); patch.not_needed_reason = why; }
      else patch.not_needed_reason = null;
    }
  }
  if (cmm || owner) {
    for (const k of ["title", "detail", "owner_role", "due", "days", "note", "link_ref", "phase_id"]) if (formData.has(k)) patch[k] = k === "days" ? (str(formData, k) ? Number(str(formData, k)) : null) : k === "owner_role" || k === "link_ref" ? opt(formData, k)?.toUpperCase() ?? null : opt(formData, k);
    if (formData.has("link_kind")) { const lk = opt(formData, "link_kind"); patch.link_kind = lk && ["manual", "authority_file", "certificate", "moc"].includes(lk) ? lk : null; if (!patch.link_kind) patch.link_id = null; }
    if (formData.has("deps_edit")) {
      const deps = formData.getAll("depends_on").map(String).filter((d) => d && d !== taskId);
      await db.from("project_task_deps").delete().eq("task_id", taskId);
      if (deps.length) await db.from("project_task_deps").insert(deps.map((d) => ({ task_id: taskId, depends_on: d })));
    }
  } else if (formData.has("note")) patch.note = opt(formData, "note");
  await db.from("project_tasks").update(patch).eq("id", taskId);
  if (patch.status) await audit(db, s, p, `task_${patch.status}`, { task: task.title, reason: patch.not_needed_reason ?? null });
  paths(p.id);
}

export async function deleteTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  if (!cmm && !owner) throw new Error("Not allowed");
  const taskId = str(formData, "task_id");
  const { data: t } = await db.from("project_tasks").select("title,link_id").eq("id", taskId).eq("project_id", p.id).maybeSingle();
  if (!t) return;
  await db.from("project_tasks").delete().eq("id", taskId);
  await audit(db, s, p, "task_deleted", t);
  paths(p.id);
}

/** Opens the authority file a task calls for, pre-filled from the task's type and the project's pivots, and binds it to the task. */
export async function openFileForTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const taskId = str(formData, "task_id");
  const { data: t } = await db.from("project_tasks").select("*").eq("id", taskId).eq("project_id", p.id).maybeSingle();
  if (!t) return;
  const task = t as Task;
  if (!mayWork(s, cmm, owner, task) || task.link_kind !== "authority_file" || task.link_id) return;
  const { data: ty } = await db.from("authority_file_types").select("*").eq("code", task.link_ref ?? "").maybeSingle();
  if (!ty) throw new Error(`Unknown authority file type ${task.link_ref}`);
  const type = ty as FileType;
  const route = routeFor(type, p.entity);
  const pivotTxt = [p.pivot?.aircraft_type, p.pivot?.aircraft_reg, p.pivot?.np_post_code].filter(Boolean).join(" ");
  const row = { entity: p.entity, type_code: type.code, title: `${task.title}${pivotTxt ? ` — ${pivotTxt}` : ""}`, stage: "draft", category: route.category, authority: route.authority, portal: route.portal,
    owner_role: task.owner_role ?? type.default_owner_role ?? "CMM", trigger_kind: "other", trigger_note: `Project: ${p.title}`, aircraft_reg: p.pivot?.aircraft_reg ?? null, np_post_code: p.pivot?.np_post_code ?? null,
    project_id: p.id, triggered_at: today(), target_date: addDays(today(), type.target_days + 14), created_by: s.person?.id ?? null };
  const { data: created, error } = await db.from("authority_files").insert(row).select("*").single();
  if (error || !created) throw new Error(error?.message ?? "Could not open the file");
  const f = created as AuthorityFile;
  if (type.checklist?.length) await db.from("authority_file_items").insert(type.checklist.map((c, i) => ({ file_id: f.id, ord: i + 1, key: c.key, label: c.label, role: c.role ?? null, required: c.required !== false })));
  await db.from("authority_file_events").insert({ file_id: f.id, kind: "created", who: s.name, actor: s.person?.id ?? null, note: `Opened from project “${p.title}” (task: ${task.title})`, meta: { project_id: p.id, task_id: task.id } });
  await db.from("project_tasks").update({ link_id: f.id, status: task.status === "todo" ? "in_progress" : task.status, started_at: task.started_at ?? today(), updated_at: new Date().toISOString() }).eq("id", task.id);
  await syncTasks(db, f);
  await audit(db, s, p, "task_file_opened", { task: task.title, file: f.id });
  paths(p.id); revalidatePath(`/proj/auth/${f.id}`);
  redirect(`/proj/auth/${f.id}`);
}

/** Binds a task to an authority file that already exists (opened from the editor or by hand). */
export async function bindFileToTask(formData: FormData) {
  const { db, p, cmm, owner } = await guard(str(formData, "id"));
  if (!cmm && !owner) throw new Error("Not allowed");
  const taskId = str(formData, "task_id"); const fileId = str(formData, "file_id");
  const { data: f } = await db.from("authority_files").select("id,entity,stage").eq("id", fileId).maybeSingle();
  if (!f || (f as { entity: string }).entity !== p.entity) return;
  const done = ["approved", "published", "closed"].includes((f as { stage: string }).stage);
  await db.from("project_tasks").update({ link_kind: "authority_file", link_id: fileId, status: done ? "done" : "in_progress", done_at: done ? today() : null, updated_at: new Date().toISOString() }).eq("id", taskId).eq("project_id", p.id);
  await db.from("authority_files").update({ project_id: p.id }).eq("id", fileId).is("project_id", null);
  paths(p.id);
}
