// The Inbox list of one person (tasks addressed to them, their posts, deputies included, and their project tasks ready to start).
// Shared by Home › Inbox and Home › Morning coffee.
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { basePost, type Session } from "@/lib/session";
import { OPEN, project as projectDates, type Dep, type Project, type Task as PTask } from "@/lib/projects";

export type InboxItem = { id: string; title: string; detail: string | null; due: string | null; entity: string; kind: string; status: string; link: string | null; owner_person: string | null; owner_role: string | null; ctx?: string; ctxLink?: string };

/** What each item is, at a glance (label + colour), whatever module created it. */
export const KIND: Record<string, [string, string]> = {
  project: ["Project", "k-proj"], authority: ["CAA application", "k-auth"], authority_followup: ["Authority follow-up", "k-auth"],
  reading: ["Read & acknowledge", "k-read"], certificate_validity: ["Validity", "k-cert"], finding: ["Finding", "k-comp"], action: ["Action", "k-comp"], action_verify: ["Verify action", "k-safe"], action_effectiveness: ["Action effectiveness", "k-safe"],
  check: ["Compliance check", "k-comp"], change_request: ["Change request", "k-docs"], signature: ["Signature", "k-docs"], status_review: ["Status review", "k-comp"],
  safety_report: ["Safety report", "k-safe"], safety_question: ["Safety question", "k-safe"], mitigation: ["Mitigation", "k-safe"], risk_acceptance: ["Risk acceptance", "k-safe"], risk_review: ["Risk review", "k-safe"], risk_intolerable: ["Intolerable risk", "k-comp"], committee_minutes: ["Committee minutes", "k-safe"],
};
export const kindLabel = (k: string) => KIND[k]?.[0] ?? k.replace(/_/g, " ");

export async function myInbox(s: Session): Promise<InboxItem[]> {
  const sb = await supabaseServer();
  // my items: addressed to me by name, or to one of my posts (holders and deputies), or to nobody in particular
  let q = sb.from("tasks").select("id,title,detail,due,entity,kind,status,link,owner_person,owner_role").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(200);
  if (s.entity !== "ALL") q = q.eq("entity", s.entity);
  const { data } = await q;
  const posts = new Set(s.roles.map(basePost));
  const tasks: InboxItem[] = ((data ?? []) as InboxItem[]).filter((t) => t.owner_person ? t.owner_person === s.person?.id : t.owner_role ? posts.has(basePost(t.owner_role)) : true).slice(0, 100);
  // project tasks (PRJ-02): mine, open, with no open dependency — due = projected end
  const admin = supabaseAdmin();
  let pq = admin.from("projects").select("*").eq("status", "open");
  pq = s.entity === "ALL" ? pq.in("entity", s.entities) : pq.eq("entity", s.entity);
  const { data: pData } = await pq;
  const projects = (pData ?? []) as Project[];
  if (projects.length) {
    const { data: ptData } = await admin.from("project_tasks").select("*").in("project_id", projects.map((p) => p.id)).in("status", OPEN);
    const ptasks = (ptData ?? []) as PTask[];
    const { data: dData } = ptasks.length ? await admin.from("project_task_deps").select("*").in("task_id", ptasks.map((t) => t.id)) : { data: [] };
    const deps = (dData ?? []) as Dep[];
    // the projection needs every task of the project (done ones end the chains): load them too
    const { data: allData } = await admin.from("project_tasks").select("*").in("project_id", projects.map((p) => p.id));
    const all = (allData ?? []) as PTask[];
    for (const p of projects) {
      const proj = projectDates(all.filter((t) => t.project_id === p.id), deps, p.started_at);
      for (const t of ptasks.filter((t) => t.project_id === p.id && t.link_kind !== "authority_file")) {
        const mine = t.owner_person ? t.owner_person === s.person?.id : t.owner_role ? posts.has(basePost(t.owner_role)) : (p.owner_person ? p.owner_person === s.person?.id : !!p.owner_role && posts.has(basePost(p.owner_role)));
        if (!mine || proj.get(t.id)?.openDeps.length) continue;
        tasks.push({ id: t.id, title: t.title, ctx: p.title, ctxLink: `/proj/boards/${p.id}`, detail: t.status === "blocked" ? "blocked" : t.status === "waiting" ? "waiting" : null, due: t.status === "waiting" ? null : proj.get(t.id)?.end ?? null, entity: p.entity, kind: "project", status: "open", link: `/proj/boards/${p.id}`, owner_person: t.owner_person, owner_role: t.owner_role });
      }
    }
    tasks.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
  }
  return tasks;
}

/**
 * One line per project instead of one line per task: the project's title, how many of its tasks wait for me,
 * how many are late, and the next one. Other items are left as they are. The list stays sorted by due date.
 */
export function groupProjects(items: InboxItem[], today: string): InboxItem[] {
  const out: InboxItem[] = []; const by = new Map<string, InboxItem[]>();
  for (const t of items) {
    if (t.kind !== "project" || !t.ctxLink) { out.push(t); continue; }
    if (!by.has(t.ctxLink)) by.set(t.ctxLink, []);
    by.get(t.ctxLink)!.push(t);
  }
  for (const [link, ts] of by) {
    ts.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
    const late = ts.filter((t) => t.due && t.due < today).length;
    const blocked = ts.filter((t) => t.detail === "blocked").length;
    const parts = [`${ts.length} task${ts.length > 1 ? "s" : ""} for you`, late && `${late} late`, blocked && `${blocked} blocked`, `next: ${ts[0].title}`].filter(Boolean);
    out.push({ ...ts[0], id: "proj:" + link, title: ts[0].ctx ?? "Project", ctx: undefined, ctxLink: undefined, link, detail: parts.join(" · ") });
  }
  // FB-040 · safety actions: from 3 per entity, one line (count, late, next two) that opens the Actions list — never a wall of actions
  const acts = new Map<string, InboxItem[]>();
  const rest: InboxItem[] = [];
  for (const t of out) { if (t.kind === "action") { if (!acts.has(t.entity)) acts.set(t.entity, []); acts.get(t.entity)!.push(t); } else rest.push(t); }
  for (const [entity, ts] of acts) {
    if (ts.length < 3) { rest.push(...ts); continue; }
    ts.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
    const late = ts.filter((t) => t.due && t.due < today).length;
    const next = ts.slice(0, 2).map((t) => t.title.replace(/^[A-Z]+-\d+\s+—\s+/, "")).join(" · ");
    const parts = [`${ts.length} actions for you`, late && `${late} late`, `next: ${next}`].filter(Boolean);
    rest.push({ ...ts[0], id: "acts:" + entity, title: "Safety actions", ctx: undefined, ctxLink: undefined, link: `/safe/actions?mine=1`, detail: parts.join(" · ") });
  }
  return rest.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
}
