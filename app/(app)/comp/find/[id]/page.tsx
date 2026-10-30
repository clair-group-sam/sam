import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import EntityBand from "@/components/EntityBand";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_STATUS } from "@/lib/actions-shared";
import { CHANGE_LABEL, LEVEL_LABEL, loadFinding, plan, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/findings";
import { addChange, answerFinding, decideClosure, openDossier, removeChange, requestClosure, reviewAnswer, updateFinding, verifyChange } from "../actions";

/* FND-03 · the finding sheet. Left: the finding, the analysis (answer rounds), the history. Right: the corrective action plan, the
 * Compliance review (with S.A.M.'s pre-reading as suggestions), the dossier. Nothing on this page judges the person: a send-back
 * reads "Analysis sent back — N points to address", with the points. */
export default async function FindingSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const x = await loadFinding(db, id);
  if (!x) notFound();
  const { f, rounds, changes, actions } = x;
  const compliance = s.role === "cmm";
  const posts = s.roles.map(basePost);
  const owner = (!!f.owner_person && f.owner_person === s.person?.id) || (!!f.owner_role && s.entities.includes(f.entity) && posts.includes(basePost(f.owner_role)));
  const mayAnswer = (owner || compliance) && ["open", "sent_back"].includes(f.status);
  const mayPlan = (owner || compliance) && !["closed", "cancelled"].includes(f.status);
  const current = rounds.find((r) => r.n === f.current_round) ?? null;
  const last = rounds[rounds.length - 1] ?? null;
  const p = plan(changes, actions);
  const t0 = new Date().toISOString().slice(0, 10);
  const [{ data: ppl }, { data: mans }, { data: evs }] = await Promise.all([
    db.from("people").select("id,display_name").limit(500),
    db.from("manuals").select("id,code,title").eq("entity", f.entity).order("code"),
    db.from("audit_log").select("at,actor,action,after").eq("object_type", "finding").eq("object_id", f.id).order("id", { ascending: false }).limit(40),
  ]);
  const name = (pid: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((q) => q.id === pid)?.display_name ?? "—";
  const manuals = (mans ?? []) as { id: string; code: string; title: string }[];
  const events = (evs ?? []) as { at: string; actor: string | null; action: string; after: Record<string, unknown> | null }[];
  const sentBack = f.status === "sent_back" && current?.decision === "sent_back" ? current : null;
  const nextRound = f.current_round + 1;
  return (
    <>
      <EntityBand entity={f.entity} current={s.entity} multi={s.entities.length > 1} what="finding" />
      <PageHeader eyebrow={`Compliance · Findings · ${SOURCE_LABEL[f.source] ?? f.source}${f.authority ? ` · ${f.authority}` : ""}`} title={`${f.number} — ${f.title}`} sub={`${LEVEL_LABEL[f.level] ?? f.level}${f.requirement ? ` · ${f.requirement}` : ""}${f.audit_ref ? ` · ${f.audit_ref}` : ""} · raised ${f.notified ?? "—"} · answer due ${f.due ?? "—"} · answered by ${f.owner_person ? name(f.owner_person) : f.owner_role ?? "—"}`}
        right={<span className={"pill " + (STATUS_TONE[f.status] ?? "")}>{STATUS_LABEL[f.status] ?? f.status}</span>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Status" value={STATUS_LABEL[f.status] ?? f.status} hint={f.current_round ? `round ${f.current_round}` : "no answer yet"} />
        <Metric label="Answer due" value={f.due ?? "—"} tone={f.due && f.due < t0 && ["open", "sent_back"].includes(f.status) ? "red" : undefined} />
        <Metric label="Corrective plan" value={p.total ? `${p.done} / ${p.total}` : "—"} hint={p.total ? (p.remaining.length ? `${p.remaining.length} remaining` : "complete") : "nothing planned yet"} tone={p.total && !p.remaining.length ? "green" : undefined} />
        <Metric label="Rounds" value={rounds.length} hint={rounds.filter((r) => r.decision === "sent_back").length ? `${rounds.filter((r) => r.decision === "sent_back").length} sent back` : ""} />
      </div>

      {sentBack && (
        <section className="card mb-4 sentback">
          <div className="ch"><span className="eyebrow">Analysis sent back — {sentBack.points?.length ?? 0} point{(sentBack.points?.length ?? 0) === 1 ? "" : "s"} to address</span><span className="mini">by {name(sentBack.decided_by)} · {sentBack.decided_at?.slice(0, 10)}</span></div>
          <div className="cb"><ul className="pts">{(sentBack.points ?? []).map((q, i) => <li key={i}><b>{q.label}</b>{q.detail && q.detail !== q.label ? <> — {q.detail}</> : null}</li>)}</ul><p className="mini mt-2">Complete the analysis below (round {nextRound}); your previous text is kept as a starting point.</p></div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="grid gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">The finding</span>{compliance && <details className="inlineedit"><summary className="mini">Edit</summary>
              <form action={updateFinding} className="grid gap-2 grid-cols-2 mt-2"><input type="hidden" name="id" value={f.id} />
                <label className="col-span-2"><span className="mini">Title</span><input name="title" className="inp" defaultValue={f.title} /></label>
                <label><span className="mini">Requirement</span><input name="requirement" className="inp mono" defaultValue={f.requirement ?? ""} /></label>
                <label><span className="mini">Level</span><select name="level" className="inp" defaultValue={f.level}>{Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span className="mini">Authority / auditor</span><input name="authority" className="inp" defaultValue={f.authority ?? ""} /></label>
                <label><span className="mini">Reference</span><input name="audit_ref" className="inp" defaultValue={f.audit_ref ?? ""} /></label>
                <label><span className="mini">Raised on</span><input type="date" name="notified" className="inp" defaultValue={f.notified ?? ""} /></label>
                <label><span className="mini">Answer due</span><input type="date" name="due" className="inp" defaultValue={f.due ?? ""} /></label>
                <label><span className="mini">Answered by — post</span><input name="owner_role" className="inp mono" defaultValue={f.owner_role ?? ""} /></label>
                <label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue={f.owner_person ?? ""}><option value="">—</option>{((ppl ?? []) as { id: string; display_name: string }[]).map((q) => <option key={q.id} value={q.id}>{q.display_name}</option>)}</select></label>
                <label className="col-span-2"><span className="mini">Text</span><textarea name="description" className="inp" rows={4} defaultValue={f.description ?? ""} /></label>
                <div className="col-span-2 flex justify-end"><button className="btn" type="submit">Save</button></div></form></details>}</div>
            <div className="cb"><p style={{ whiteSpace: "pre-wrap" }}>{f.description ?? <span className="mini">No text pasted.</span>}</p></div>
          </section>

          <section className="card">
            <div className="ch"><span className="eyebrow">{mayAnswer ? `Analysis — round ${nextRound}` : `Analysis${current ? ` — round ${current.n}` : ""}`}</span>{current && !mayAnswer && <span className="mini">by {name(current.answered_by)} · {current.answered_at.slice(0, 10)}{current.via === "teams" ? " · via Teams" : ""}</span>}</div>
            <div className="cb">
              {mayAnswer ? (
                <form action={answerFinding} className="grid gap-3"><input type="hidden" name="id" value={f.id} />
                  <label><span className="mini">Root cause — why did the organisation let this happen? (not what was found, not who)</span><textarea name="root_cause" className="inp" rows={4} required defaultValue={last?.root_cause ?? ""} placeholder="Example: the procedure for … did not name who checks …, so the check depended on memory when the roster changed." /></label>
                  <label><span className="mini">Contributing factors — procedure, training, resources, supervision, interface, tools</span><textarea name="factors" className="inp" rows={3} defaultValue={last?.factors ?? ""} /></label>
                  <label><span className="mini">Immediate action taken</span><textarea name="immediate" className="inp" rows={2} defaultValue={last?.immediate ?? ""} /></label>
                  <div className="flex items-center justify-between"><span className="mini">Add the expected manual changes and the actions on the right before sending — they are part of the answer.</span><button className="btn primary" type="submit">Send the analysis to Compliance</button></div>
                </form>
              ) : current ? (
                <div className="grid gap-3">
                  <div><div className="eyebrow">Root cause</div><p style={{ whiteSpace: "pre-wrap" }}>{current.root_cause}</p></div>
                  {current.factors && <div><div className="eyebrow">Contributing factors</div><p style={{ whiteSpace: "pre-wrap" }}>{current.factors}</p></div>}
                  {current.immediate && <div><div className="eyebrow">Immediate action</div><p style={{ whiteSpace: "pre-wrap" }}>{current.immediate}</p></div>}
                  {current.decision === "accepted" && <p className="mini">Accepted by {name(current.decided_by)} on {current.decided_at?.slice(0, 10)}{current.note ? ` — ${current.note}` : ""}.</p>}
                </div>
              ) : <p className="mini">Waiting for {f.owner_person ? name(f.owner_person) : f.owner_role}.</p>}
            </div>
          </section>

          {rounds.length > (mayAnswer ? 0 : 1) && (
            <section className="card">
              <div className="ch"><span className="eyebrow">Previous rounds</span></div>
              <div className="cb grid gap-3">
                {rounds.filter((r) => mayAnswer || r.n !== current?.n).reverse().map((r) => (
                  <details key={r.id}><summary><b>Round {r.n}</b> · {name(r.answered_by)} · {r.answered_at.slice(0, 10)} · {r.decision === "accepted" ? "accepted" : r.decision === "sent_back" ? `sent back — ${r.points?.length ?? 0} point${(r.points?.length ?? 0) === 1 ? "" : "s"}` : "under review"}</summary>
                    <div className="mini mt-2" style={{ whiteSpace: "pre-wrap" }}><b>Root cause.</b> {r.root_cause}{r.factors ? <><br /><b>Factors.</b> {r.factors}</> : null}{r.immediate ? <><br /><b>Immediate.</b> {r.immediate}</> : null}</div>
                    {r.decision === "sent_back" && <ul className="pts mini mt-2">{(r.points ?? []).map((q, i) => <li key={i}><b>{q.label}</b> — {q.detail}</li>)}</ul>}
                  </details>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <div className="ch"><span className="eyebrow">History</span></div>
            <div className="cb mini">{events.length ? events.map((e, i) => <div key={i}>{e.at.slice(0, 16).replace("T", " ")} · {e.action.replace(/^finding_/, "").replace(/_/g, " ")} · {name(e.actor)}</div>) : "—"}</div>
          </section>
        </div>

        <div className="grid gap-4">
          {compliance && f.status === "answered" && current && (
            <section className="card review">
              <div className="ch"><span className="eyebrow">Compliance review — round {current.n}</span><span className="mini">S.A.M. pre-read: {current.assistant ? `${current.assistant.verdict.replace("_", " ")} · ${current.assistant.points.length} suggestion${current.assistant.points.length === 1 ? "" : "s"}${current.assistant.model === "rules" ? " (rules)" : ""}` : "not available"}</span></div>
              <div className="cb">
                <form action={reviewAnswer} className="grid gap-3"><input type="hidden" name="id" value={f.id} />
                  {current.assistant?.points.length ? (
                    <div><div className="mini mb-1">Suggestions — tick the ones to send back to {f.owner_person ? name(f.owner_person) : f.owner_role}; nothing goes out unticked.</div>
                      <ul className="pts chk">{current.assistant.points.map((q) => <li key={q.code}><label><input type="checkbox" name="point" value={q.code} /> <b>{q.label}</b> — {q.detail}</label></li>)}</ul></div>
                  ) : <p className="mini">S.A.M. found nothing to point out: the cause explains, the factors are there, the plan addresses them.</p>}
                  <label><span className="mini">Your note to the nominated person (optional — added as a point if you send back)</span><textarea name="note" className="inp" rows={2} /></label>
                  <div className="flex gap-2 justify-end"><button className="btn" type="submit" name="decision" value="back">Send back with the ticked points</button><button className="btn primary" type="submit" name="decision" value="accept">Accept the analysis and the plan</button></div>
                </form>
              </div>
            </section>
          )}

          <section className="card">
            <div className="ch"><span className="eyebrow">Corrective action plan</span><span className="mini">{p.total ? `${p.done} / ${p.total} done` : "empty"}</span></div>
            {p.total > 0 && <div className="bar"><i style={{ width: `${Math.round((100 * p.done) / p.total)}%` }} /></div>}
            <div className="cb grid gap-3">
              <div>
                <div className="eyebrow mb-1">Expected manual changes <span className="mini">(S.A.M. shows them to the author when a draft of the manual opens; verified after publication)</span></div>
                {changes.length ? <table className="tbl"><tbody>{changes.map((c) => (
                  <tr key={c.id}><td><b className="mono">{c.manual_code ?? "manual"}</b> {c.section_ref}<div className="mini">{c.expected}</div>{c.verified_note && <div className="mini">Compliance: {c.verified_note}</div>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><span className={"pill " + (c.status === "verified" ? "green" : c.status === "published" ? "amber" : "")}>{CHANGE_LABEL[c.status] ?? c.status}</span>
                      {c.revision_id && <div className="mini"><Link href={`/docs/editor/${c.revision_id}`}>open revision</Link></div>}
                      {c.status === "published" && compliance && <form action={verifyChange} className="flex gap-1 justify-end mt-1"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} /><input name="note" className="inp" placeholder="text found / remark" style={{ width: 160, marginTop: 0 }} /><button className="btn" name="verdict" value="ok">Verified</button><button className="btn" name="verdict" value="no">Not in</button></form>}
                      {["pending", "deferred"].includes(c.status) && mayPlan && <form action={removeChange} className="mt-1"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} /><button className="btn mini" type="submit">Remove</button></form>}</td></tr>))}</tbody></table>
                  : <p className="mini">None yet.</p>}
                {mayPlan && (
                  <details className="mt-2"><summary className="mini">+ Expected manual change</summary>
                    <form action={addChange} className="grid gap-2 grid-cols-3 mt-2"><input type="hidden" name="id" value={f.id} />
                      <label><span className="mini">Manual</span><select name="manual_id" className="inp" defaultValue=""><option value="">— not in S.A.M. yet —</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</select></label>
                      <label><span className="mini">or code</span><input name="manual_code" className="inp mono" placeholder="OM-A" /></label>
                      <label><span className="mini">Section</span><input name="section_ref" className="inp mono" placeholder="5.2.3" /></label>
                      <label className="col-span-3"><span className="mini">What must change</span><input name="expected" className="inp" required placeholder="Name who checks …, add the record …" /></label>
                      <div className="col-span-3 flex justify-end"><button className="btn" type="submit">Add</button></div></form></details>
                )}
              </div>
              <div>
                <div className="eyebrow mb-1">Other actions <span className="mini">(contracts, training, audits, tools — owner, date, evidence, verified by Compliance)</span></div>
                {actions.length ? <table className="tbl"><tbody>{actions.map((a) => <tr key={a.id}><td><Link href={`/safe/actions/${a.id}`}><b className="mono">{a.number}</b> {a.title}</Link><div className="mini">{a.owner_role ?? name(a.owner_person)} · due {a.due ?? "—"}</div></td><td style={{ textAlign: "right" }}><span className={"pill " + (ACTION_STATUS[a.status]?.[1] ?? "")}>{ACTION_STATUS[a.status]?.[0] ?? a.status}</span></td></tr>)}</tbody></table> : <p className="mini">None yet.</p>}
                {mayPlan && <details className="mt-2"><summary className="mini">+ Action</summary><div className="mt-2"><NewActionForm entity={f.entity} source="finding" finding_id={f.id} owner_role={f.owner_role} compact stay /></div></details>}
              </div>
              {f.status === "accepted" && (owner || compliance) && <form action={requestClosure} className="flex items-center justify-between" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={f.id} /><span className="mini">{p.remaining.length ? `${p.remaining.length} item${p.remaining.length === 1 ? "" : "s"} still open — S.A.M. proposes the closure when everything is verified.` : "Everything is verified."}</span><button className="btn" type="submit" disabled={!!p.remaining.length && !compliance}>Request closure</button></form>}
            </div>
          </section>

          {compliance && f.status === "closure_requested" && (
            <section className="card review">
              <div className="ch"><span className="eyebrow">Closure requested</span><span className="mini">{p.remaining.length ? `${p.remaining.length} item(s) not verified` : "plan complete"}</span></div>
              <div className="cb"><form action={decideClosure} className="grid gap-2"><input type="hidden" name="id" value={f.id} />
                {p.remaining.length > 0 && <ul className="pts mini">{p.remaining.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                <label><span className="mini">Closure note (evidence, reference of the authority's acceptance)</span><textarea name="note" className="inp" rows={2} /></label>
                <div className="flex gap-2 justify-end"><button className="btn" name="what" value="reopen">Back to the plan</button><button className="btn primary" name="what" value="close">Close the finding</button></div></form></div>
            </section>
          )}

          <section className="card">
            <div className="ch"><span className="eyebrow">Authority dossier</span><span className="mini">OM-FND · manual revision for finding closure</span></div>
            <div className="cb flex items-center justify-between">
              {f.authority_file_id ? <Link className="btn" href={`/proj/auth/${f.authority_file_id}`}>Open the dossier</Link> : <span className="mini">No dossier yet. Open it when a manual revision answers the finding at the authority.</span>}
              {compliance && !f.authority_file_id && <form action={openDossier}><input type="hidden" name="id" value={f.id} /><button className="btn" type="submit">Open the dossier</button></form>}
            </div>
          </section>

          {compliance && !["closed", "cancelled"].includes(f.status) && f.status !== "closure_requested" && (
            <details className="card"><summary className="ch" style={{ cursor: "pointer" }}><span className="eyebrow">Close or cancel</span></summary>
              <div className="cb"><form action={decideClosure} className="grid gap-2"><input type="hidden" name="id" value={f.id} />
                <label><span className="mini">Note</span><input name="note" className="inp" placeholder="Why — accepted by the authority on …, raised by mistake…" /></label>
                <div className="flex gap-2 justify-end"><button className="btn" name="what" value="cancel">Cancel the finding</button><button className="btn" name="what" value="close">Close directly</button></div></form></div></details>
          )}
          {f.closed_at && <section className="card"><div className="ch"><span className="eyebrow">{f.status === "cancelled" ? "Cancelled" : "Closed"}</span><span className="mini">{f.closed_at.slice(0, 10)} · {name(f.closed_by)}</span></div>{f.closed_note && <div className="cb">{f.closed_note}</div>}</section>}
        </div>
      </div>
    </>
  );
}
