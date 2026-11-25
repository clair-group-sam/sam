import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { STAGE_LABEL, STAGE_TONE, fr, loadTypes, today, type AuthorityFile } from "@/lib/authority";
import { DEPARTMENTS, LINK_LABEL, PIVOT_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL, STATUS_TONE, departmentOf, isConditional, loadProject, progress, project as projectDates, projectedEnd, resolveLinks, upstream, type Task, type TaskStatus } from "@/lib/projects";
import { addTask, deleteTask, openFileForTask, pushToTemplate, removeTaskFile, saveProject, startDraftForTask, startTask, tickTask, updateTask, uploadTaskFile } from "../actions";
import Gantt from "@/components/Gantt";
import EntityBand from "@/components/EntityBand";
import { Icon } from "@/lib/icons";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "not_needed", "blocked"];
const dnum = (d: string) => Math.round(new Date(d.slice(0, 10) + "T00:00:00Z").getTime() / 86400000);
/** The summary written at creation holds the plan's assumptions, risks and decisions as labelled paragraphs: split them back so they fold away. */
function brief(d: string) {
  const out = { summary: [] as string[], assumptions: [] as string[], risks: [] as string[], decisions: [] as string[] };
  for (const part of d.split(/\n\s*\n/)) {
    const m = part.match(/^\s*(Assumptions|Risks|Decisions)\s*:\s*([\s\S]+)$/);
    if (!m) { if (part.trim()) out.summary.push(part.trim()); continue; }
    const k = m[1].toLowerCase() as "assumptions" | "risks" | "decisions"; const body = m[2].trim();
    out[k] = (body.includes("\n") ? body.split(/\n+/) : k === "assumptions" ? body.split(/(?<=\])\s+(?=\S)/) : k === "decisions" ? body.split(/(?<=\(open\))\s+(?=\S)/) : [body]).map((x) => x.trim()).filter(Boolean);
  }
  return out;
}
/** "Form SM 113: Application for…" gives the plate "SM 113" and the name; without a form number the plate is the fallback. */
function plateOf(title: string, fallback: string): { plate: string; name: string } {
  const m = title.match(/^\s*(?:(?:Form|Formulaire|Cerfa|CERFA)\s+)?((?:[A-Z][A-Za-z]{0,7}[ ./-]?)?(?:[A-Z]{1,6}[ ./-]?)?\d[\w./-]{0,9})\s*[:,]\s+(\S[\s\S]*)$/);
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return m && m[1].length <= 16 ? { plate: m[1].trim(), name: cap(m[2].trim()) } : { plate: fallback, name: title };
}
const TONES = ["tone-a", "tone-b", "tone-c", "tone-d"];
const APP_STEPS = ["Preparing", "Filed", "With the authority", "Granted"];

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
  // ready = no open dependency: S.A.M. opens by itself the drafts and CAA applications those tasks call for
  const proj0 = projectDates(loaded.tasks, deps, p.started_at);
  const ready0 = new Set(loaded.tasks.filter((t) => t.status === "todo" && !proj0.get(t.id)?.openDeps.length).map((t) => t.id));
  const links = await resolveLinks(db, p, loaded.tasks, { ready: ready0, who: { personId: s.person?.id ?? null, name: s.name } });
  const { data: fresh } = await db.from("project_tasks").select("*").eq("project_id", id).order("ord");
  const tasks = (fresh ?? loaded.tasks) as Task[];
  const cmm = isCmm(s);
  const owner = p.owner_person ? s.person?.id === p.owner_person : !!p.owner_role && s.roles.map(basePost).includes(basePost(p.owner_role));
  const active = p.status === "open" || p.status === "on_hold";
  const mayEdit = (cmm || owner) && p.status !== "cancelled";
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
  const appTypes = apps.length ? new Map((await loadTypes(db)).map((t) => [t.code, t])) : new Map();
  const { data: afData } = await db.from("authority_files").select("*").eq("project_id", p.id);
  const files = (afData ?? []) as AuthorityFile[];
  const personIds = [...new Set([p.owner_person, ...tasks.map((t) => t.done_by), ...tasks.map((t) => t.owner_person)].filter((x): x is string => !!x))];
  const { data: people } = personIds.length ? await db.from("people").select("id,display_name").in("id", personIds) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const pivotTxt = Object.entries(p.pivot ?? {}).map(([k, v]) => `${PIVOT_LABEL[k] ?? k} ${v}`).join(", ");
  const groups = DEPARTMENTS.map((d) => ({ dept: d, tasks: work.filter((t) => departmentOf(t.owner_role) === d).sort((a, b) => (proj.get(a.id)!.start < proj.get(b.id)!.start ? -1 : proj.get(a.id)!.start > proj.get(b.id)!.start ? 1 : a.ord - b.ord)) })).filter((g) => g.tasks.length);
  const readyIds = new Set(ready.map((t) => t.id));
  const endLate = !!(end && p.target_date && end > p.target_date);
  // time line: from the start to the latest of target, projected end and today
  const d0 = dnum(p.started_at); const span = Math.max(1, Math.max(dnum(end ?? p.started_at), dnum(p.target_date ?? p.started_at), dnum(t0)) - d0);
  const pos = (d: string) => Math.min(100, Math.max(0, Math.round(((dnum(d) - d0) / span) * 1000) / 10));
  // one colour per place an application is filed (authority portal), shared by the plates and the diamonds of the time line
  const toneKeys: string[] = [];
  const appRows = apps.sort((a, b) => (proj.get(a.id)!.start < proj.get(b.id)!.start ? -1 : 1)).map((a) => {
    const f = files.find((x) => x.id === a.link_id);
    const up = upstream(a.id, deps, byId).filter((t) => t.status !== "not_needed");
    const ty = a.link_ref ? appTypes.get(a.link_ref) : undefined;
    // the authority is the one the application names (a project can file with a foreign CAA), else the entity's own
    const named = `${a.title} ${a.detail ?? ""}`.match(/\b(San Marino CAA|TM-?CAD|Transport Malta|DSAC|DGAC|OSAC|EASA|FAA|UK CAA|[A-Z][a-z]+(?: [A-Z][a-z]+)? CAA)\b/)?.[1];
    const key: string = named ?? f?.authority ?? ENT[p.entity]?.auth ?? "Authority";
    const portal: string = ty?.routes?.[p.entity]?.portal ?? "";
    const where = !named && portal ? portal : key;
    if (!toneKeys.includes(key)) toneKeys.push(key);
    return { a, f, up, doneUp: up.filter((t) => t.status === "done").length, ty, where, tone: TONES[toneKeys.indexOf(key) % 4] };
  });
  const isGranted = (r: (typeof appRows)[number]) => (r.f ? ["approved", "published", "closed"].includes(r.f.stage) : r.a.status === "done");
  const appsCounted = appRows.filter((r) => r.a.status !== "not_needed").length, appsGranted = appRows.filter(isGranted).length;
  const appMarks = appRows.filter((r) => r.a.status !== "not_needed").map((r) => ({ id: r.a.id, title: r.a.title, tone: r.tone, done: isGranted(r), at: (isGranted(r) && r.a.done_at ? r.a.done_at : proj.get(r.a.id)!.end).slice(0, 10) }));

  return (
    <>
      <EntityBand entity={p.entity} current={s.entity} multi={s.group || s.entities.length > 1} what="project" />
      <PageHeader eyebrow={`Projects, ${p.entity}, ${p.template_code ?? "project"}`} title={p.title}
        tag={<div className="pchips">
          <span className={"ent " + p.entity} style={{ borderRadius: 999, padding: "2px 10px", fontSize: 13, fontWeight: 600 }}>{ENT[p.entity]?.name ?? p.entity}</span>
          {pivotTxt && <span className="pchip">{pivotTxt}</span>}
          <span className="pchip"><i>Owner</i>{p.owner_person ? nameOf.get(p.owner_person) ?? "" : p.owner_role ?? "not set"}</span>
          <span className="pchip"><i>Started</i>{fr(p.started_at)}</span>
          {p.target_date && <span className="pchip"><i>Target</i>{fr(p.target_date)}</span>}
        </div>}
        right={<><span className={"pill " + (p.status === "closed" ? "green" : p.status === "open" ? "amber" : "")} style={{ alignSelf: "center" }}>{PROJECT_STATUS_LABEL[p.status]}</span><Link href="/proj/boards" className="btn">‹ Projects</Link></>} />
      {p.description && (() => { const b = brief(p.description); const n = (a: string[]) => (a.length > 1 ? <span className="n">{a.length}</span> : null); return (
        <section className="card pbrief mb-4">
          {b.summary.length > 0 && <p className="psum">{b.summary.join("\n\n")}</p>}
          {(b.decisions.length > 0 || b.assumptions.length > 0 || b.risks.length > 0) && <div className="pdraws">
            {b.decisions.length > 0 && <details className="pdraw"><summary>Decisions {n(b.decisions)}{b.decisions.some((x) => /\(open\)\s*$/.test(x)) && <span className="pill amber">some open</span>}</summary><ul>{b.decisions.map((x, i) => { const open = /\(open\)\s*$/.test(x); const [q, a] = open ? [x.replace(/\s*\(open\)\s*$/, ""), ""] : x.split(/\s+→\s+/, 2); return <li key={i}>{q} {open ? <span className="pill amber">open</span> : a ? <b>{a}</b> : null}</li>; })}</ul></details>}
            {b.assumptions.length > 0 && <details className="pdraw"><summary>Assumptions {n(b.assumptions)}{b.assumptions.some((x) => /\[not reviewed\]\s*$/.test(x)) && <span className="pill amber">not all reviewed</span>}</summary><ul>{b.assumptions.map((x, i) => { const m = x.match(/^([\s\S]*?)\s*\[([^\]]*)\]\s*$/); const v = m?.[2] ?? ""; return <li key={i}>{m ? m[1] : x} {v && <span className={"pill " + (/^confirm/i.test(v) ? "green" : /^reject/i.test(v) ? "red" : /^not reviewed/i.test(v) ? "amber" : "")}>{v}</span>}</li>; })}</ul></details>}
            {b.risks.length > 0 && <details className="pdraw"><summary>Risks {n(b.risks)}</summary><ul>{b.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
          </div>}
        </section>); })()}
      {(() => { const miss = [...links.values()].filter((l) => l.state === "create it").length; return miss >= 3 ? <div className="lockbar mb-4" style={{ marginLeft: 0, marginRight: 0 }}>{miss} manuals of this template do not exist in {ENT[p.entity]?.name ?? p.entity} yet, each task below offers to create its manual; the rest of the project is not blocked.</div> : null; })()}

      {/* where the project stands: figures on one line, then the time line from start to target with the applications on it */}
      <section className="card mb-4">
        <div className="pband">
          <div><div className="big" style={pr.pct === 100 ? { color: "var(--green)" } : undefined}>{pr.pct} %</div><div className="bar mt-2" style={{ width: 120 }}><i style={{ width: `${pr.pct}%` }} /></div></div>
          <div className="pfigs">
            <div className="pfig"><b>{pr.done} / {pr.total}</b><span>tasks done{tasks.length - pr.total ? `, ${tasks.length - pr.total} not needed` : ""}</span></div>
            <div className="pfig"><b className={endLate ? "red" : ""}>{end ? fr(end) : "not set"}</b><span>projected end{p.target_date ? (endLate ? `, after the target (${fr(p.target_date)})` : `, target ${fr(p.target_date)}`) : ""}</span></div>
            <div className="pfig"><b className={late ? "red" : ""}>{late}</b><span>late</span></div>
            <div className="pfig"><b>{ready.length}</b><span>to do now</span></div>
            {apps.length > 0 && <div className="pfig"><b>{appsGranted} / {appsCounted}</b><span>applications granted</span></div>}
          </div>
        </div>
        <div className="pline" aria-hidden="true">
          <div className="track" /><div className="fill" style={{ width: `${pos(t0)}%` }} />
          {end && <span className="tick" style={{ left: `${pos(end)}%` }} title={`Projected end ${fr(end)}`} />}
          {appMarks.map((m) => <span key={m.id} className={"dia " + m.tone + (m.done ? " done" : "")} style={{ left: `${pos(m.at)}%` }} title={`${m.title}, ${m.done ? "granted" : "expected"} ${fr(m.at)}`} />)}
          <span className="lab" style={{ left: 0, transform: "none" }}>{fr(p.started_at)}</span>
          {pos(t0) > 8 && pos(t0) < 100 && <span className="lab up" style={{ left: `${pos(t0)}%` }}>Today</span>}
          <span className="now" style={{ left: `${pos(t0)}%` }} />
          {p.target_date ? <span className="lab flag" style={pos(p.target_date) > 88 ? { right: 0, transform: "none" } : { left: `${pos(p.target_date)}%` }}>Target {fr(p.target_date)}</span> : end ? <span className="lab" style={{ right: 0, transform: "none" }}>{fr(end)}</span> : null}
          {p.target_date && <span className="tgt" style={{ left: `${pos(p.target_date)}%` }} />}
        </div>
        {toneKeys.length > 0 && <div className="plegend">{toneKeys.map((k, i) => <span key={k}><i className={"dia " + TONES[i % 4]} />{k}</span>)}<span className="mini">applications, placed at their projected date</span></div>}
      </section>

      {/* everything that can move today: several tasks run side by side, none waits for the others of this list */}
      {view === "tasks" && active && ready.length > 0 && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">To do now</span><span className="mini">{ready.length} {ready.length > 1 ? "tasks can run side by side" : "task"}, nothing blocks {ready.length > 1 ? "them" : "it"}</span></div>
          <div className="cb nowgrid">
            {ready.map((t) => { const pj = proj.get(t.id)!; const canWork = mayWork(t); return (
              <div key={t.id} className={"nowitem" + (pj.late ? " late" : t.status === "in_progress" ? " going" : "")}>
                <div className="flex-1 min-w-0">
                  <a href={`#t-${t.id}`} className="tt">{t.title}</a>
                  <div className="tmeta"><span className="post">{t.owner_person ? nameOf.get(t.owner_person) : t.owner_role ?? "no post"}</span><span className={pj.late ? "red" : ""}>by {fr(pj.end)}</span>{pj.critical && <span className="crit"><Icon name="bolt" size={12} /> sets the end date</span>}</div>
                </div>
                {canWork && (t.status === "todo"
                  ? <form action={startTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button type="submit" className="btn">Start</button></form>
                  : <form action={tickTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button type="submit" className="btn primary">Done</button></form>)}
                {!canWork && <span className={"pill " + STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</span>}
              </div>); })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-4 items-start">
        <div className="col-span-2 grid gap-4">
          <div className="tabs"><Link href={`/proj/boards/${p.id}`} className={"tab" + (view === "tasks" ? " on" : "")}>Tasks by department</Link><Link href={`/proj/boards/${p.id}?view=gantt`} className={"tab" + (view === "gantt" ? " on" : "")}>Timeline</Link><span className="mini ml-auto">Dates are projected from durations and dependencies.</span></div>
          {view === "gantt" && <section className="card"><div className="ch"><span className="eyebrow">Timeline</span><span className="mini">projected, {fr(p.started_at)} → {end ? fr(end) : "—"}</span></div><div className="cb"><Gantt projectId={p.id} phases={phases} tasks={tasks} proj={proj} startedAt={p.started_at} target={p.target_date} /></div></section>}
          {view === "tasks" && groups.map((g) => {
            const done = g.tasks.filter((t) => t.status === "done").length, counted = g.tasks.filter((t) => t.status !== "not_needed").length;
            const live = g.tasks.filter((t) => readyIds.has(t.id) || proj.get(t.id)?.late).length;
            return (
              <details key={g.dept} className="card dept" open={live > 0}>
                <summary><span className="dname">{g.dept}</span>{live > 0 ? <span className="pill amber">{live} to do now</span> : done === counted && counted > 0 ? <span className="pill green">all done</span> : <span className="pill later">later</span>}<span className="bar" style={{ marginLeft: "auto" }}><i style={{ width: `${counted ? Math.round((100 * done) / counted) : 0}%` }} /></span><span className="mini mono">{done} / {counted}</span></summary>
                <div className="trows">
                  {g.tasks.map((t) => { const pj = proj.get(t.id)!; const lk = links.get(t.id); const ds = depsOf(t); const openDs = ds.filter((d) => pj.openDeps.includes(d.id)); const canWork = mayWork(t) && active; const tf = taskFiles.filter((f) => f.task_id === t.id); const open = t.status !== "done" && t.status !== "not_needed"; const later = t.status === "todo" && pj.openDeps.length > 0; return (
                    <div key={t.id} id={`t-${t.id}`} className={"trow" + (t.status === "done" ? " isdone" : t.status === "not_needed" ? " muted" : later ? " later" : "")}>
                      <form action={tickTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} />
                        <button type="submit" className={"chk" + (t.status === "done" ? " on" : "")} disabled={!canWork || t.status === "not_needed"} aria-label={t.status === "done" ? "Reopen" : "Mark as done"} title={t.status === "done" ? "Done, click to reopen" : "Mark as done"}>{t.status === "done" ? <Icon name="check" size={14} /> : ""}</button></form>
                      <div className="min-w-0">
                        <div className="tt">{t.title}</div>
                        {t.detail && open && !later && <div className="mini" style={{ marginTop: 2 }}>{t.detail}</div>}
                        {t.status === "not_needed" && t.not_needed_reason && <div className="mini">Not needed: {t.not_needed_reason}</div>}
                        <div className="tmeta">
                          <span className="post">{t.owner_person ? nameOf.get(t.owner_person) : t.owner_role ?? "no post"}</span>
                          {t.status === "done" ? <span className="green">done {fr(t.done_at)}</span> : t.status === "not_needed" ? null : <span className={pj.late ? "red" : ""}>{fr(pj.start)} to {fr(pj.end)}{t.days ? `, ${t.days} d` : ""}{t.due ? ", fixed date" : ""}</span>}
                          {openDs.length > 0 && <span title={`Waits for: ${openDs.map((d) => d.title).join(", ")}`}>after {openDs[0].title.length > 44 ? openDs[0].title.slice(0, 42) + "…" : openDs[0].title}{openDs.length > 1 ? ` and ${openDs.length - 1} more` : ""}</span>}
                          {pj.critical && open && <span className="crit" title="On the critical path: a day lost here moves the end of the project"><Icon name="bolt" size={12} /> sets the end date</span>}
                          {lk && t.status === "done" && !t.link_id && (lk.tone === "" || lk.tone === "amber") && lk.state !== "filed" ? ( // FB-031 · ticked done by hand, object not in S.A.M.: no call to action
                            <span className="objlink" title={lk.label}><span className="nature">{LINK_LABEL[t.link_kind!]}</span> done outside S.A.M.{t.link_kind === "certificate" ? <>, <Link className="underline" href={lk.href}>attach the certificate</Link></> : t.link_kind === "manual" && lk.state === "create it" ? <>, {t.link_ref} not in S.A.M. yet</> : null}</span>
                          ) : lk ? (lk.href ? <Link className="objlink" href={lk.href} title={lk.label}><span className="nature">{LINK_LABEL[t.link_kind!]}</span> {lk.label}, <span className={"pill " + lk.tone}>{lk.state}</span></Link> : <span className="objlink"><span className="nature">{LINK_LABEL[t.link_kind!]}</span> {lk.label}</span>) : t.link_kind ? <span className="nature">{LINK_LABEL[t.link_kind]}{t.link_ref ? `, ${t.link_ref}` : ""}</span> : null}
                          {tf.length > 0 && <span title={tf.map((f) => f.name).join(", ")}><Icon name="clip" size={13} /> {tf.length}</span>}
                        </div>
                      </div>
                      <div>
                        {later ? <span className="pill later" title={`After: ${openDs.map((d) => d.title).join(", ")}`}>Later</span>
                          : t.status === "todo" && canWork ? <form action={startTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button type="submit" className="pill startbtn" title="Start now, it also starts by itself when the linked manual or a document is touched">Start</button></form>
                          : <span className={"pill " + STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</span>}
                      </div>
                      <div>
                        {(canWork || tf.length > 0) && (
                          <details className="more"><summary title="Documents, details, edit">⋯</summary>
                            <div className="morepanel">
                              {t.link_kind === "manual" && !t.link_id && canWork && open && (
                                <form action={startDraftForTask} className="flex items-center gap-2 flex-wrap"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><button className="btn" type="submit">Start the draft of {t.link_ref} now</button><span className="mini">{pj.openDeps.length ? "otherwise S.A.M. opens it once the previous tasks are done" : ""}</span></form>
                              )}
                              {ds.length > 0 && <div className="mini">After: {ds.map((d) => `${d.title}${d.status === "done" ? " (done)" : ""}`).join(", ")}</div>}
                              {t.source && <div className="mini">{/^https?:/.test(t.source) ? <a className="underline" href={t.source} target="_blank" rel="noreferrer">Source</a> : t.source}</div>}
                              {t.note && <div className="mini"><Icon name="pencil" size={12} /> {t.note}</div>}
                              {tf.map((f) => <div key={f.id} className="mini flex items-center gap-2"><Icon name="clip" size={13} /> {f.path ? <a className="underline" href={`/api/files/${f.path}`} target="_blank" rel="noreferrer">{f.name}</a> : <>{f.name} <span>(on the server)</span></>}{f.size ? <span>{Math.round(f.size / 1024)} KB</span> : null}<span>{fr(f.at)}</span>{mayEdit && <form action={removeTaskFile}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="file_id" value={f.id} /><button className="linkbtn" type="submit">remove</button></form>}</div>)}
                              {canWork && open && (
                                <form action={uploadTaskFile} className="flex items-center gap-2 flex-wrap" encType="multipart/form-data"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} />
                                  <input type="file" name="file" className="inp" style={{ maxWidth: 280 }} /><input name="name" className="inp" style={{ maxWidth: 240 }} placeholder="or the name of a file kept on the server" /><button className="btn" type="submit">Attach a document</button></form>
                              )}
                              {mayEdit && active && (
                                <form action={updateTask} className="grid grid-cols-6 gap-2 mt-1">
                                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="deps_edit" value="1" />
                                  <label className="col-span-3"><span className="mini">Title</span><input name="title" className="inp" defaultValue={t.title} /></label>
                                  <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue={t.owner_role ?? ""} /></label>
                                  <label><span className="mini">Days</span><input name="days" type="number" className="inp" defaultValue={t.days ?? ""} /></label>
                                  <label><span className="mini">Due (fixed)</span><input name="due" type="date" className="inp" defaultValue={t.due ?? ""} /></label>
                                  <label className="col-span-3"><span className="mini">Detail</span><input name="detail" className="inp" defaultValue={t.detail ?? ""} /></label>
                                  <label><span className="mini">Phase (timeline)</span><select name="phase_id" className="inp" defaultValue={t.phase_id ?? ""}>{phases.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                                  <label><span className="mini">Linked object</span><select name="link_kind" className="inp" defaultValue={t.link_kind ?? ""}><option value="">none</option>{Object.entries(LINK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                                  <label><span className="mini">Code / type / kind</span><input name="link_ref" className="inp mono" defaultValue={t.link_ref ?? ""} placeholder="OM-A, AC-NEW, insurance" /></label>
                                  <label className="col-span-3"><span className="mini">Depends on</span><select name="depends_on" multiple className="inp" size={4} defaultValue={ds.map((d) => d.id)}>{tasks.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
                                  <label className="col-span-2"><span className="mini">Note</span><input name="note" className="inp" defaultValue={t.note ?? ""} /></label>
                                  <label><span className="mini">Status</span><select name="status" className="inp" defaultValue={t.status}>{STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</select></label>
                                  <label className="col-span-4"><span className="mini">If not needed, why (kept for the authority)</span><input name="not_needed_reason" className="inp" defaultValue={t.not_needed_reason ?? ""} /></label>
                                  <div className="col-span-2 flex gap-2 items-end"><button className="btn primary" type="submit">Save</button><button className="btn" type="submit" formAction={deleteTask} title="Delete this task">Delete</button></div>
                                </form>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>); })}
                </div>
              </details>);
          })}
          {view === "tasks" && mayEdit && active && (
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
            <div className="ch"><span className="eyebrow">Applications</span><span className="mini">{apps.length}, prepared and filed by S.A.M.</span></div>
            <div className="cb grid gap-3">
              {appRows.map(({ a, f, up, doneUp, ty, where, tone }) => {
                const granted = (f && ["approved", "published", "closed"].includes(f.stage)) || (!f && a.status === "done");
                const step = granted ? 4 : !f ? -1 : f.stage === "submitted" || f.stage === "remarks" ? 2 : 0; // index of the current step; 4 = all done, -1 = not opened yet
                const canOpen = mayWork(a) && !a.link_id && a.status !== "done" && a.status !== "not_needed" && active;
                const canSkip = mayEdit && a.status !== "not_needed" && !a.link_id && active;
                const canDone = cmm && a.status !== "done" && a.status !== "not_needed" && !a.link_id && active;
                const canReopen = cmm && a.status === "done" && !a.link_id && active;
                const { plate, name } = plateOf(a.title, a.link_ref ?? ENT[p.entity]?.auth ?? "CAA");
                const what = a.detail ?? ty?.notes ?? null;
                const left = up.filter((t) => t.status !== "done");
                return (
                  <div key={a.id} className={"appc " + tone + (a.status === "not_needed" ? " off" : "")}>
                    {/* the plate carries the form number, then the name the authority gives the application and one sentence on what it is for */}
                    <div className="apphead">
                      <span className="plate">{plate}</span>
                      <div className="flex-1 min-w-0">
                        {where && <div className="appauth">{where}</div>}
                        <b className="appname">{f ? <Link className="underline" href={`/proj/auth/${f.id}`}>{name}</Link> : name}</b>
                      </div>
                      {(canOpen || canSkip || canDone || canReopen) && (
                        <details className="more"><summary title="Open now, not needed, already granted">⋯</summary>
                          <div className="morepanel" style={{ width: 340 }}>
                            {canOpen && <form action={openFileForTask} className="flex items-center gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={a.id} /><button className="btn" type="submit">Open the application now</button><span className="mini">without waiting for the tasks</span></form>}
                            {canSkip && <form action={updateTask} className="grid gap-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={a.id} /><input type="hidden" name="status" value="not_needed" /><span className="mini">Not needed in this project, because (kept for the authority)</span><div className="flex gap-2"><input name="not_needed_reason" className="inp" placeholder="reason" required /><button className="btn" type="submit">Not needed</button></div></form>}
                            {canDone && <form action={updateTask} className="grid gap-1" title="Application already granted outside S.A.M. (project taken over from Monday / Centrik)"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={a.id} /><input type="hidden" name="status" value="done" /><span className="mini">Already granted outside S.A.M., on</span><div className="flex gap-2"><input name="done_at" type="date" className="inp" /><button className="btn" type="submit">Already granted</button></div></form>}
                            {canReopen && <form action={updateTask}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="task_id" value={a.id} /><input type="hidden" name="status" value="todo" /><button className="btn" type="submit">Reopen</button></form>}
                          </div>
                        </details>
                      )}
                    </div>
                    {what && <p className="appwhat">{what}</p>}
                    {a.status === "not_needed" ? <div className="mini"><span className="pill">Not needed</span> {a.not_needed_reason ?? ""}</div> : (<>
                      <div className="appsteps">{APP_STEPS.map((l, i) => <span key={l} className={i < step ? "done" : i === step ? "cur" : ""}>{l}</span>)}</div>
                      <div className="mini flex items-center gap-2 flex-wrap">
                        {f ? <><span className={"pill " + STAGE_TONE[f.stage]}>{STAGE_LABEL[f.stage]}</span>{f.portal_ref && <span className="mono">{f.portal_ref}</span>}<span className="ml-auto">{a.owner_role ?? "CMM"}</span></>
                          : granted ? <span className="green">granted {fr(a.done_at)}, outside S.A.M.</span>
                          : isConditional(a) ? <span><span className="pill">Conditional</span> your call: open it from the menu, or mark it not needed</span>
                          : left.length ? <span title={left.map((t) => t.title).join("\n")}><b>Waits for {left.length} {left.length > 1 ? "tasks" : "task"}</b>{up.length ? `, ${doneUp} of ${up.length} done` : ""}. Next: {left[0].title.length > 60 ? left[0].title.slice(0, 58) + "…" : left[0].title}</span>
                          : <span>Ready, S.A.M. opens the file</span>}
                      </div></>)}
                  </div>);
              })}
              {!apps.length && <p className="mini text-slate6">No application in this project.</p>}
              {mayEdit && active && (
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
                  <p className="mini">Push this project as it really ran, tasks, posts, real durations, dependencies, applications, into the template, so the next project starts from what you learned.</p>
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