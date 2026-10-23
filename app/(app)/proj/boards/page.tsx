import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { fr, today } from "@/lib/authority";
import { PROJECT_STATUS_LABEL, progress, project as projectDates, projectedEnd, type Dep, type Project, type Task } from "@/lib/projects";
import { cancelProject, deleteProject } from "./actions";

/** Projects › Projects: every project of the entity (aircraft addition, NP change, new SPA…), its progress and what it waits for. */
export default async function Projects({ searchParams }: { searchParams: Promise<{ entity?: string; status?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { entity: q, status = "open" } = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = q && (q === "ALL" ? s.group : ents.includes(q)) ? q : s.entity;
  const db = supabaseAdmin();
  let pq = db.from("projects").select("*").order("created_at", { ascending: false });
  pq = entity === "ALL" ? pq.in("entity", ents) : pq.eq("entity", entity);
  if (status !== "all") pq = status === "open" ? pq.in("status", ["open", "on_hold"]) : status === "closed" ? pq.in("status", ["closed", "cancelled"]) : pq.eq("status", status);
  const { data } = await pq;
  const projects = (data ?? []) as Project[];
  const ids = projects.map((p) => p.id);
  const { data: ts } = ids.length ? await db.from("project_tasks").select("*").in("project_id", ids) : { data: [] };
  const tasks = (ts ?? []) as Task[];
  const { data: ds } = tasks.length ? await db.from("project_task_deps").select("*").in("task_id", tasks.map((t) => t.id)) : { data: [] };
  const deps = (ds ?? []) as Dep[];
  const { data: people } = await db.from("people").select("id,display_name").in("id", [...new Set(projects.map((p) => p.owner_person).filter((x): x is string => !!x))]);
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const t0 = today();
  const rows = projects.map((p) => {
    const pt = tasks.filter((t) => t.project_id === p.id);
    const proj = projectDates(pt, deps, p.started_at);
    const pr = progress(pt);
    const late = pt.filter((t) => proj.get(t.id)?.late).length;
    const blocked = pt.filter((t) => t.status === "blocked").length;
    const end = projectedEnd(pt, proj);
    const next = pt.filter((t) => t.status !== "done" && t.status !== "not_needed" && !(proj.get(t.id)?.openDeps.length)).sort((a, b) => (proj.get(a.id)!.end < proj.get(b.id)!.end ? -1 : 1)).slice(0, 2);
    return { p, pr, late, blocked, end, next };
  });
  const open = rows.filter((r) => r.p.status === "open");
  const superadmin = s.roles.includes("SUPERADMIN");
  return (
    <>
      <PageHeader eyebrow="Projects" title="Projects" sub="Any objective broken into phases and tasks — aircraft addition or removal, nominated person change, new approval… The manuals, authority files and certificates it needs are the real objects of S.A.M., linked to their task."
        right={<><Link href="/proj/auth" className="btn">Authority files</Link><Link href="/proj/boards/new" className="btn primary">+ New project</Link></>} />
      {ents.length > 1 && <div className="chips mb-4" style={{ display: "inline-flex" }}>{(s.group ? ["ALL", ...ents] : ents).map((e) => <Link key={e} href={`/proj/boards?entity=${e}&status=${status}`} className={"ent " + e + (e === entity ? " on" : "")}>{e}</Link>)}</div>}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open projects" value={open.length} />
        <Metric label="Tasks late" value={open.reduce((n, r) => n + r.late, 0)} tone={open.some((r) => r.late) ? "red" : undefined} hint="projected end before today" />
        <Metric label="Blocked" value={open.reduce((n, r) => n + r.blocked, 0)} tone={open.some((r) => r.blocked) ? "amber" : undefined} />
        <Metric label="Done this scope" value={`${open.reduce((n, r) => n + r.pr.done, 0)} / ${open.reduce((n, r) => n + r.pr.total, 0)}`} hint="tasks, open projects" />
      </div>
      <div className="tabs mb-4">{[["open", "Open & on hold"], ["closed", "Closed & cancelled"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`/proj/boards?entity=${entity}&status=${k}`} className={"tab" + (status === k ? " on" : "")}>{l}</Link>)}</div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th style={{ width: 60 }}>Entity</th><th>Project</th><th style={{ width: 120 }}>Owner</th><th style={{ width: 170 }}>Progress</th><th>Next</th><th style={{ width: 120 }}>Projected end</th><th style={{ width: 110 }}>Status</th>{superadmin && <th style={{ width: 150 }} />}</tr></thead>
          <tbody>
            {rows.map(({ p, pr, late, blocked, end, next }) => (
              <tr key={p.id}>
                <td><span className={"ent " + p.entity}>{p.entity}</span></td>
                <td><Link href={`/proj/boards/${p.id}`}><b>{p.title}</b></Link><div className="mini">{p.template_code ?? "blank project"} · started {fr(p.started_at)}{p.target_date ? ` · target ${fr(p.target_date)}` : ""}</div></td>
                <td className="mini">{p.owner_person ? nameOf.get(p.owner_person) ?? "" : p.owner_role ?? "—"}</td>
                <td><div className="bar"><i style={{ width: `${pr.pct}%` }} /></div><div className="mini">{pr.done} / {pr.total} · {pr.pct} %{late ? <span className="red"> · {late} late</span> : ""}{blocked ? <span className="amber"> · {blocked} blocked</span> : ""}</div></td>
                <td className="mini">{p.status === "closed" ? "—" : next.length ? next.map((t) => <div key={t.id}>{t.title}{t.owner_role ? ` · ${t.owner_role}` : ""}</div>) : "nothing ready to start"}</td>
                <td className="mono">{p.status === "closed" ? fr(p.closed_at) : end ? <span className={end < t0 ? "red" : ""}>{fr(end)}</span> : "—"}</td>
                <td><span className={"pill " + (p.status === "closed" ? "green" : p.status === "open" ? "amber" : "")}>{PROJECT_STATUS_LABEL[p.status]}</span></td>
                {superadmin && (
                  <td>
                    <details className="more"><summary title="Cancel or delete (super admin)">⋯</summary>
                      <div className="morepanel" style={{ width: 360 }}>
                        {p.status !== "cancelled" && p.status !== "closed" && <form action={cancelProject} className="flex items-center gap-2"><input type="hidden" name="id" value={p.id} /><input name="reason" className="inp" placeholder="Why it is cancelled (optional)" /><button className="btn" type="submit">Cancel the project</button></form>}
                        <form action={deleteProject} className="flex items-center gap-2 flex-wrap"><input type="hidden" name="id" value={p.id} /><label className="mini flex items-center gap-1"><input type="checkbox" name="confirm" /> I confirm — tasks and attached documents are deleted for good</label><button className="btn" type="submit" style={{ color: "var(--terra, #c0603a)" }}>Delete</button></form>
                      </div>
                    </details>
                  </td>
                )}
              </tr>))}
            {!rows.length && <tr><td colSpan={superadmin ? 8 : 7} className="p-6 text-slate6">No project in this scope. <Link className="underline" href="/proj/boards/new">Open one</Link> — blank or from a template.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
