import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { basePost, getSession } from "@/lib/session";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { OPEN, project as projectDates, type Dep, type Project, type Task as PTask } from "@/lib/projects";

type Task = { id: string; title: string; detail: string | null; due: string | null; entity: string; kind: string; status: string; link: string | null; owner_person: string | null; owner_role: string | null };

export default async function Inbox() {
  const s = await getSession();
  if (!s) redirect("/login");
  const sb = await supabaseServer();
  // my items: addressed to me by name, or to one of my posts (holders and deputies), or to nobody in particular
  let q = sb.from("tasks").select("id,title,detail,due,entity,kind,status,link,owner_person,owner_role").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(200);
  if (s.entity !== "ALL") q = q.eq("entity", s.entity);
  const { data } = await q;
  const posts = new Set(s.roles.map(basePost));
  const tasks: Task[] = ((data ?? []) as Task[]).filter((t) => t.owner_person ? t.owner_person === s.person?.id : t.owner_role ? posts.has(basePost(t.owner_role)) : true).slice(0, 100);
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
      for (const t of ptasks.filter((t) => t.project_id === p.id)) {
        const mine = t.owner_person ? t.owner_person === s.person?.id : t.owner_role ? posts.has(basePost(t.owner_role)) : (p.owner_person ? p.owner_person === s.person?.id : !!p.owner_role && posts.has(basePost(p.owner_role)));
        if (!mine || proj.get(t.id)?.openDeps.length) continue;
        tasks.push({ id: t.id, title: t.title, detail: `${p.title}${t.status === "blocked" ? " · blocked" : t.status === "waiting" ? " · waiting" : ""}`, due: t.status === "waiting" ? null : proj.get(t.id)?.end ?? null, entity: p.entity, kind: "project", status: "open", link: `/proj/boards/${p.id}`, owner_person: t.owner_person, owner_role: t.owner_role });
      }
    }
    tasks.sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const late = tasks.filter((t) => t.due && t.due < today).length;
  const first = s.name.split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader eyebrow="S.A.M. · Inbox" title={`${greet} ${first}`} sub="Everything that needs you, in one list." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Open items" value={tasks.length} hint={s.entity === "ALL" ? "all entities" : ENT[s.entity]?.name} />
        <Metric label="Overdue" value={late} tone={late ? "red" : undefined} hint="past due date" />
        <Metric label="Scope" value={s.group ? "Group" : s.entities.join(" · ") || "—"} hint={s.roles.join(", ") || "no role yet"} />
      </div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Due</th><th>Item</th><th>Kind</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><span className={"ent " + t.entity}>{t.entity}</span></td>
                <td className={"mono" + (t.due && t.due < today ? " red" : "")}>{t.due ?? "—"}</td>
                <td>{t.link ? <Link href={t.link} className="underline"><b>{t.title}</b></Link> : <b>{t.title}</b>}{t.detail && <div className="mini">{t.detail}</div>}</td>
                <td className="mini">{t.kind}</td>
              </tr>
            ))}
            {!tasks.length && (
              <tr><td colSpan={4} className="p-6 text-slate6">
                {s.person ? "Nothing to do." : "Your account is not yet attached to a person in S.A.M. — ask the CMM to add you."}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
