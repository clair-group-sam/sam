import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, routeFor, syncTasks, today, type AuthorityFile, type FileType } from "@/lib/authority";
import { openDraft } from "@/lib/revisions-server";

/** PRJ-02 · Projects: any objective broken into phases and tasks, orchestrating the objects S.A.M. already tracks. */
export type TemplateTask = { key: string; phase: string; title: string; owner_role?: string | null; days?: number | null; deps?: string[]; link_kind?: LinkKind; link_ref?: string; detail?: string; source?: string };
export type ProjectTemplate = { code: string; name: string; description: string | null; entities: string[]; phases: { key: string; label: string }[]; tasks: TemplateTask[]; pivots: string[]; active: boolean; ord: number };
export type ProjectStatus = "open" | "on_hold" | "closed" | "cancelled";
export type Project = { id: string; entity: string; template_code: string | null; title: string; description: string | null; owner_role: string | null; owner_person: string | null; status: ProjectStatus; pivot: Record<string, string>; started_at: string; target_date: string | null; closed_at: string | null; lessons: string | null; created_by: string | null; created_at: string; updated_at: string };
export type Phase = { id: string; project_id: string; ord: number; key: string | null; label: string };
export type TaskStatus = "todo" | "in_progress" | "waiting" | "blocked" | "done" | "not_needed";
export type LinkKind = "manual" | "authority_file" | "certificate" | "moc";
export type Task = { id: string; project_id: string; phase_id: string | null; ord: number; key: string | null; title: string; detail: string | null; source: string | null; owner_role: string | null; owner_person: string | null; status: TaskStatus; not_needed_reason: string | null; days: number | null; due: string | null; started_at: string | null; done_at: string | null; done_by: string | null; link_kind: LinkKind | null; link_ref: string | null; link_id: string | null; note: string | null; created_at: string; updated_at: string };
export type Dep = { task_id: string; depends_on: string };
export type TaskFile = { id: string; task_id: string; project_id: string; name: string; path: string | null; size: number | null; uploaded_by: string | null; at: string };

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", waiting: "Waiting", blocked: "Blocked", done: "Done", not_needed: "Not needed" };
export const STATUS_TONE: Record<TaskStatus, string> = { todo: "", in_progress: "amber", waiting: "", blocked: "red", done: "green", not_needed: "" };
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { open: "Open", on_hold: "On hold", closed: "Closed", cancelled: "Cancelled" };
export const LINK_LABEL: Record<LinkKind, string> = { manual: "Manual revision", authority_file: "Authority file", certificate: "Certificate", moc: "MOC / risk assessment" };
export const PIVOT_LABEL: Record<string, string> = { aircraft_type: "Aircraft type", aircraft_reg: "Registration", np_post_code: "Nominated post" };
export const OPEN: TaskStatus[] = ["todo", "in_progress", "waiting", "blocked"];
/** FB-003 · a conditional line of a template ("If the aircraft leaves the French AOC…", "Only if a simulator is used"). */
export const isConditional = (t: { title: string; detail?: string | null }) => /^\s*(if|only if|when|unless|in case|si|seulement si)\b/i.test(t.title) || /^\s*\(?(if|only if|conditional)\b/i.test(t.detail ?? "");

export async function loadTemplates(db: SupabaseClient): Promise<ProjectTemplate[]> {
  const { data } = await db.from("project_templates").select("*").eq("active", true).order("ord");
  return (data ?? []) as ProjectTemplate[];
}
export async function loadProject(db: SupabaseClient, id: string): Promise<{ project: Project; phases: Phase[]; tasks: Task[]; deps: Dep[]; files: TaskFile[] } | null> {
  const { data: p } = await db.from("projects").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  const [{ data: phases }, { data: tasks }] = await Promise.all([
    db.from("project_phases").select("*").eq("project_id", id).order("ord"),
    db.from("project_tasks").select("*").eq("project_id", id).order("ord"),
  ]);
  const ids = ((tasks ?? []) as Task[]).map((t) => t.id);
  const [{ data: deps }, { data: files }] = await Promise.all([
    ids.length ? db.from("project_task_deps").select("*").in("task_id", ids) : Promise.resolve({ data: [] }),
    db.from("project_task_files").select("*").eq("project_id", id).order("at"),
  ]);
  return { project: p as Project, phases: (phases ?? []) as Phase[], tasks: (tasks ?? []) as Task[], deps: (deps ?? []) as Dep[], files: (files ?? []) as TaskFile[] };
}

/**
 * Projected dates: a task starts when all its dependencies are done (their done date, else their projected end), or at the
 * project start; it ends `days` later. A due date set by hand wins. Returns per task: start, end, late, blocking (open deps).
 */
export type Projection = { start: string; end: string; late: boolean; openDeps: string[]; critical: boolean };
export function project(tasks: Task[], deps: Dep[], startedAt: string): Map<string, Projection> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depsOf = new Map<string, string[]>();
  for (const d of deps) depsOf.set(d.task_id, [...(depsOf.get(d.task_id) ?? []), d.depends_on]);
  const out = new Map<string, Projection>();
  const t0 = today();
  const visiting = new Set<string>();
  const visit = (id: string): Projection => {
    const got = out.get(id); if (got) return got;
    const t = byId.get(id)!;
    if (visiting.has(id)) { const p = { start: startedAt, end: startedAt, late: false, openDeps: [], critical: false }; out.set(id, p); return p; } // cycle guard
    visiting.add(id);
    let start = startedAt; const openDeps: string[] = [];
    for (const dId of depsOf.get(id) ?? []) {
      const d = byId.get(dId); if (!d) continue;
      const dp = visit(dId);
      const dEnd = d.status === "done" ? (d.done_at ?? dp.end) : d.status === "not_needed" ? startedAt : dp.end;
      if (dEnd > start) start = dEnd;
      if (d.status !== "done" && d.status !== "not_needed") openDeps.push(dId);
    }
    if (t.started_at && t.started_at < start) start = t.started_at;
    // FB-016 · a task nobody has started yet cannot be late by projection alone: its projected start slides to today.
    // "Late" then means: a due date set by hand has passed, or a task that WAS started has run past its duration.
    if (t.status === "todo" && !t.started_at && !openDeps.length && start < t0) start = t0;
    const end = t.status === "done" ? (t.done_at ?? start) : t.due ?? addDays(start, Math.max(0, t.days ?? 1));
    const late = t.status !== "done" && t.status !== "not_needed" && end < t0;
    const p = { start, end, late, openDeps, critical: false };
    out.set(id, p); visiting.delete(id);
    return p;
  };
  for (const t of tasks) visit(t.id);
  // critical path: the open task(s) ending last, and their chain of dependencies
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "not_needed");
  const lastEnd = open.reduce((m, t) => (out.get(t.id)!.end > m ? out.get(t.id)!.end : m), "");
  const mark = (id: string) => { const p = out.get(id); if (!p || p.critical) return; p.critical = true; const t = byId.get(id)!; const ds = (depsOf.get(id) ?? []).filter((d) => byId.get(d) && byId.get(d)!.status !== "done" && byId.get(d)!.status !== "not_needed"); let best: string | null = null; for (const d of ds) if (!best || out.get(d)!.end > out.get(best)!.end) best = d; if (best) mark(best); void t; };
  for (const t of open) if (out.get(t.id)!.end === lastEnd) mark(t.id);
  return out;
}
export function progress(tasks: Task[]): { done: number; total: number; pct: number } {
  const counted = tasks.filter((t) => t.status !== "not_needed");
  const done = counted.filter((t) => t.status === "done").length;
  return { done, total: counted.length, pct: counted.length ? Math.round((100 * done) / counted.length) : 0 };
}
export function projectedEnd(tasks: Task[], proj: Map<string, Projection>): string | null {
  let m: string | null = null;
  for (const t of tasks) if (t.status !== "done" && t.status !== "not_needed") { const e = proj.get(t.id)?.end ?? null; if (e && (!m || e > m)) m = e; }
  return m;
}

export type Who = { personId: string | null; name: string };
/** Opens the authority file a task calls for — type from the task, aircraft / post from the project — and binds it. */
export async function openFileForProjectTask(db: SupabaseClient, who: Who, p: Project, task: Task, origin: string): Promise<AuthorityFile | null> {
  if (task.link_kind !== "authority_file" || task.link_id) return null;
  const { data: ty } = await db.from("authority_file_types").select("*").eq("code", task.link_ref ?? "").maybeSingle();
  if (!ty) return null;
  const type = ty as FileType;
  const route = routeFor(type, p.entity);
  const pivotTxt = [p.pivot?.aircraft_type, p.pivot?.aircraft_reg, p.pivot?.np_post_code].filter(Boolean).join(" ");
  const row = { entity: p.entity, type_code: type.code, title: `${task.title}${pivotTxt ? ` — ${pivotTxt}` : ""}`, stage: "draft", category: route.category, authority: route.authority, portal: route.portal,
    owner_role: task.owner_role ?? type.default_owner_role ?? "CMM", trigger_kind: "other", trigger_note: `Project: ${p.title}`, aircraft_reg: p.pivot?.aircraft_reg ?? null, np_post_code: p.pivot?.np_post_code ?? null,
    project_id: p.id, triggered_at: today(), target_date: addDays(today(), type.target_days + 14), created_by: who.personId };
  const { data: created, error } = await db.from("authority_files").insert(row).select("*").single();
  if (error || !created) return null;
  const f = created as AuthorityFile;
  if (type.checklist?.length) await db.from("authority_file_items").insert(type.checklist.map((c, i) => ({ file_id: f.id, ord: i + 1, key: c.key, label: c.label, role: c.role ?? null, required: c.required !== false })));
  await db.from("authority_file_events").insert({ file_id: f.id, kind: "created", who: who.name, actor: who.personId, note: `${origin} — project “${p.title}”, task “${task.title}”`, meta: { project_id: p.id, task_id: task.id } });
  await db.from("project_tasks").update({ link_id: f.id, status: task.status === "todo" ? "in_progress" : task.status, started_at: task.started_at ?? today(), updated_at: new Date().toISOString() }).eq("id", task.id);
  await syncTasks(db, f);
  return f;
}

/**
 * Lazy linking: a task that names a manual code is bound to the first revision of that manual started after the project,
 * and a certificate task to the certificate of the pivot aircraft (or of the organisation) of that kind. Done when the object
 * reaches its final state. Returns the tasks with their live status; writes the link back when it is found.
 */
export type LiveLink = { label: string; href: string; state: string; tone: string };
export async function resolveLinks(db: SupabaseClient, p: Project, tasks: Task[], auto?: { ready: Set<string>; who: Who }): Promise<Map<string, LiveLink>> {
  const out = new Map<string, LiveLink>();
  const automate = !!auto && p.status === "open";
  // S.A.M. opens by itself what a ready task calls for: the draft of the manual, the authority file with its checklist
  if (automate) {
    for (const t of tasks) {
      if (t.status !== "todo" || !auto!.ready.has(t.id)) continue;
      if (isConditional(t)) continue; // FB-003 · "If the aircraft leaves…": a human decides (open now / not needed), S.A.M. never opens it alone
      if (t.link_kind === "authority_file" && !t.link_id) { const f = await openFileForProjectTask(db, auto!.who, p, t, "Opened by S.A.M."); if (f) { t.link_id = f.id; t.status = "in_progress"; } }
      if (t.link_kind === "manual" && t.link_ref) {
        const { data: m } = await db.from("manuals").select("id").eq("entity", p.entity).eq("code", t.link_ref).maybeSingle();
        if (m) { const d = await openDraft(db, (m as { id: string }).id, auto!.who, `Project: ${p.title}`).catch(() => null); if (d) { await db.from("project_tasks").update({ link_id: d.id, status: "in_progress", started_at: t.started_at ?? today(), updated_at: new Date().toISOString() }).eq("id", t.id); t.link_id = d.id; t.status = "in_progress"; } }
      }
    }
  }
  const manualTasks = tasks.filter((t) => t.link_kind === "manual");
  if (manualTasks.length) {
    const codes = [...new Set(manualTasks.map((t) => t.link_ref).filter((x): x is string => !!x))];
    const { data: ms } = await db.from("manuals").select("id,code,title").eq("entity", p.entity).in("code", codes);
    const manuals = (ms ?? []) as { id: string; code: string; title: string }[];
    const ids = manuals.map((m) => m.id);
    const { data: rs } = ids.length ? await db.from("revisions").select("id,manual_id,rev,issue,step,created_at,published_at").in("manual_id", ids).gte("created_at", `${p.started_at}T00:00:00Z`).order("created_at") : { data: [] };
    const revs = (rs ?? []) as { id: string; manual_id: string; rev: string; issue: number; step: string; created_at: string; published_at: string | null }[];
    for (const t of manualTasks) {
      const m = manuals.find((x) => x.code === t.link_ref);
      if (!m) { out.set(t.id, { label: `${t.link_ref} — no such manual in ${p.entity}`, href: `/docs/new?entity=${p.entity}&code=${encodeURIComponent(t.link_ref ?? "")}`, state: "create it", tone: "" }); continue; }
      const r = (t.link_id && revs.find((x) => x.id === t.link_id)) || revs.find((x) => x.manual_id === m.id);
      if (!r) { out.set(t.id, { label: `${m.code} — ${m.title}`, href: `/docs/manual/${m.id}`, state: "no revision started", tone: "" }); continue; }
      if (t.link_id !== r.id) await db.from("project_tasks").update({ link_id: r.id, status: t.status === "todo" ? "in_progress" : t.status, started_at: t.started_at ?? r.created_at.slice(0, 10), updated_at: new Date().toISOString() }).eq("id", t.id);
      const published = r.step === "published" || r.step === "repository";
      if (published && t.status !== "done" && t.status !== "not_needed") await db.from("project_tasks").update({ status: "done", done_at: r.published_at ?? today(), updated_at: new Date().toISOString() }).eq("id", t.id);
      out.set(t.id, { label: `${m.code} Iss ${r.issue} Rev ${r.rev}`, href: published ? `/docs/manual/${m.id}?rev=${r.id}` : `/docs/editor/${r.id}`, state: r.step.replace(/_/g, " "), tone: published ? "green" : "amber" });
    }
  }
  const fileTasks = tasks.filter((t) => t.link_kind === "authority_file");
  if (fileTasks.length) {
    const ids = fileTasks.map((t) => t.link_id).filter((x): x is string => !!x);
    const { data: fs } = ids.length ? await db.from("authority_files").select("id,title,stage,portal_ref,type_code").in("id", ids) : { data: [] };
    const files = (fs ?? []) as { id: string; title: string; stage: string; portal_ref: string | null; type_code: string }[];
    for (const t of fileTasks) {
      const f = files.find((x) => x.id === t.link_id);
      if (!f) { out.set(t.id, { label: `${t.link_ref ?? "authority file"} — not opened yet`, href: "", state: "open the file", tone: "" }); continue; }
      const done = ["approved", "published", "closed"].includes(f.stage);
      out.set(t.id, { label: `${f.type_code} · ${f.portal_ref ?? f.title}`, href: `/proj/auth/${f.id}`, state: f.stage, tone: done ? "green" : f.stage === "remarks" ? "red" : "amber" });
    }
  }
  const certTasks = tasks.filter((t) => t.link_kind === "certificate");
  if (certTasks.length) {
    const reg = p.pivot?.aircraft_reg ?? null;
    const { data: cs } = await db.from("certificates").select("id,kind,registration,title,valid_until").eq("entity", p.entity).in("kind", [...new Set(certTasks.map((t) => t.link_ref ?? ""))]);
    const certs = (cs ?? []) as { id: string; kind: string; registration: string | null; title: string; valid_until: string | null }[];
    for (const t of certTasks) {
      const c = (t.link_id && certs.find((x) => x.id === t.link_id)) || certs.find((x) => x.kind === t.link_ref && (!reg || x.registration === reg));
      if (!c) { out.set(t.id, { label: `${t.link_ref ?? "certificate"}${reg ? ` for ${reg}` : ""} — not filed yet`, href: `/docs/files?entity=${p.entity}`, state: "upload it", tone: "" }); continue; }
      if (t.link_id !== c.id || (t.status !== "done" && t.status !== "not_needed")) await db.from("project_tasks").update({ link_id: c.id, status: "done", done_at: t.done_at ?? today(), updated_at: new Date().toISOString() }).eq("id", t.id);
      out.set(t.id, { label: `${c.title}${c.valid_until ? ` · valid until ${c.valid_until}` : ""}`, href: `/docs/files?entity=${p.entity}`, state: "filed", tone: "green" });
    }
  }
  return out;
}

/** Instantiate a template: phases, tasks and dependencies, in order. Returns the number of tasks created. */
export async function instantiate(db: SupabaseClient, projectId: string, tpl: ProjectTemplate): Promise<number> {
  const phaseIds = new Map<string, string>();
  const phases = tpl.phases.map((ph, i) => ({ project_id: projectId, ord: i + 1, key: ph.key, label: ph.label }));
  const { data: phRows } = await db.from("project_phases").insert(phases).select("id,key");
  for (const r of (phRows ?? []) as { id: string; key: string }[]) phaseIds.set(r.key, r.id);
  const rows = tpl.tasks.map((t, i) => ({ project_id: projectId, phase_id: phaseIds.get(t.phase) ?? null, ord: i + 1, key: t.key, title: t.title, detail: t.detail ?? null, source: t.source ?? null, owner_role: t.owner_role ?? null, days: t.days ?? null, link_kind: t.link_kind ?? null, link_ref: t.link_ref ?? null }));
  const { data: tRows } = await db.from("project_tasks").insert(rows).select("id,key");
  const ids = new Map(((tRows ?? []) as { id: string; key: string }[]).map((r) => [r.key, r.id]));
  const deps: { task_id: string; depends_on: string }[] = [];
  for (const t of tpl.tasks) for (const d of t.deps ?? []) { const a = ids.get(t.key), b = ids.get(d); if (a && b) deps.push({ task_id: a, depends_on: b }); }
  if (deps.length) await db.from("project_task_deps").insert(deps);
  return rows.length;
}

/** Department of a post — tasks are grouped by who does them, not by phase (phases drive the timeline). */
export const DEPARTMENTS = ["Management", "Compliance & Safety", "Flight Operations", "Ground Operations", "Training", "Airworthiness / CAMO", "Other"];
export function departmentOf(role: string | null | undefined): string {
  const r = (role ?? "").toUpperCase().replace(/^(DEPUTY|DEP)[_\s-]+/, "").replace(/[_\s-]+(DEPUTY|DEP|D)$/, "");
  if (["AM", "CEO", "DAM"].includes(r)) return "Management";
  if (["CMM", "SM", "SMD", "QM", "COMPLIANCE", "FSO", "SECMAN", "ISM"].includes(r)) return "Compliance & Safety";
  if (["NPFO", "EFB", "FRM"].includes(r)) return "Flight Operations";
  if (["NPGO"].includes(r)) return "Ground Operations";
  if (["NPCT", "CFI", "HT", "CTKI", "FSTD"].includes(r)) return "Training";
  if (["NPCA", "RE", "RN", "RRO", "CAMO", "MAM", "NPMT"].includes(r)) return "Airworthiness / CAMO";
  return "Other";
}
/** Every task an application depends on, transitively (the work that fills its completion bar). */
export function upstream(taskId: string, deps: Dep[], byId: Map<string, Task>): Task[] {
  const seen = new Set<string>(); const out: Task[] = [];
  const walk = (id: string) => { for (const d of deps.filter((x) => x.task_id === id)) { if (seen.has(d.depends_on)) continue; seen.add(d.depends_on); const t = byId.get(d.depends_on); if (t) { out.push(t); walk(t.id); } } };
  walk(taskId);
  return out;
}
