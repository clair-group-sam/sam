import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { STAGE_LABEL, fr, today, type AuthorityFile } from "@/lib/authority";
import { LINK_LABEL, OPEN, PIVOT_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL, STATUS_TONE, loadProject, progress, project as projectDates, projectedEnd, resolveLinks, type Task, type TaskStatus } from "@/lib/projects";
import { addPhase, addTask, bindFileToTask, deleteTask, openFileForTask, pushToTemplate, removeTaskFile, saveProject, startDraftForTask, startTask, tickTask, updateTask, uploadTaskFile } from "../actions";
import Gantt from "@/components/Gantt";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "not_needed", "blocked"];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string; view?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  const { show = "open", view = "list" } = await searchParams;
  const db = supabaseAdmin();
  const loaded = await loadProject(db, id);
  if (!loaded) notFound();
  const { project: p, phases, deps, files: taskFiles } = loaded;
  if (!s.group && !s.entities.includes(p.entity)) notFound();
  // ready = no open dependency: S.A.M. opens by itself the drafts and authority files those tasks call for
  const proj0 = projectDates(loaded.tasks, deps, p.started_at);
  const ready0 = new Set(loaded.tasks.filter((t) => t.status === "todo" && !proj0.get(t.id)?.openDeps.length).map((t) => t.id));
  const links = await resolveLinks(db, p, loaded.tasks, { ready: ready0, who: { personId: s.person?.id ?? null, name: s.name } });
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
          <div className="tabs">{[["open", "Open tasks"], ["done", "Done"], ["not_needed", "Not needed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`/proj/boards/${p.id}?show=${k}`} className={"tab" + (view === "list" && show === k ? " on" : "")}>{l}</Link>)}<Link href={`/proj/boards/${p.id}?view=gantt`} className={"tab" + (view === "gantt" ? " on" : "")}>Timeline</Link><span className="mini ml-auto">⚡ critical path · dates projected from durations and dependencies</span></div>
          {view === "gantt" && <section className="card"><div className="ch"><span className="eyebrow">Timeline</span><span className="mini">projected · {fr(p.started_at)} → {end ? fr(end) : "—"}</span></div><div className="cb"><Gantt projectId={p.id} phases={phases} tasks={tasks} proj={proj} startedAt={p.started_at} target={p.target_date} /></div></section>}
          {view === "list" && phases.map((ph) => {
            const pt = tasks.filter((t) => t.phase_id === ph.id);
            const shown = pt.filter(visible);
            const done = pt.filter((t) => t.status === "done").length, counted = pt.filter((t) => t.status !== "not_needed").length;
            return (
              <section key={ph.id} className="card">
                <div className="ch"><span className="eyebrow">{ph.label}</span><span className="mini">{done} / {counted}{shown.length !== pt.length ? ` · ${shown.length} shown` : ""}</span></div>
                {shown.length > 0 && (
                  <table className="tbl ptasks"><tbody>
                    {shown.map((t) => { const pj = proj.get(t.id)!; const lk = links.get(t.id); const ds = depsOf(t); const openDs = ds.filter((d) => pj.openDeps.includes(d.id)); const work = mayWork(t) && p.status !== "closed"; const tf = taskFiles.filter((f) => f.task_id === t.id); const open = t.status !== "done" && t.status !== "not_needed"; return (
                      <tr key={t.id} id={`t-${t.id}`} className={"prow" + (open ? "" : " muted")}>
                        <td style={{ width: 34 }}>
                          <form action={tickTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} />
                            <button type="submit" className={"chk" + (t.status === "done" ? " on" : "")} disabled={!work || t.status === "not_needed"} aria-label={t.status === "done" ? "Reopen" : "Mark as done"} title={t.status === "done" ? "Done — click to reopen" : "Mark as done"}>{t.status === "done" ? "✓" : ""}</button></form>
                        </td>
                        <td style={{ width: 96 }}>
                          {t.status === "todo" && pj.openDeps.length > 0 ? (
                            <span className="pill later" title={`After: ${openDs.map((d) => d.title).join(" · ")}`}>Later</span>
                          ) : t.status === "todo" && work ? (
                            <form action={startTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button type="submit" className="pill" title="Start now — it also starts by itself when the linked manual, file or a document is touched">To do ▸</button></form>
                          ) : <span className={"pill " + STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</span>}
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
                        <td className="mono mini" style={{ width: 150 }}>{t.status === "done" ? `done ${fr(t.done_at)}` : t.status === "not_needed" ? "" : <span className={pj.late ? "red" : ""}>{fr(pj.start)} → {fr(pj.end)}{t.due ? " ·fixed" : ""}</span>}</td>
                        <td style={{ width: 36 }}>
                          {(work || tf.length > 0) && (
                            <details className="more"><summary title="Documents, details, edit">⋯</summary>
                              <div className="morepanel">
                                {(t.link_kind === "manual" || t.link_kind === "authority_file") && !t.link_id && work && open && (
                                  <form action={t.link_kind === "manual" ? startDraftForTask : openFileForTask} className="flex items-center gap-2 flex-wrap"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button className="btn" type="submit">{t.link_kind === "manual" ? `Start the draft of ${t.link_ref} now` : `Open the ${t.link_ref} file now`}</button><span className="mini">{pj.openDeps.length ? "otherwise S.A.M. opens it once the previous tasks are done" : ""}</span></form>
                                )}
                                {t.link_kind === "authority_file" && !t.link_id && mayEdit && unbound.length > 0 && open && <form action={bindFileToTask} className="flex items-center gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><select name="file_id" className="inp" style={{ maxWidth: 300 }}>{unbound.map((f) => <option key={f.id} value={f.id}>{f.type_code} · {f.title} · {f.stage}</option>)}</select><button className="btn" type="submit">Bind an existing file</button></form>}
                                {ds.length > 0 && <div className="mini">After: {ds.map((d) => `${d.title}${d.status === "done" ? " ✓" : ""}`).join(" · ")}</div>}
                                {t.source && <div className="mini">{/^https?:/.test(t.source) ? <a className="underline" href={t.source} target="_blank" rel="noreferrer">Source</a> : t.source}</div>}
                                {t.note && <div className="mini">✎ {t.note}</div>}
                                {tf.map((f) => <div key={f.id} className="mini flex items-center gap-2">📎 {f.path ? <a className="underline" href={`/api/files/${f.path}`} target="_blank" rel="noreferrer">{f.name}</a> : <>{f.name} <span>(on the server)</span></>}{f.size ? <span>{Math.round(f.size / 1024)} KB</span> : null}<span>{fr(f.at)}</span>{mayEdit && <form action={removeTaskFile}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="file_id" value={f.id} /><button className="linkbtn" type="submit">remove</button></form>}</div>)}
                                {work && open && (
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
                                    <label><span className="mini">Phase</span><select name="phase_id" className="inp" defaultValue={t.phase_id ?? ""}>{phases.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
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
                )}
                {!shown.length && <div className="cb mini text-slate6">{pt.length ? "Nothing in this view." : "No task yet."}</div>}
                {mayEdit && p.status !== "closed" && (
                  <details className="addtask"><summary className="mini">+ Add a task</summary>
                  <form action={addTask} className="nprow add"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="phase_id" value={ph.id} />
                    <input name="title" className="inp" placeholder="Task" required /><input name="owner_role" className="inp mono" style={{ maxWidth: 80 }} placeholder="Post" /><input name="days" type="number" className="inp" style={{ maxWidth: 70 }} placeholder="days" />
                    <select name="link_kind" className="inp" style={{ maxWidth: 150 }} defaultValue=""><option value="">no linked object</option>{Object.entries(LINK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input name="link_ref" className="inp mono" style={{ maxWidth: 100 }} placeholder="OM-A / AC-NEW" />
                    <button className="btn" type="submit">+ Add</button></form>
                  </details>
                )}
              </section>);
          })}
          {view === "list" && mayEdit && p.status !== "closed" && <form action={addPhase} className="nprow"><input type="hidden" name="id" value={p.id} /><input name="label" className="inp" placeholder="Add a phase" required /><button className="btn" type="submit">+ Phase</button></form>}
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
              <form action={saveProject} className="cb grid gap-2"><input type="hidden" name="id" value={p.id} /><textarea name="lessons" className="inp" rows={4} defaultValue={p.lessons ?? ""} disabled={!mayEdit} placeholder="What to do differently next time" />{mayEdit && <button className="btn" type="submit">Save</button>}</form>
              {cmm && (
                <div className="cb grid gap-2" style={{ borderTop: "1px solid var(--line)" }}>
                  <div className="eyebrow">Improve the template</div>
                  <p className="mini">Push this project as it really ran — phases, tasks, posts, real durations, dependencies, linked objects — into the template, so the next project starts from what you learned. “Not needed” tasks are kept.</p>
                  {p.template_code && <form action={pushToTemplate}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="mode" value="update" /><button className="btn" type="submit">Update template {p.template_code}</button></form>}
                  <form action={pushToTemplate} className="flex gap-2 items-end flex-wrap"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="mode" value="new" />
                    <label style={{ width: 120 }}><span className="mini">New code</span><input name="code" className="inp mono" placeholder="BASE-NEW" required /></label><label className="flex-1" style={{ minWidth: 140 }}><span className="mini">Name</span><input name="name" className="inp" placeholder="New template name" /></label><button className="btn" type="submit">Save as new template</button></form>
                  <Link className="mini underline" href={`/ref/ptpl${p.template_code ? `#${p.template_code}` : ""}`}>Edit templates by hand in References</Link>
                </div>
              )}
            </section>
          )}
          <section className="card"><div className="ch"><span className="eyebrow">What S.A.M. does by itself</span></div><div className="cb mini grid gap-1">
            <div>When a line's previous tasks are done, S.A.M. <b>opens the draft</b> of the manual (task to its NP) or <b>opens the authority file</b> with its checklist — nobody clicks.</div>
            <div>A manual line is done when its revision is <b>published</b>; an authority line waits while at the authority and is done at the <b>decision</b>; a certificate line is done when the document is <b>filed</b>{p.pivot?.aircraft_reg ? ` for ${p.pivot.aircraft_reg}` : ""}.</div>
            <div>Forms, checklists, LEP, organisation chart and attachments are checked in the <b>authority file's checklist</b>, which blocks the submission — not here.</div>
            <div>You tick only what S.A.M. cannot see: contracts, inspections, training, systems. “Not needed” keeps the line with its reason.</div>
          </div></section>
        </div>
      </div>
    </>
  );
}
