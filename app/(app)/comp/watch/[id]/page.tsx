import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import EntityBand from "@/components/EntityBand";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_STATUS, type Action } from "@/lib/actions-shared";
import { APPL_LABEL, APPL_TONE, findCitations, KIND_LABEL, loadEntry, OPEN_STATUSES, STATUS_LABEL, TASK_LABEL } from "@/lib/watch";
import { analyse, draftFor, setEntryStatus, updateEntry } from "../actions";

/* REG-01 · one entry: the text, S.A.M.'s reading (chapters citing it, applicability, suggested task), the decision, what was done. */
export default async function WatchEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const e = await loadEntry(db, id);
  if (!e) notFound();
  const desk = s.role === "cmm";
  const owner = (!!e.owner_person && e.owner_person === s.person?.id) || (!!e.owner_role && s.entities.includes(e.entity) && s.roles.map(basePost).includes(basePost(e.owner_role)));
  const may = desk || owner;
  const isOpen = OPEN_STATUSES.includes(e.status);
  const [{ data: ppl }, { data: mans }, { data: acts }, { data: revs }, { data: evs }, { data: topic }] = await Promise.all([
    db.from("people").select("id,display_name").limit(500),
    db.from("manuals").select("id,code,title,owner_role").eq("entity", e.entity).order("code"),
    db.from("safety_actions").select("*").eq("watch_entry_id", e.id).neq("status", "cancelled").order("created_at"),
    e.revision_ids.length ? db.from("revisions").select("id,rev,step,manual_id").in("id", e.revision_ids) : Promise.resolve({ data: [] }),
    db.from("audit_log").select("at,actor,action,after").eq("object_type", "watch_entry").eq("object_id", e.id).order("id", { ascending: false }).limit(30),
    e.topic_id ? db.from("watch_topics").select("id,title").eq("id", e.topic_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const name = (pid: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === pid)?.display_name ?? "—";
  const manuals = (mans ?? []) as { id: string; code: string; title: string; owner_role: string }[];
  const actions = (acts ?? []) as Action[];
  const revisions = (revs ?? []) as { id: string; rev: string; step: string; manual_id: string }[];
  const events = (evs ?? []) as { at: string; actor: string | null; action: string; after: Record<string, unknown> | null }[];
  const citations = e.reference && isOpen ? await findCitations(db, e.entity, e.reference) : [];
  const t0 = new Date().toISOString().slice(0, 10);
  const a = e.assistant;
  const tp = topic as { id: string; title: string } | null;
  return (
    <>
      <EntityBand entity={e.entity} current={s.entity} multi={s.entities.length > 1} what="entry" />
      <PageHeader eyebrow={`Compliance · Regulatory watch${tp ? ` · ${tp.title}` : ""}`} title={`${e.number} — ${e.title}`} sub={`${e.source_kind ? KIND_LABEL[e.source_kind] ?? e.source_kind : "—"}${e.domain ? ` · ${e.domain}` : ""}${e.reference ? ` · ${e.reference}` : ""}${e.published_on ? ` · published ${e.published_on}` : ""}${e.applicable_on ? ` · applicable from ${e.applicable_on}` : ""}${e.imported_from ? ` · imported from ${e.imported_from}` : ""}`}
        right={<span className="flex gap-2 items-center">{e.url && <a className="btn" href={e.url} target="_blank" rel="noreferrer">Open the text ↗</a>}{tp && <Link className="btn" href={`/comp/watch/topic/${tp.id}`}>Stream</Link>}<span className={"pill " + (e.status === "closed" ? "green" : isOpen ? "amber" : "")}>{STATUS_LABEL[e.status] ?? e.status}</span></span>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Applicability" value={APPL_LABEL[e.applicability] ?? e.applicability} tone={e.applicability === "applicable" ? "amber" : undefined} hint={e.task ? TASK_LABEL[e.task] : ""} />
        <Metric label="Tasked to" value={e.owner_person ? name(e.owner_person) : e.owner_role ?? "—"} />
        <Metric label="Return before" value={e.due ?? "—"} tone={e.due && e.due < t0 && isOpen ? "red" : undefined} />
        <Metric label="Done" value={`${revisions.length} draft${revisions.length === 1 ? "" : "s"} · ${actions.length} action${actions.length === 1 ? "" : "s"}`} hint={e.closed_at ? `closed ${e.closed_at.slice(0, 10)} · ${name(e.closed_by)}` : ""} />
      </div>
      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="grid gap-4">
          <section className="card samcard">
            <div className="ch"><span className="eyebrow">S.A.M. reading</span><span className="mini">{a ? `${a.at.slice(0, 16).replace("T", " ")}${a.model === "rules" ? " · citations only" : ""}` : "not run yet"}{may && isOpen && <form action={analyse} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="id" value={e.id} /><button className="btn mini" type="submit">{a ? "Read again" : "Read with S.A.M."}</button></form>}</span></div>
            <div className="cb grid gap-3">
              {a ? <>
                <p>{a.summary}</p>
                <div className="flex gap-2 items-center mini">Suggested: <span className={"pill " + (APPL_TONE[a.applicability] ?? "")}>{APPL_LABEL[a.applicability] ?? a.applicability}</span>{a.task && <span className="pill">{TASK_LABEL[a.task]}</span>}<span>— you decide below.</span></div>
                {a.chapters.length > 0 && <div><div className="eyebrow mb-1">Chapters concerned</div><ul className="pts">{a.chapters.map((c, i) => <li key={i}><b className="mono">{c.manual} {c.ref}</b>{c.why ? ` — ${c.why}` : ""}</li>)}</ul></div>}
              </> : <p className="mini">S.A.M. searches the reference in the published manuals and suggests applicability, chapters and the task. Suggestions only.</p>}
              {citations.length > 0 && <details><summary className="mini">{citations.length} citation{citations.length === 1 ? "" : "s"} of “{e.reference}” in the published manuals</summary><div className="mini mt-1 grid gap-1">{citations.map((c, i) => <div key={i}><b className="mono">{c.code} {c.ref}</b> {c.section_title} — <i>{c.snippet}</i></div>)}</div></details>}
              {e.reference && isOpen && !citations.length && <p className="mini">No published chapter cites “{e.reference}”.</p>}
            </div>
          </section>

          <section className="card">
            <div className="ch"><span className="eyebrow">Decision — applicability, impact, who, when</span></div>
            <div className="cb">{may && isOpen ? (
              <form action={updateEntry} className="grid gap-2 grid-cols-2"><input type="hidden" name="id" value={e.id} />
                <label><span className="mini">Applicability</span><select name="applicability" className="inp" defaultValue={e.applicability}>{Object.entries(APPL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span className="mini">Task</span><select name="task" className="inp" defaultValue={e.task ?? ""}><option value="">—</option>{Object.entries(TASK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="col-span-2"><span className="mini">Impact — manuals, procedures, training, people to inform</span><textarea name="impact" className="inp" rows={3} defaultValue={e.impact ?? ""} /></label>
                <div className="col-span-2"><span className="mini">Manuals concerned (S.A.M. shows the entry to the author when a draft opens)</span><div className="grid grid-cols-3 gap-1 mt-1 mini">{manuals.map((m) => <label key={m.id}><input type="checkbox" name="manual_ids" value={m.id} defaultChecked={e.manual_ids.includes(m.id) || (a?.chapters ?? []).some((c) => c.manual === m.code)} /> {m.code}</label>)}{!manuals.length && <span>No manual imported for this entity yet.</span>}</div></div>
                <label><span className="mini">Tasked to — post</span><input name="owner_role" className="inp mono" defaultValue={e.owner_role ?? ""} /></label>
                <label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue={e.owner_person ?? ""}><option value="">—</option>{((ppl ?? []) as { id: string; display_name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
                <label><span className="mini">Return before</span><input type="date" name="due" className="inp" defaultValue={e.due ?? ""} /></label>
                <label><span className="mini">Applicable from</span><input type="date" name="applicable_on" className="inp" defaultValue={e.applicable_on ?? ""} /></label>
                {desk && <><label><span className="mini">Reference</span><input name="reference" className="inp mono" defaultValue={e.reference ?? ""} /></label><label><span className="mini">Link</span><input name="url" className="inp" defaultValue={e.url ?? ""} /></label></>}
                <div className="col-span-2 flex justify-end"><button className="btn primary" type="submit">Save</button></div>
              </form>) : <div className="grid gap-2"><p style={{ whiteSpace: "pre-wrap" }}>{e.impact ?? <span className="mini">No impact recorded.</span>}</p>{e.manual_ids.length > 0 && <div className="mini">Manuals: {manuals.filter((m) => e.manual_ids.includes(m.id)).map((m) => m.code).join(", ")}</div>}</div>}</div>
          </section>

          <section className="card"><div className="ch"><span className="eyebrow">History</span></div><div className="cb mini">{events.map((x, i) => <div key={i}>{x.at.slice(0, 16).replace("T", " ")} · {x.action.replace(/^watch_/, "").replace(/_/g, " ")} · {name(x.actor)}</div>)}</div></section>
        </div>

        <div className="grid gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">What we did</span><span className="mini">drafts opened, actions raised, conclusion</span></div>
            <div className="cb grid gap-3">
              <div><div className="eyebrow mb-1">Manual revisions</div>
                {revisions.length ? <ul className="pts">{revisions.map((r) => { const m = manuals.find((x) => x.id === r.manual_id); return <li key={r.id}><Link href={`/docs/editor/${r.id}`}><b className="mono">{m?.code ?? "manual"}</b> Rev {r.rev}</Link> <span className="mini">· {r.step.replace(/_/g, " ")}</span></li>; })}</ul> : <p className="mini">None.</p>}
                {may && isOpen && manuals.length > 0 && <form action={draftFor} className="flex gap-2 items-end mt-2"><input type="hidden" name="id" value={e.id} /><label style={{ flex: 1 }}><span className="mini">Open a draft to address it</span><select name="manual" className="inp" defaultValue={manuals.find((m) => e.manual_ids.includes(m.id))?.id ?? ""}><option value="">— manual —</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</select></label><button className="btn" type="submit">Open the draft</button></form>}
              </div>
              <div><div className="eyebrow mb-1">Actions</div>
                {actions.length ? <table className="tbl"><tbody>{actions.map((x) => <tr key={x.id}><td><Link href={`/safe/actions/${x.id}`}><b className="mono">{x.number}</b> {x.title}</Link><div className="mini">{x.owner_role ?? name(x.owner_person)} · due {x.due ?? "—"}</div></td><td style={{ textAlign: "right" }}><span className={"pill " + (ACTION_STATUS[x.status]?.[1] ?? "")}>{ACTION_STATUS[x.status]?.[0] ?? x.status}</span></td></tr>)}</tbody></table> : <p className="mini">None.</p>}
                {may && isOpen && <details className="mt-2"><summary className="mini">+ Action (training, information, contract, check…)</summary><div className="mt-2"><NewActionForm entity={e.entity} source="other" watch_entry_id={e.id} owner_role={e.owner_role} compact stay /></div></details>}
              </div>
              {e.conclusion && <div><div className="eyebrow mb-1">Conclusion</div><p style={{ whiteSpace: "pre-wrap" }}>{e.conclusion}</p></div>}
              {may && isOpen && (
                <form action={setEntryStatus} className="grid gap-2" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={e.id} />
                  <label><span className="mini">Conclusion — what was done, or why nothing is needed</span><textarea name="note" className="inp" rows={2} defaultValue={e.conclusion ?? ""} /></label>
                  <div className="flex gap-2 justify-end flex-wrap">
                    {e.status === "open" && <button className="btn" name="what" value="start">Start</button>}
                    <button className="btn" name="what" value="na">Not applicable</button>
                    {e.status !== "done" && <button className="btn" name="what" value="done">Done — to close</button>}
                    {desk && <button className="btn primary" name="what" value="close">Close</button>}
                  </div>
                </form>)}
              {!isOpen && desk && <form action={setEntryStatus} className="flex justify-end"><input type="hidden" name="id" value={e.id} /><button className="btn mini" name="what" value="reopen">Reopen</button></form>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
