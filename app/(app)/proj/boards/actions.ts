"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { addDays, routeFor, syncTasks, today, type AuthorityFile, type FileType } from "@/lib/authority";
import { instantiate, openFileForProjectTask, type Phase, type Project, type ProjectTemplate, type Task, type TaskStatus, type TemplateTask } from "@/lib/projects";
import { openDraft } from "@/lib/revisions-server";
import { daysBetween, standbyProjectFiles } from "@/lib/authority";

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

/** Opens now the authority file a task calls for (S.A.M. does it by itself once the task's dependencies are done). */
export async function openFileForTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const task = await taskOf(db, p, str(formData, "task_id")); if (!task || !mayWork(s, cmm, owner, task)) return;
  const f = await openFileForProjectTask(db, { personId: s.person?.id ?? null, name: s.name }, p, task, "Opened from the project");
  if (!f) throw new Error(`Could not open an authority file of type ${task.link_ref}`);
  await audit(db, s, p, "task_file_opened", { task: task.title, file: f.id });
  paths(p.id); revalidatePath(`/proj/auth/${f.id}`);
  redirect(`/proj/auth/${f.id}`);
}
/** Opens now the draft of the manual a task calls for. */
export async function startDraftForTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const task = await taskOf(db, p, str(formData, "task_id")); if (!task || !mayWork(s, cmm, owner, task) || task.link_kind !== "manual" || !task.link_ref) return;
  const { data: m } = await db.from("manuals").select("id").eq("entity", p.entity).eq("code", task.link_ref).maybeSingle();
  if (!m) throw new Error(`No manual ${task.link_ref} in ${p.entity}`);
  const d = await openDraft(db, (m as { id: string }).id, { personId: s.person?.id ?? null, name: s.name }, `Project: ${p.title}`);
  if (!d) throw new Error("No revision to start from");
  await db.from("project_tasks").update({ link_id: d.id, status: "in_progress", started_at: task.started_at ?? today(), updated_at: new Date().toISOString() }).eq("id", task.id);
  paths(p.id); revalidatePath(`/docs/manual/${(m as { id: string }).id}`); revalidatePath("/docs/drafts");
  redirect(`/docs/editor/${d.id}`);
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

const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
/**
 * Lessons learned → template: the project's phases and tasks, as they really ran, become the template (update the one it came
 * from, or a new one). Durations: the real duration of done tasks when known, else the planned days. "Not needed" tasks are kept
 * (another project may need them). Compliance only.
 */
export async function pushToTemplate(formData: FormData) {
  const { s, db, p, cmm } = await guard(str(formData, "id"));
  if (!cmm) throw new Error("Compliance only");
  const mode = str(formData, "mode");
  const code = (mode === "new" ? str(formData, "code") : p.template_code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!code) throw new Error(mode === "new" ? "A code is required for the new template" : "This project was not opened from a template: save it as a new one.");
  const [{ data: phData }, { data: tData }] = await Promise.all([db.from("project_phases").select("*").eq("project_id", p.id).order("ord"), db.from("project_tasks").select("*").eq("project_id", p.id).order("ord")]);
  const phases = (phData ?? []) as Phase[]; const tasks = (tData ?? []) as Task[];
  const { data: dData } = tasks.length ? await db.from("project_task_deps").select("*").in("task_id", tasks.map((t) => t.id)) : { data: [] };
  const deps = (dData ?? []) as { task_id: string; depends_on: string }[];
  const phaseKey = new Map(phases.map((ph) => [ph.id, ph.key || slug(ph.label)]));
  const used = new Set<string>(); const keyOf = new Map<string, string>();
  for (const t of tasks) { let k = t.key || slug(t.title) || "t"; while (used.has(k)) k += "_"; used.add(k); keyOf.set(t.id, k); }
  const tplTasks: TemplateTask[] = tasks.map((t) => {
    const real = t.status === "done" && t.started_at && t.done_at ? daysBetween(t.started_at, t.done_at) : null;
    const x: TemplateTask = { key: keyOf.get(t.id)!, phase: phaseKey.get(t.phase_id ?? "") ?? phaseKey.get(phases[0]?.id ?? "") ?? "tasks", title: t.title, owner_role: t.owner_role, days: real && real > 0 ? real : t.days ?? null, deps: deps.filter((d) => d.task_id === t.id).map((d) => keyOf.get(d.depends_on)!).filter(Boolean) };
    if (t.link_kind) x.link_kind = t.link_kind; if (t.link_ref) x.link_ref = t.link_ref; if (t.detail) x.detail = t.detail; if (t.source) x.source = t.source;
    return x;
  });
  const { data: before } = await db.from("project_templates").select("*").eq("code", code).maybeSingle();
  const prev = (before as ProjectTemplate | null) ?? null;
  const row = { code, name: mode === "new" ? str(formData, "name") || code : prev?.name ?? code, description: prev?.description ?? p.description ?? null, entities: prev?.entities ?? [p.entity], phases: phases.map((ph) => ({ key: phaseKey.get(ph.id)!, label: ph.label })), tasks: tplTasks, pivots: prev?.pivots ?? Object.keys(p.pivot ?? {}), active: true, ord: prev?.ord ?? 99 };
  const { error } = prev ? await db.from("project_templates").update(row).eq("code", code) : await db.from("project_templates").insert(row);
  if (error) throw new Error(error.message);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: p.entity, object_type: "project_template", object_id: code, action: prev ? "template_updated_from_project" : "template_created_from_project", before: prev, after: { ...row, project: p.id } });
  await audit(db, s, p, "lessons_to_template", { code, tasks: tplTasks.length });
  revalidatePath("/ref/ptpl"); revalidatePath("/proj/boards/new"); paths(p.id);
  redirect(`/ref/ptpl?edit=${code}#${code}`);
}

async function taskOf(db: Db, p: Project, taskId: string): Promise<Task | null> {
  const { data } = await db.from("project_tasks").select("*").eq("id", taskId).eq("project_id", p.id).maybeSingle();
  return (data as Task | null) ?? null;
}
/** The tick: done ↔ back to in progress. */
export async function tickTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const task = await taskOf(db, p, str(formData, "task_id")); if (!task || !mayWork(s, cmm, owner, task)) return;
  const done = task.status !== "done";
  await db.from("project_tasks").update(done ? { status: "done", done_at: today(), done_by: s.person?.id ?? null, started_at: task.started_at ?? today(), updated_at: new Date().toISOString() } : { status: "in_progress", done_at: null, done_by: null, updated_at: new Date().toISOString() }).eq("id", task.id);
  await audit(db, s, p, done ? "task_done" : "task_reopened", { task: task.title });
  paths(p.id); revalidatePath("/home/tasks");
}
/** Start by hand (it also starts by itself when a linked object is touched or a document is attached). */
export async function startTask(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const task = await taskOf(db, p, str(formData, "task_id")); if (!task || !mayWork(s, cmm, owner, task) || task.status !== "todo") return;
  await db.from("project_tasks").update({ status: "in_progress", started_at: task.started_at ?? today(), updated_at: new Date().toISOString() }).eq("id", task.id);
  paths(p.id); revalidatePath("/home/tasks");
}
/** A document produced outside S.A.M. (contract, PPI report, form, evidence) attached to the task; the task starts if it had not. */
export async function uploadTaskFile(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  const task = await taskOf(db, p, str(formData, "task_id")); if (!task || !mayWork(s, cmm, owner, task)) throw new Error("Not allowed");
  const file = formData.get("file"); const name = str(formData, "name");
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) throw new Error("File larger than 25 MB: keep it on the server and record its name here.");
    const safe = file.name.replace(/[^\w.\-() ]+/g, "_");
    const key = `${p.entity}/projects/${p.id}/${task.id}/${safe}`;
    const { error } = await db.storage.from("evidence").upload(key, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
    if (error) throw new Error(error.message);
    await db.from("project_task_files").insert({ task_id: task.id, project_id: p.id, name: safe, path: `evidence/${key}`, size: file.size, uploaded_by: s.person?.id ?? null });
  } else if (name) {
    await db.from("project_task_files").insert({ task_id: task.id, project_id: p.id, name, path: null, size: null, uploaded_by: s.person?.id ?? null });
  } else return;
  if (task.status === "todo") await db.from("project_tasks").update({ status: "in_progress", started_at: task.started_at ?? today(), updated_at: new Date().toISOString() }).eq("id", task.id);
  await audit(db, s, p, "task_file_added", { task: task.title, name: name || (file as File).name });
  paths(p.id);
}
export async function removeTaskFile(formData: FormData) {
  const { s, db, p, cmm, owner } = await guard(str(formData, "id"));
  if (!cmm && !owner) throw new Error("Not allowed");
  const { data } = await db.from("project_task_files").select("*").eq("id", str(formData, "file_id")).eq("project_id", p.id).maybeSingle();
  if (!data) return;
  const f = data as { id: string; name: string; path: string | null };
  if (f.path?.startsWith("evidence/")) await db.storage.from("evidence").remove([f.path.slice(9)]);
  await db.from("project_task_files").delete().eq("id", f.id);
  await audit(db, s, p, "task_file_removed", { name: f.name });
  paths(p.id);
}

/** Super admin only: cancel a project (kept, greyed, with its history) or delete it for good (tasks, dependencies, attached documents). */
export async function cancelProject(formData: FormData) {
  const { s, db, p } = await guard(str(formData, "id"));
  if (!s.roles.includes("SUPERADMIN")) throw new Error("Super admin only");
  const reason = opt(formData, "reason");
  await db.from("projects").update({ status: "cancelled", closed_at: today(), lessons: reason ? `Cancelled: ${reason}${p.lessons ? `\n${p.lessons}` : ""}` : p.lessons, updated_at: new Date().toISOString() }).eq("id", p.id);
  await db.from("tasks").update({ status: "superseded" }).eq("status", "open").in("ref_id", [p.id]);
  const standby = await standbyProjectFiles(db, p.id, { name: s.name, personId: s.person?.id ?? null }, `project cancelled${reason ? `: ${reason}` : ""}`); // FB-030
  await audit(db, s, p, "project_cancelled", { reason, files_standby: standby });
  paths(p.id);
}
export async function deleteProject(formData: FormData) {
  const { s, db, p } = await guard(str(formData, "id"));
  if (!s.roles.includes("SUPERADMIN")) throw new Error("Super admin only");
  if (formData.get("confirm") !== "on") throw new Error("Tick the confirmation to delete");
  const { data: fs } = await db.from("project_task_files").select("path").eq("project_id", p.id);
  const keys = ((fs ?? []) as { path: string | null }[]).map((f) => f.path).filter((x): x is string => !!x && x.startsWith("evidence/")).map((x) => x.slice(9));
  if (keys.length) await db.storage.from("evidence").remove(keys);
  const standby = await standbyProjectFiles(db, p.id, { name: s.name, personId: s.person?.id ?? null }, `project “${p.title}” deleted`); // FB-030
  await db.from("authority_files").update({ project_id: null }).eq("project_id", p.id);
  await audit(db, s, p, "project_deleted", { title: p.title, template: p.template_code, files: keys.length, files_standby: standby });
  await db.from("projects").delete().eq("id", p.id);   // phases, tasks, dependencies and attachments follow (on delete cascade)
  paths();
  redirect("/proj/boards");
}
