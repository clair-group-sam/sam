import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { STAGE_LABEL, STAGE_TONE, fr, today, type AuthorityFile } from "@/lib/authority";
import { DEPARTMENTS, LINK_LABEL, PIVOT_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL, STATUS_TONE, departmentOf, loadProject, progress, project as projectDates, projectedEnd, resolveLinks, upstream, type Task, type TaskStatus } from "@/lib/projects";
import { addTask, deleteTask, openFileForTask, pushToTemplate, removeTaskFile, saveProject, startDraftForTask, startTask, tickTask, updateTask, uploadTaskFile } from "../actions";
import Gantt from "@/components/Gantt";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "not_needed", "blocked"];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  const { view = "tasks" } = await searchParams;
  const db = supabaseAdmin();
  const loaded = await loadProject(db, id);
  if (!loaded) notFound();
  const { project: p, phases, deps, files: taskFiles } = loaded;
  if (!s.group && !s.entities.includes(p.entity)) notFound();
  // ready = no open dependency: S.A.M. opens by itself the drafts and authority files those tasks call for
  const proj0 = projectDates(loaded.tasks, deps, p.started_at);
  const ready0 = new Set(loaded.tasks.filter((t) => t.status === "todo" && !proj0.get(t.id)?.openDeps.length).map((t) => t.id));
  const links = await resolveLinks(db, p, loaded.tasks, { ready: ready0, who: { personId: s.person?.id ?? null, name: s.name } });
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
  const ready = tasks.filter((t) => (t.status === "todo" || t.status === "in_progress") && !proj.get(t.id)?.openDeps.length && t.link_kind !== "authority_file");
  // left: what people do; right: the applications S.A.M. prepares and files
  const work = tasks.filter((t) => t.link_kind !== "authority_file");
  const apps = tasks.filter((t) => t.link_kind === "authority_file");
  const { data: afData } = await db.from("authority_files").select("*").eq("project_id", p.id);
  const files = (afData ?? []) as AuthorityFile[];
  const personIds = [...new Set([p.owner_person, ...tasks.map((t) => t.done_by), ...tasks.map((t) => t.owner_person)].filter((x): x is string => !!x))];
  const { data: people } = personIds.length ? await db.from("people").select("id,display_name").in("id", personIds) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const pivotTxt = Object.entries(p.pivot ?? {}).map(([k, v]) => `${PIVOT_LABEL[k] ?? k} ${v}`).join(" · ");
  const groups = DEPARTMENTS.map((d) => ({ dept: d, tasks: work.filter((t) => departmentOf(t.owner_role) === d).sort((a, b) => (proj.get(a.id)!.start < proj.get(b.id)!.start ? -1 : proj.get(a.id)!.start > proj.get(b.id)!.start ? 1 : a.ord - b.ord)) })).filter((g) => g.tasks.length);

  return (
    <>
      <PageHeader eyebrow={`Projects · ${p.entity} · ${p.template_code ?? "project"}`} title={p.title}
        sub={`${ENT[p.entity]?.name ?? p.entity}${pivotTxt ? ` · ${pivotTxt}` : ""} · owner ${p.owner_person ? nameOf.get(p.owner_person) ?? "" : p.owner_role ?? "—"} · started ${fr(p.started_at)}${p.target_date ? ` · target ${fr(p.target_date)}` : ""}`}
        right={<><span className={"pill " + (p.status === "closed" ? "green" : p.status === "on_hold" ? "" : "amber")} style={{ alignSelf: "center" }}>{PROJECT_STATUS_LABEL[p.status]}</span><Link href="/proj/boards" className="btn">‹ Projects</Link></>} />
      {p.description && <p className="mini mb-4" style={{ maxWidth: 1000 }}>{p.description}</p>}

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Progress" value={`${pr.pct} %`} hint={`${pr.done} / ${pr.total} tasks${tasks.length - pr.total ? ` · ${tasks.length - pr.total} not needed` : ""}`} tone={pr.pct === 100 ? "green" : undefined} />
        <Metric label="Projected end" value={end ? fr(end) : "—"} hint={p.target_date ? (end && end > p.target_date ? `after the target (${fr(p.target_date)})` : `target ${fr(p.target_date)}`) : "from durations and dependencies"} tone={end && p.target_date && end > p.target_date ? "red" : undefined} />
        <Metric label="Late" value={late} tone={late ? "red" : undefined} hint="projected end before today" />
        <Metric label="Ready to do" value={ready.length} hint="no open dependency" tone={ready.length ? "amber" : undefined} />
      </div>

      <div className="grid grid-cols-3 gap-4 items-start">
        <div className="col-span-2 grid gap-4">
          <div className="tabs"><Link href={`/proj/boards/${p.id}`} className={"tab" + (view === "tasks" ? " on" : "")}>Tasks by department</Link><Link href={`/proj/boards/${p.id}?view=gantt`} className={"tab" + (view === "gantt" ? " on" : "")}>Timeline</Link><span className="mini ml-auto">⚡ critical path · dates projected from durations and dependencies</span></div>
          {view === "gantt" && <section className="card"><div className="ch"><span className="eyebrow">Timeline</span><span className="mini">projected · {fr(p.started_at)} → {end ? fr(end) : "—"}</span></div><div className="cb"><Gantt projectId={p.id} phases={phases} tasks={tasks} proj={proj} startedAt={p.started_at} target={p.target_date} /></div></section>}
          {view === "tasks" && groups.map((g) => {
            const done = g.tasks.filter((t) => t.status === "done").length, counted = g.tasks.filter((t) => t.status !== "not_needed").length;
            return (
              <section key={g.dept} className="card">
                <div className="ch"><span className="eyebrow">{g.dept}</span><span className="mini">{done} / {counted}</span></div>
                <table className="tbl ptasks"><tbody>
                  {g.tasks.map((t) => { const pj = proj.get(t.id)!; const lk = links.get(t.id); const ds = depsOf(t); const openDs = ds.filter((d) => pj.openDeps.includes(d.id)); const canWork = mayWork(t) && p.status !== "closed"; const tf = taskFiles.filter((f) => f.task_id === t.id); const open = t.status !== "done" && t.status !== "not_needed"; return (
                    <tr key={t.id} id={`t-${t.id}`} className={"prow" + (t.status === "done" ? " isdone" : t.status === "not_needed" ? " muted" : "")}>
                      <td style={{ width: 34 }}>
                        <form action={tickTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} />
                          <button type="submit" className={"chk" + (t.status === "done" ? " on" : "")} disabled={!canWork || t.status === "not_needed"} aria-label={t.status === "done" ? "Reopen" : "Mark as done"} title={t.status === "done" ? "Done — click to reopen" : "Mark as done"}>{t.status === "done" ? "✓" : ""}</button></form>
                      </td>
                      <td style={{ width: 96 }}>
                        {t.status === "todo" && pj.openDeps.length > 0 ? <span className="pill later" title={`After: ${openDs.map((d) => d.title).join(" · ")}`}>Later</span>
                          : t.status === "todo" && canWork ? <form action={startTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button type="submit" className="pill" title="Start now — it also starts by itself when the linked manual or a document is touched">To do ▸</button></form>
                          : <span className={"pill " + STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</span>}
                      </td>
                      <td>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {pj.critical && open && <span title="critical path">⚡</span>}
                          <b>{t.title}</b>
                          {lk ? (lk.href ? <Link className="objlink" href={lk.href} title={lk.label}><span className="nature">{LINK_LABEL[t.link_kind!]}</span> {lk.label} · <span className={"pill " + lk.tone}>{lk.state}</span></Link> : <span className="objlink"><span className="nature">{LINK_LABEL[t.link_kind!]}</span> {lk.label}</span>) : t.link_kind ? <span className="nature">{LINK_LABEL[t.link_kind]}{t.link_ref ? ` · ${t.link_ref}` : ""}</span> : null}
                          {tf.length > 0 && <span className="mini" title={tf.map((f) => f.name).join(", ")}>📎 {tf.length}</span>}
                          {openDs.length > 0 && t.status !== "todo" && <span className="mini amber" title={`waits for: ${openDs.map((d) => d.title).join(" · ")}`}>waits for {openDs.length}</span>}
                        </div>
                        {t.detail && open && <div className="mini">{t.detail}</div>}
                        {t.status === "not_needed" && t.not_needed_reason && <div className="mini">Not needed: {t.not_needed_reason}</div>}
                      </td>
                      <td className="mini" style={{ width: 70 }}>{t.owner_person ? nameOf.get(t.owner_person) : t.owner_role ?? ""}</td>
                      <td className="mono mini" style={{ width: 150 }}>{t.status === "done" ? <span className="green">done {fr(t.done_at)}</span> : t.status === "not_needed" ? "" : <span className={pj.late ? "red" : ""}>{fr(pj.start)} → {fr(pj.end)}{t.due ? " ·fixed" : ""}</span>}</td>
                      <td style={{ width: 36 }}>
                        {(canWork || tf.length > 0) && (
                          <details className="more"><summary title="Documents, details, edit">⋯</summary>
                            <div className="morepanel">
                              {t.link_kind === "manual" && !t.link_id && canWork && open && (
                                <form action={startDraftForTask} className="flex items-center gap-2 flex-wrap"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button className="btn" type="submit">Start the draft of {t.link_ref} now</button><span className="mini">{pj.openDeps.length ? "otherwise S.A.M. opens it once the previous tasks are done" : ""}</span></form>
                              )}
                              {ds.length > 0 && <div className="mini">After: {ds.map((d) => `${d.title}${d.status === "done" ? " ✓" : ""}`).join(" · ")}</div>}
                              {t.source && <div className="mini">{/^https?:/.test(t.source) ? <a className="underline" href={t.source} target="_blank" rel="noreferrer">Source</a> : t.source}</div>}
                              {t.note && <div className="mini">✎ {t.note}</div>}
                              {tf.map((f) => <div key={f.id} className="mini flex items-center gap-2">📎 {f.path ? <a className="underline" href={`/api/files/${f.path}`} target="_blank" rel="noreferrer">{f.name}</a> : <>{f.name} <span>(on the server)</span></>}{f.size ? <span>{Math.round(f.size / 1024)} KB</span> : null}<span>{fr(f.at)}</span>{mayEdit && <form action={removeTaskFile}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="file_id" value={f.id} /><button className="linkbtn" type="submit">remove</button></form>}</div>)}
                              {canWork && open && (
                                <form action={uploadTaskFile} className="flex items-center gap-2 flex-wrap" encType="multipart/form-data"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} />
                                  <input type="file" name="file" className="inp" style={{ maxWidth: 280 }} /><input name="name" className="inp" style={{ maxWidth: 240 }} placeholder="or the name of a file kept on the server" /><button className="btn" type="submit">Attach a document</button></form>
                              )}
                              {mayEdit && p.status !== "closed" && (
                                <form action={updateTask} className="grid grid-cols-6 gap-2 mt-1">
                                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="deps_edit" value="1" />
                                  <label className="col-span-3"><span className="mini">Title</span><input name="title" className="inp" defaultValue={t.title} /></label>
                                  <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue={t.owner_role ?? ""} /></label>
                                  <label><span className="mini">Days</span><input name="days" type="number" className="inp" defaultValue={t.days ?? ""} /></label>
                                  <label><span className="mini">Due (fixed)</span><input name="due" type="date" className="inp" defaultValue={t.due ?? ""} /></label>
                                  <label className="col-span-3"><span className="mini">Detail</span><input name="detail" className="inp" defaultValue={t.detail ?? ""} /></label>
                                  <label><span className="mini">Phase (timeline)</span><select name="phase_id" className="inp" defaultValue={t.phase_id ?? ""}>{phases.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                                  <label><span className="mini">Linked object</span><select name="link_kind" className="inp" defaultValue={t.link_kind ?? ""}><option value="">none</option>{Object.entries(LINK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                                  <label><span className="mini">Code / type / kind</span><input name="link_ref" className="inp mono" defaultValue={t.link_ref ?? ""} placeholder="OM-A · AC-NEW · insurance" /></label>
                                  <label className="col-span-3"><span className="mini">Depends on</span><select name="depends_on" multiple className="inp" size={4} defaultValue={ds.map((d) => d.id)}>{tasks.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
                                  <label className="col-span-2"><span className="mini">Note</span><input name="note" className="inp" defaultValue={t.note ?? ""} /></label>
                                  <label><span className="mini">Status</span><select name="status" className="inp" defaultValue={t.status}>{STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</select></label>
                                  <label className="col-span-4"><span className="mini">If not needed — why (kept for the authority)</span><input name="not_needed_reason" className="inp" defaultValue={t.not_needed_reason ?? ""} /></label>
                                  <div className="col-span-2 flex gap-2 items-end"><button className="btn primary" type="submit">Save</button><button className="btn" type="submit" formAction={deleteTask} title="Delete this task">✕ Delete</button></div>
                                </form>
                              )}
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>); })}
                </tbody></table>
              </section>);
          })}
          {view === "tasks" && mayEdit && p.status !== "closed" && (
            <details className="addtask"><summary className="mini">+ Add a task</summary>
              <form action={addTask} className="nprow add"><input type="hidden" name="id" value={p.id} />
                <input name="title" className="inp" placeholder="What has to be done" required /><input name="owner_role" className="inp mono" style={{ maxWidth: 80 }} placeholder="Post" /><input name="days" type="number" className="inp" style={{ maxWidth: 70 }} placeholder="days" />
                <select name="phase_id" className="inp" style={{ maxWidth: 170 }} defaultValue={phases[0]?.id ?? ""}>{phases.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
                <select name="link_kind" className="inp" style={{ maxWidth: 150 }} defaultValue=""><option value="">no linked object</option>{Object.entries(LINK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input name="link_ref" className="inp mono" style={{ maxWidth: 100 }} placeholder="OM-A / AC-NEW" />
                <button className="btn" type="submit">+ Add</button></form>
            </details>
          )}
        </div>

        <div className="grid gap-4">
          {/* the applications S.A.M. prepares and files; each fills up as the tasks it depends on are done */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Applications</span><span className="mini">{apps.length} · prepared and filed by S.A.M.</span></div>
            <div className="cb grid gap-3">
              {apps.sort((a, b) => (proj.get(a.id)!.start < proj.get(b.id)!.start ? -1 : 1)).map((a) => {
                const f = files.find((x) => x.id === a.link_id);
                const up = upstream(a.id, deps, byId).filter((t) => t.status !== "not_needed");
                const doneUp = up.filter((t) => t.status === "done").length;
                const pct = f && ["approved", "published", "closed"].includes(f.stage) ? 100 : up.length ? Math.round((100 * doneUp) / up.length) : a.status === "done" ? 100 : 0;
                const stageTone = f ? STAGE_TONE[f.stage] : "";
                const canOpen = mayWork(a) && !a.link_id && a.status !== "done" && a.status !== "not_needed" && p.status !== "closed";
                return (
                  <div key={a.id} className="appcard">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <b>{f ? <Link className="underline" href={`/proj/auth/${f.id}`}>{a.title}</Link> : a.title}</b>
                      <span className="nature">{a.link_ref}</span>
                      <span className="mini ml-auto">{a.owner_role ?? "CMM"}</span>
                    </div>
                    <div className="bar wide mt-1"><i style={{ width: `${pct}%` }} /></div>
                    <div className="mini flex items-center gap-2 flex-wrap mt-1">
                      {f ? <><span className={"pill " + stageTone}>{STAGE_LABEL[f.stage]}</span>{f.portal_ref && <span className="mono">{f.portal_ref}</span>}</> : a.status === "not_needed" ? <span className="pill">Not needed</span> : <span>{up.length ? `${doneUp} / ${up.length} tasks done` : "ready"} — {pct === 100 ? "S.A.M. opens the file" : "opened by S.A.M. when the tasks are done"}</span>}
                      {canOpen && <form action={openFileForTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={a.id} /><button className="linkbtn" type="submit">open now</button></form>}
                      {mayEdit && a.status !== "not_needed" && !a.link_id && p.status !== "closed" && <form action={updateTask} className="flex items-center gap-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={a.id} /><input type="hidden" name="status" value="not_needed" /><input name="not_needed_reason" className="inp" style={{ height: 22, fontSize: 11, width: 150 }} placeholder="not needed because…" required /><button className="linkbtn" type="submit">not needed</button></form>}
                    </div>
                    {up.length > 0 && !f && <div className="mini" style={{ color: "var(--slate5)" }} title={up.map((t) => `${t.status === "done" ? "✓" : "·"} ${t.title}`).join("\n")}>{up.filter((t) => t.status !== "done").slice(0, 3).map((t) => t.title).join(" · ")}{up.filter((t) => t.status !== "done").length > 3 ? " · …" : ""}</div>}
                  </div>);
              })}
              {!apps.length && <p className="mini text-slate6">No application in this project.</p>}
              {mayEdit && p.status !== "closed" && (
                <details className="addtask" style={{ marginTop: 4 }}><summary className="mini">+ Add an application</summary>
                  <form action={addTask} className="grid grid-cols-3 gap-2 mt-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="link_kind" value="authority_file" /><input type="hidden" name="phase_id" value={phases[phases.length - 1]?.id ?? ""} />
                    <input name="title" className="inp col-span-2" placeholder="Application" required /><input name="link_ref" className="inp mono" placeholder="Type (OM-APP…)" required />
                    <div className="col-span-3"><button className="btn" type="submit">+ Add</button></div></form>
                </details>
              )}
            </div>
          </section>

          <details className="card"><summary className="ch" style={{ cursor: "pointer" }}><span className="eyebrow">Project settings</span><span className="mini">title, owner, dates, status</span></summary>
            <form action={saveProject} className="cb grid gap-2"><input type="hidden" name="id" value={p.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={p.title} disabled={!mayEdit} /></label>
              <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue={p.owner_role ?? ""} disabled={!mayEdit} /></label>
              {["aircraft_type", "aircraft_reg", "np_post_code"].map((k) => <label key={k}><span className="mini">{PIVOT_LABEL[k]}</span><input name={`pivot_${k}`} className="inp mono" defaultValue={p.pivot?.[k] ?? ""} disabled={!mayEdit} /></label>)}
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Start</span><input name="started_at" type="date" className="inp" defaultValue={p.started_at} disabled={!mayEdit} /></label><label><span className="mini">Target</span><input name="target_date" type="date" className="inp" defaultValue={p.target_date ?? ""} disabled={!mayEdit} /></label></div>
              <label><span className="mini">Status</span><select name="status" className="inp" defaultValue={p.status} disabled={!mayEdit}>{Object.entries(PROJECT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="mini">Summary</span><textarea name="description" className="inp" rows={3} defaultValue={p.description ?? ""} disabled={!mayEdit} /></label>
              {mayEdit && <button className="btn" type="submit">Save</button>}
            </form>
          </details>

          {(p.status === "closed" || pr.pct === 100) && (
            <section className="card"><div className="ch"><span className="eyebrow">Lessons learned</span></div>
              <form action={saveProject} className="cb grid gap-2"><input type="hidden" name="id" value={p.id} /><textarea name="lessons" className="inp" rows={4} defaultValue={p.lessons ?? ""} disabled={!mayEdit} placeholder="What to do differently next time" />{mayEdit && <button className="btn" type="submit">Save</button>}</form>
              {cmm && (
                <div className="cb grid gap-2" style={{ borderTop: "1px solid var(--line)" }}>
                  <div className="eyebrow">Improve the template</div>
                  <p className="mini">Push this project as it really ran — tasks, posts, real durations, dependencies, applications — into the template, so the next project starts from what you learned.</p>
                  {p.template_code && <form action={pushToTemplate}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="mode" value="update" /><button className="btn" type="submit">Update template {p.template_code}</button></form>}
                  <form action={pushToTemplate} className="flex gap-2 items-end flex-wrap"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="mode" value="new" />
                    <label style={{ width: 120 }}><span className="mini">New code</span><input name="code" className="inp mono" placeholder="BASE-NEW" required /></label><label className="flex-1" style={{ minWidth: 140 }}><span className="mini">Name</span><input name="name" className="inp" placeholder="New template name" /></label><button className="btn" type="submit">Save as new template</button></form>
                  <Link className="mini underline" href={`/ref/ptpl${p.template_code ? `#${p.template_code}` : ""}`}>Edit templates by hand in References</Link>
                </div>
              )}
            </section>
          )}
          <p className="mini" style={{ color: "var(--slate5)" }}>Tick what S.A.M. cannot see (contracts, inspections, training, systems). Manual lines follow their revision; documents are done when filed; applications open by themselves, with their checklist, when the tasks they need are done.</p>
        </div>
      </div>
    </>
  );
}
