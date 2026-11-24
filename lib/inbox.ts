// The Inbox list of one person (tasks addressed to them, their posts, deputies included, and their project tasks ready to start).
// Shared by Home › Inbox and the three landing screens.
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { morClock } from "@/lib/safety";
import { basePost, type Session } from "@/lib/session";
import { OPEN, project as projectDates, type Dep, type Project, type Task as PTask } from "@/lib/projects";

export type InboxItem = { id: string; title: string; detail: string | null; due: string | null; entity: string; kind: string; status: string; link: string | null; owner_person: string | null; owner_role: string | null; ctx?: string; ctxLink?: string };

/** What each item is, at a glance (label + colour), whatever module created it. */
export const KIND: Record<string, [string, string]> = {
  project: ["Project", "k-proj"], authority: ["CAA application", "k-auth"], authority_followup: ["Authority follow-up", "k-auth"],
  reading: ["Read & acknowledge", "k-read"], communication: ["Communication", "k-read"], erp: ["ERP", "k-comp"], erp_review: ["ERP review", "k-comp"], erp_exercise: ["ERP exercise", "k-comp"], is_review: ["Part-IS", "k-comp"], certificate_validity: ["Validity", "k-cert"], finding: ["Finding", "k-comp"], finding_review: ["Finding — review", "k-comp"], finding_closure: ["Finding — closure", "k-comp"], escalation: ["Escalation", "k-comp"], watch: ["Regulatory watch", "k-comp"], watch_check: ["Watch check due", "k-comp"], action: ["Action", "k-comp"], action_verify: ["Verify action", "k-safe"], action_effectiveness: ["Action effectiveness", "k-safe"],
  check: ["Compliance check", "k-comp"], change_request: ["Change request", "k-docs"], signature: ["Signature", "k-docs"], status_review: ["Status review", "k-comp"],
  safety_report: ["Safety report", "k-safe"], safety_question: ["Safety question", "k-safe"], mitigation: ["Mitigation", "k-safe"], risk_acceptance: ["Risk acceptance", "k-safe"], risk_review: ["Risk review", "k-safe"], risk_intolerable: ["Intolerable risk", "k-comp"], committee_minutes: ["Committee minutes", "k-safe"], mor_followup: ["MOR 30-day report", "k-safe"], mor_final: ["MOR final report", "k-safe"], investigation: ["Investigation", "k-safe"], todo: ["To do", ""], competency: ["Competency assessment", "k-comp"], competency_due: ["Competency validity", "k-cert"], promo_read: ["Safety promotion", "k-safe"],
};
export const kindLabel = (k: string) => KIND[k]?.[0] ?? k.replace(/_/g, " ");

export async function myInbox(s: Session): Promise<InboxItem[]> {
  const sb = await supabaseServer();
  // my items: addressed to me by name, or to one of my posts (holders and deputies), or to nobody in particular
  let q = sb.from("tasks").select("id,title,detail,due,entity,kind,status,link,owner_person,owner_role").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(200);
  if (s.entity !== "ALL") q = q.eq("entity", s.entity); else if (!s.group) q = q.in("entity", s.entities);
  const { data } = await q;
  const posts = new Set(s.roles.map(basePost));
  const tasks: InboxItem[] = ((data ?? []) as InboxItem[]).filter((t) => t.owner_person ? t.owner_person === s.person?.id : t.owner_role ? posts.has(basePost(t.owner_role)) : true).slice(0, 100)
    // FB-152 · an escalation written "overdue 6 days" at its creation is read with today's count
    .map((t) => (t.kind === "escalation" && /: overdue \d+ days?$/.test(t.title) && /due (\d{4}-\d{2}-\d{2})/.test(t.detail ?? "") ? { ...t, title: t.title.replace(/: overdue \d+ days?$/, `: overdue ${Math.max(0, Math.round((Date.now() - Date.parse(/due (\d{4}-\d{2}-\d{2})/.exec(t.detail ?? "")![1])) / 864e5))} days`) } : t));
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
  // FB-047 · a safety report task carries the live MOR clock: once the 72 h are gone, the line says so instead of "within 72 h"
  const repTasks = tasks.filter((t) => t.kind === "safety_report" && t.link?.startsWith("/safe/reports/"));
  if (repTasks.length) {
    const ids = repTasks.map((t) => t.link!.split("/").pop()!);
    const { data: reps } = await admin.from("reports").select("id,received_at,mor_filed_at,source,report_analysis(mor_status,confirmed_at)").in("id", ids);
    const now = Date.now();
    for (const r of (reps ?? []) as unknown as { id: string; received_at: string; mor_filed_at: string | null; source: string | null; report_analysis: { mor_status: string | null; confirmed_at: string | null } | { mor_status: string | null; confirmed_at: string | null }[] | null }[]) {
      const a = Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis;
      const c = morClock(r.received_at, r.mor_filed_at, a?.confirmed_at ? a.mor_status : null, now, (r.source ?? "sam") !== "sam");
      const t = repTasks.find((x) => x.link!.endsWith("/" + r.id)); if (!t) continue;
      if (c.state === "late") { const d = Math.floor(-c.left / 24); t.detail = `MOR clock expired ${d >= 1 ? `${d} d` : `${-c.left} h`} ago — acknowledge, classify and decide on the MOR now.`; }
      else if (c.state === "running") t.detail = `${c.left} h left on the 72 h MOR clock — acknowledge, classify and decide.`;
      else t.detail = c.state === "filed" || c.state === "filed_late" ? "MOR filed — follow the report through investigation and closure." : "MOR decided (not reportable) — follow the report through to closure.";
    }
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
    const parts = [`${ts.length} task${ts.length > 1 ? "s" : ""} for you`, late && `${late} late`, blocked && `${blocked} blocked`].filter(Boolean);
    out.push({ ...ts[0], id: "proj:" + link, title: ts[0].ctx ?? "Project", ctx: undefined, ctxLink: undefined, link, detail: `${parts.join(", ")}. Next: ${ts[0].title}` });
  }
  // FB-040 · safety actions: from 3 per entity, one line (count, late, next two) that opens the Actions list — never a wall of actions
  const acts = new Map<string, InboxItem[]>();
  const rest: InboxItem[] = [];
  for (const t of out) { if (t.kind === "action") { if (!acts.has(t.entity)) acts.set(t.entity, []); acts.get(t.entity)!.push(t); } else rest.push(t); }
  for (const [entity, ts] of acts) {
    if (ts.length < 3) { rest.push(...ts); continue; }
    ts.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
    const late = ts.filter((t) => t.due && t.due < today).length;
    const next = ts.slice(0, 2).map((t) => t.title.replace(/^[A-Z]+-\d+(\s+—\s+|,\s+)/, "")).join("; ");
    const parts = [`${ts.length} actions for you`, late && `${late} late`].filter(Boolean);
    rest.push({ ...ts[0], id: "acts:" + entity, title: "Safety actions", ctx: undefined, ctxLink: undefined, link: `/safe/actions?mine=1`, detail: `${parts.join(", ")}. Next: ${next}` });
  }
  return rest.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
}

export type InboxLine = InboxItem & { children?: InboxItem[] };
const PLURAL: Record<string, string> = { authority: "CAA applications", finding: "Findings", escalation: "Escalations", reading: "Manuals to read and acknowledge", communication: "Communications", signature: "Signatures", safety_report: "Safety reports", mitigation: "Mitigations", watch: "Regulatory watch items", check: "Compliance checks", certificate_validity: "Validities" };
/**
 * The Inbox in a few lines instead of a wall: (1) everything that belongs to one project under the project — its own tasks and
 * the CAA applications it opened; (2) several tasks on the same object under that object; (3) from 3 lines of the same kind in
 * an entity, one line for the kind. Nothing is hidden: each grouped line carries its lines, shown on a click.
 */
export function regroup(lines: InboxItem[], today: string, fileProject: Map<string, { id: string; title: string }>): InboxLine[] {
  const byDue = (a: InboxItem, b: InboxItem) => ((a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
  const head = (ts: InboxItem[], over: Partial<InboxLine>, what: string): InboxLine => {
    ts.sort(byDue); const late = ts.filter((t) => t.due && t.due < today).length;
    return { ...ts[0], ctx: undefined, ctxLink: undefined, ...over, detail: [`${ts.length} ${what}`, late && `${late} late`].filter(Boolean).join(", ") + `. Next: ${ts[0].title}`, children: ts };
  };
  const out: InboxLine[] = []; let rest: InboxItem[] = [];
  // 1 · by project
  const proj = new Map<string, { title: string; items: InboxItem[] }>();
  for (const t of lines) {
    const board = /^\/proj\/boards\/([^/?#]+)/.exec(t.link ?? "")?.[1]; const file = /^\/proj\/auth\/([^/?#]+)/.exec(t.link ?? "")?.[1];
    const p = board ? { id: board, title: t.title } : file ? fileProject.get(file) : undefined;
    if (!p) { rest.push(t); continue; }
    if (!proj.has(p.id)) proj.set(p.id, { title: p.title, items: [] });
    const g = proj.get(p.id)!; if (board) g.title = t.title; g.items.push(t);
  }
  for (const [id, g] of proj) {
    if (g.items.length === 1) { rest.push(g.items[0]); continue; }
    out.push(head(g.items, { id: "pg:" + id, kind: "project", title: g.title, link: `/proj/boards/${id}` }, "lines for you in this project"));
  }
  // 2 · several tasks on the same object
  const same = new Map<string, InboxItem[]>(); const r2: InboxItem[] = [];
  for (const t of rest) { if (!t.link || t.id.startsWith("acts:")) { r2.push(t); continue; } const k = t.entity + "|" + t.link; if (!same.has(k)) same.set(k, []); same.get(k)!.push(t); }
  rest = r2;
  for (const [k, ts] of same) { if (ts.length === 1) rest.push(ts[0]); else out.push(head(ts, { id: "same:" + k }, "tasks for you on this item")); }
  // 3 · from 3 lines of the same kind in an entity
  const kinds = new Map<string, InboxItem[]>();
  for (const t of rest) { const k = t.entity + "|" + (KIND[t.kind]?.[0] ?? t.kind); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k)!.push(t); }
  for (const [k, ts] of kinds) {
    if (ts.length < 3 || ts[0].id.startsWith("acts:") || ts[0].id.startsWith("proj:")) { out.push(...ts); continue; }
    out.push(head(ts, { id: "kind:" + k, title: PLURAL[ts[0].kind] ?? `${KIND[ts[0].kind]?.[0] ?? ts[0].kind.replace(/_/g, " ")}: ${ts.length} lines`, link: null }, "for you"));
  }
  return out.sort(byDue);
}

/** The day and the hour in Paris, where the group works (a server in UTC would say "Good morning" at 01:00). */
export function parisParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday as string };
}
