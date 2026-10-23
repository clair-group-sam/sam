import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { STAGE_LABEL, fr, today, type AuthorityFile } from "@/lib/authority";
import { LINK_LABEL, OPEN, PIVOT_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL, STATUS_TONE, loadProject, progress, project as projectDates, projectedEnd, resolveLinks, type Task, type TaskStatus } from "@/lib/projects";
import { addPhase, addTask, bindFileToTask, deleteTask, openFileForTask, saveProject, updateTask } from "../actions";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "waiting", "blocked", "done", "not_needed"];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  const { show = "open" } = await searchParams;
  const db = supabaseAdmin();
  const loaded = await loadProject(db, id);
  if (!loaded) notFound();
  const { project: p, phases, deps } = loaded;
  if (!s.group && !s.entities.includes(p.entity)) notFound();
  const links = await resolveLinks(db, p, loaded.tasks);
  // statuses may have moved while resolving the links: reload the tasks once
  const { data: fresh } = await db.from("project_tasks").select("*").eq("project_id", id).order("ord");
  const tasks = (fresh ?? loaded.tasks) as Task[];
  const cmm = isCmm(s);
  const owner = p.owner_person ? s.person?.id === p.owner_person : !!p.owner_role && s.roles.map(basePost).includes(basePost(p.owner_role));
  const mayEdit = cmm || owner;
  const mayWork = (t: Task) => mayEdit || (t.owner_person ? s.person?.id === t.owner_person : !!t.owner_role && s.roles.map(basePost).includes(basePost(t.owner_role)));
  const proj = projectDates(tasks, deps, p.started_at);
  const pr = progress(tasks);
  const end = projectedEnd(tasks, proj);
  const t0 = today();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depsOf = (t: Task) => deps.filter((d) => d.task_id === t.id).map((d) => byId.get(d.depends_on)).filter((x): x is Task => !!x);
  const late = tasks.filter((t) => proj.get(t.id)?.late).length;
  const ready = tasks.filter((t) => OPEN.includes(t.status) && !proj.get(t.id)?.openDeps.length);
  const { data: afData } = await db.from("authority_files").select("*").eq("project_id", p.id).order("created_at");
  const files = (afData ?? []) as AuthorityFile[];
  const { data: freeFiles } = mayEdit ? await db.from("authority_files").select("id,title,type_code,stage").eq("entity", p.entity).is("project_id", null).not("stage", "in", "(closed,standby)").order("created_at", { ascending: false }).limit(50) : { data: [] };
  const unbound = (freeFiles ?? []) as { id: string; title: string; type_code: string; stage: string }[];
  const personIds = [...new Set([p.owner_person, ...tasks.map((t) => t.done_by), ...tasks.map((t) => t.owner_person)].filter((x): x is string => !!x))];
  const { data: people } = personIds.length ? await db.from("people").select("id,display_name").in("id", personIds) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const visible = (t: Task) => show === "all" || (show === "open" ? t.status !== "done" && t.status !== "not_needed" : t.status === show);
  const pivotTxt = Object.entries(p.pivot ?? {}).map(([k, v]) => `${PIVOT_LABEL[k] ?? k} ${v}`).join(" · ");

  return (
    <>
      <PageHeader eyebrow={`Projects · ${p.entity} · ${p.template_code ?? "project"}`} title={p.title}
        sub={`${ENT[p.entity]?.name ?? p.entity}${pivotTxt ? ` · ${pivotTxt}` : ""} · owner ${p.owner_person ? nameOf.get(p.owner_person) ?? "" : p.owner_role ?? "—"} · started ${fr(p.started_at)}${p.target_date ? ` · target ${fr(p.target_date)}` : ""}`}
        right={<><span className={"pill " + (p.status === "closed" ? "green" : p.status === "on_hold" ? "" : "amber")} style={{ alignSelf: "center" }}>{PROJECT_STATUS_LABEL[p.status]}</span><Link href="/proj/boards" className="btn">‹ Projects</Link></>} />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Progress" value={`${pr.pct} %`} hint={`${pr.done} / ${pr.total} tasks${tasks.length - pr.total ? ` · ${tasks.length - pr.total} not needed` : ""}`} tone={pr.pct === 100 ? "green" : undefined} />
        <Metric label="Projected end" value={end ? fr(end) : "—"} hint={p.target_date ? (end && end > p.target_date ? `after the target (${fr(p.target_date)})` : `target ${fr(p.target_date)}`) : "from durations and dependencies"} tone={end && p.target_date && end > p.target_date ? "red" : undefined} />
        <Metric label="Late" value={late} tone={late ? "red" : undefined} hint="projected end before today" />
        <Metric label="Ready to start" value={ready.length} hint="no open dependency" tone={ready.length ? "amber" : undefined} />
      </div>

      <div className="grid grid-cols-3 gap-4 items-start">
        <div className="col-span-2 grid gap-4">
          <div className="tabs">{[["open", "Open tasks"], ["done", "Done"], ["not_needed", "Not needed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`/proj/boards/${p.id}?show=${k}`} className={"tab" + (show === k ? " on" : "")}>{l}</Link>)}<span className="mini ml-auto">⚡ critical path · dates projected from durations and dependencies</span></div>
          {phases.map((ph) => {
            const pt = tasks.filter((t) => t.phase_id === ph.id);
            const shown = pt.filter(visible);
            const done = pt.filter((t) => t.status === "done").length, counted = pt.filter((t) => t.status !== "not_needed").length;
            return (
              <section key={ph.id} className="card">
                <div className="ch"><span className="eyebrow">{ph.label}</span><span className="mini">{done} / {counted}{shown.length !== pt.length ? ` · ${shown.length} shown` : ""}</span></div>
                {shown.length > 0 && (
                  <table className="tbl ptasks"><tbody>
                    {shown.map((t) => { const pj = proj.get(t.id)!; const lk = links.get(t.id); const ds = depsOf(t); const openDs = ds.filter((d) => pj.openDeps.includes(d.id)); const work = mayWork(t) && p.status !== "closed"; return (
                      <tr key={t.id} className={t.status === "done" || t.status === "not_needed" ? "muted" : ""}>
                        <td style={{ width: 150 }}>
                          {work ? (
                            <form action={updateTask} className="flex items-center gap-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} />
                              <select name="status" className={"inp pillsel " + STATUS_TONE[t.status]} defaultValue={t.status} style={{ height: 26, fontSize: 12 }}>{STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</select>
                              <button className="btn" type="submit" style={{ height: 26, padding: "0 7px", fontSize: 11 }} title="Apply">✓</button>
                              <input name="not_needed_reason" className="inp" placeholder="why not needed?" defaultValue={t.not_needed_reason ?? ""} style={{ height: 26, fontSize: 11, width: 0, flex: 1, minWidth: 0 }} /></form>
                          ) : <span className={"pill " + STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</span>}
                        </td>
                        <td>
                          <div className="flex items-baseline gap-2 flex-wrap">{pj.critical && t.status !== "done" && <span title="critical path">⚡</span>}<b>{t.title}</b>{t.link_kind && <span className="nature">{LINK_LABEL[t.link_kind]}{t.link_ref ? ` · ${t.link_ref}` : ""}</span>}</div>
                          {t.detail && <div className="mini">{t.detail}</div>}
                          {t.status === "not_needed" && t.not_needed_reason && <div className="mini">Not needed: {t.not_needed_reason}</div>}
                          {lk && <div className="mini">{lk.href ? <Link className="underline" href={lk.href}>{lk.label}</Link> : lk.label} · <span className={"pill " + lk.tone} style={{ fontSize: 10.5 }}>{lk.state}</span></div>}
                          {t.link_kind === "authority_file" && !t.link_id && work && (
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <form action={openFileForTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button className="btn" type="submit" style={{ height: 26, fontSize: 12 }}>Open the authority file ({t.link_ref})</button></form>
                              {mayEdit && unbound.length > 0 && <form action={bindFileToTask} className="flex items-center gap-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><select name="file_id" className="inp" style={{ height: 26, fontSize: 12, maxWidth: 260 }}>{unbound.map((f) => <option key={f.id} value={f.id}>{f.type_code} · {f.title} · {f.stage}</option>)}</select><button className="btn" type="submit" style={{ height: 26, fontSize: 12 }}>Bind existing</button></form>}
                            </div>
                          )}
                          {ds.length > 0 && <div className="mini">after: {ds.map((d) => <span key={d.id} className={openDs.some((o) => o.id === d.id) ? "amber" : ""}>{d.title}{d.status === "done" ? " ✓" : ""}</span>).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, " · ", x] : [x]), [])}</div>}
                          {t.source && <div className="mini">{/^https?:/.test(t.source) ? <a className="underline" href={t.source} target="_blank" rel="noreferrer">source</a> : t.source}</div>}
                          {t.note && <div className="mini">✎ {t.note}</div>}
                          {mayEdit && p.status !== "closed" && (
                            <details className="mt-1"><summary className="mini underline cursor-pointer">Edit</summary>
                              <form action={updateTask} className="grid grid-cols-6 gap-2 mt-2 p-2" style={{ background: "#f7f9fb", borderRadius: 8 }}>
                                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="deps_edit" value="1" />
                                <label className="col-span-3"><span className="mini">Title</span><input name="title" className="inp" defaultValue={t.title} /></label>
                                <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue={t.owner_role ?? ""} /></label>
                                <label><span className="mini">Days</span><input name="days" type="number" className="inp" defaultValue={t.days ?? ""} /></label>
                                <label><span className="mini">Due (fixed)</span><input name="due" type="date" className="inp" defaultValue={t.due ?? ""} /></label>
                                <label className="col-span-3"><span className="mini">Detail</span><input name="detail" className="inp" defaultValue={t.detail ?? ""} /></label>
                                <label><span className="mini">Phase</span><select name="phase_id" className="inp" defaultValue={t.phase_id ?? ""}>{phases.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                                <label><span className="mini">Linked object</span><select name="link_kind" className="inp" defaultValue={t.link_kind ?? ""}><option value="">none</option>{Object.entries(LINK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                                <label><span className="mini">Code / type / kind</span><input name="link_ref" className="inp mono" defaultValue={t.link_ref ?? ""} placeholder="OM-A · AC-NEW · insurance" /></label>
                                <label className="col-span-4"><span className="mini">Depends on</span><select name="depends_on" multiple className="inp" size={4} defaultValue={ds.map((d) => d.id)}>{tasks.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
                                <label className="col-span-2"><span className="mini">Note</span><input name="note" className="inp" defaultValue={t.note ?? ""} /></label>
                                <div className="col-span-6 flex gap-2"><button className="btn primary" type="submit">Save</button><button className="btn" type="submit" formAction={deleteTask} title="Delete this task">✕ Delete</button></div>
                              </form>
                            </details>
                          )}
                        </td>
                        <td className="mini" style={{ width: 90 }}>{t.owner_person ? nameOf.get(t.owner_person) : t.owner_role ?? ""}</td>
                        <td className="mono mini" style={{ width: 150 }}>{t.status === "done" ? `done ${fr(t.done_at)}` : t.status === "not_needed" ? "" : <span className={pj.late ? "red" : ""}>{fr(pj.start)} → {fr(pj.end)}{t.due ? " ·fixed" : ""}</span>}</td>
                      </tr>); })}
                  </tbody></table>
                )}
                {!shown.length && <div className="cb mini text-slate6">{pt.length ? "Nothing in this view." : "No task yet."}</div>}
                {mayEdit && p.status !== "closed" && (
                  <form action={addTask} className="nprow add"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="phase_id" value={ph.id} />
                    <input name="title" className="inp" placeholder="Add a task to this phase" required /><input name="owner_role" className="inp mono" style={{ maxWidth: 80 }} placeholder="Post" /><input name="days" type="number" className="inp" style={{ maxWidth: 70 }} placeholder="days" />
                    <select name="link_kind" className="inp" style={{ maxWidth: 150 }} defaultValue=""><option value="">no linked object</option>{Object.entries(LINK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input name="link_ref" className="inp mono" style={{ maxWidth: 100 }} placeholder="OM-A / AC-NEW" />
                    <button className="btn" type="submit">+ Add</button></form>
                )}
              </section>);
          })}
          {mayEdit && p.status !== "closed" && <form action={addPhase} className="nprow"><input type="hidden" name="id" value={p.id} /><input name="label" className="inp" placeholder="Add a phase" required /><button className="btn" type="submit">+ Phase</button></form>}
        </div>

        <div className="grid gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">Project</span></div>
            <form action={saveProject} className="cb grid gap-2"><input type="hidden" name="id" value={p.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={p.title} disabled={!mayEdit} /></label>
              <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue={p.owner_role ?? ""} disabled={!mayEdit} /></label>
              {["aircraft_type", "aircraft_reg", "np_post_code"].map((k) => <label key={k}><span className="mini">{PIVOT_LABEL[k]}</span><input name={`pivot_${k}`} className="inp mono" defaultValue={p.pivot?.[k] ?? ""} disabled={!mayEdit} /></label>)}
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Start</span><input name="started_at" type="date" className="inp" defaultValue={p.started_at} disabled={!mayEdit} /></label><label><span className="mini">Target</span><input name="target_date" type="date" className="inp" defaultValue={p.target_date ?? ""} disabled={!mayEdit} /></label></div>
              <label><span className="mini">Status</span><select name="status" className="inp" defaultValue={p.status} disabled={!mayEdit}>{Object.entries(PROJECT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="mini">Description</span><textarea name="description" className="inp" rows={3} defaultValue={p.description ?? ""} disabled={!mayEdit} /></label>
              {mayEdit && <button className="btn" type="submit">Save</button>}
            </form>
          </section>
          <section className="card">
            <div className="ch"><span className="eyebrow">Authority files of this project</span><span className="mini">{files.length}</span></div>
            <table className="tbl"><tbody>
              {files.map((f) => <tr key={f.id}><td><Link className="underline" href={`/proj/auth/${f.id}`}>{f.type_code} · {f.portal_ref ?? f.title}</Link></td><td style={{ width: 130 }}><span className="pill">{STAGE_LABEL[f.stage]}</span></td></tr>)}
              {!files.length && <tr><td className="p-4 text-slate6 mini">None yet — opened from the tasks that call for one.</td></tr>}
            </tbody></table>
          </section>
          {(p.status === "closed" || pr.pct === 100) && (
            <section className="card"><div className="ch"><span className="eyebrow">Lessons learned</span></div>
              <form action={saveProject} className="cb grid gap-2"><input type="hidden" name="id" value={p.id} /><textarea name="lessons" className="inp" rows={4} defaultValue={p.lessons ?? ""} disabled={!mayEdit} placeholder="What to do differently next time" />{mayEdit && <button className="btn" type="submit">Save</button>}</form></section>
          )}
          <section className="card"><div className="ch"><span className="eyebrow">How it works</span></div><div className="cb mini grid gap-1">
            <div>A task bound to a <b>manual</b> follows its revision: started when a revision is opened after the project start, done when published.</div>
            <div>A task bound to an <b>authority file</b> is opened from here with the right type; waiting while at the authority, done at the decision.</div>
            <div>A task bound to a <b>certificate</b> is done when the document is filed in Certificates & Validities{p.pivot?.aircraft_reg ? ` for ${p.pivot.aircraft_reg}` : ""}.</div>
            <div>“Not needed” keeps the task with its reason — the authority may ask.</div>
          </div></section>
        </div>
      </div>
    </>
  );
}
