import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import EntityBand from "@/components/EntityBand";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_STATUS } from "@/lib/actions-shared";
import { CHANGE_LABEL, LEVEL_LABEL, loadFinding, plan, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, STEP_OF, STEPS_PATH, type Round } from "@/lib/findings";
import { addChange, answerFinding, decideClosure, openDossier, removeChange, requestClosure, reviewAnswer, sendPlan, updateFinding, verifyChange } from "../actions";

/* FND-03 · the finding sheet, step by step: 1 root cause (NP writes, Compliance accepts) → 2 action plan (NP builds, Compliance accepts)
 * → 3 plan in progress (followed by S.A.M.) → 4 closure. S.A.M.'s pre-reading is shown to Compliance only, as suggestions to tick;
 * the NP sees "sent back — N points to address" with the points. Nothing on this page judges the person. */
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
  const actor = owner || compliance;
  const step = STEP_OF[f.status] ?? 0;
  const closedOrCancelled = ["closed", "cancelled"].includes(f.status);
  const rcaRounds = rounds.filter((r) => r.stage === "rca"), planRounds = rounds.filter((r) => r.stage === "plan");
  const rca = rcaRounds.find((r) => r.n === f.current_round) ?? null;
  const planR = planRounds.find((r) => r.n === f.plan_round) ?? null;
  const lastRca = rcaRounds[rcaRounds.length - 1] ?? null;
  const mayWriteRca = actor && ["open", "rca_back"].includes(f.status);
  const maySendPlan = actor && ["plan", "plan_back"].includes(f.status);
  const mayEditPlan = (actor && step >= 2 && !closedOrCancelled && f.status !== "closure_requested") || (compliance && !closedOrCancelled);
  const reviewing: Round | null = compliance && f.status === "rca_review" ? rca : compliance && f.status === "plan_review" ? planR : null;
  const sentBack: Round | null = f.status === "rca_back" ? rca : f.status === "plan_back" ? planR : null;
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
  const who = f.owner_person ? name(f.owner_person) : f.owner_role ?? "—";
  const Pts = ({ pts }: { pts: Round["points"] }) => <ul className="pts">{(pts ?? []).map((q, i) => <li key={i}><b>{q.label}</b>{q.detail && q.detail !== q.label ? <> — {q.detail}</> : null}</li>)}</ul>;
  const RcaText = ({ r }: { r: Round }) => <div className="grid gap-3">
    <div><div className="eyebrow">Root cause</div><p style={{ whiteSpace: "pre-wrap" }}>{r.root_cause}</p></div>
    {r.factors && <div><div className="eyebrow">Contributing factors</div><p style={{ whiteSpace: "pre-wrap" }}>{r.factors}</p></div>}
    {r.immediate && <div><div className="eyebrow">Immediate action</div><p style={{ whiteSpace: "pre-wrap" }}>{r.immediate}</p></div>}
  </div>;
  const ReviewCard = ({ r, stage }: { r: Round; stage: "rca" | "plan" }) => (
    <section className="card review">
      <div className="ch"><span className="eyebrow">Compliance review — step {stage === "rca" ? "1 · root cause" : "2 · action plan"} · round {r.n}</span><span className="mini">S.A.M. pre-read: {r.assistant ? `${r.assistant.verdict.replace("_", " ")} · ${r.assistant.points.length} suggestion${r.assistant.points.length === 1 ? "" : "s"}${r.assistant.model === "rules" ? " (rules — Claude unavailable)" : ""}` : "not available"}</span></div>
      <div className="cb">
        <form action={reviewAnswer} className="grid gap-3"><input type="hidden" name="id" value={f.id} />
          {r.assistant?.points.length ? (
            <div><div className="mini mb-1">Suggestions — tick the ones to send back to {who}; nothing goes out unticked.</div>
              <ul className="pts chk">{r.assistant.points.map((q) => <li key={q.code}><label><input type="checkbox" name="point" value={q.code} /> <span><b>{q.label}</b> — {q.detail}</span></label></li>)}</ul></div>
          ) : <p className="mini">S.A.M. found nothing to point out.</p>}
          <label><span className="mini">Your note to {who} (optional — added as a point if you send back)</span><textarea name="note" className="inp" rows={2} /></label>
          <div className="flex gap-2 justify-end"><button className="btn" type="submit" name="decision" value="back">Send back with the ticked points</button><button className="btn primary" type="submit" name="decision" value="accept">{stage === "rca" ? "Accept the root cause — open step 2" : "Accept the plan — it starts"}</button></div>
        </form>
      </div>
    </section>
  );
  return (
    <>
      <EntityBand entity={f.entity} current={s.entity} multi={s.entities.length > 1} what="finding" />
      <PageHeader eyebrow={`Compliance · Findings · ${SOURCE_LABEL[f.source] ?? f.source}${f.authority ? ` · ${f.authority}` : ""}`} title={`${f.number} — ${f.title}`} sub={`${LEVEL_LABEL[f.level] ?? f.level}${f.requirement ? ` · ${f.requirement}` : ""}${f.audit_ref ? ` · ${f.audit_ref}` : ""} · raised ${f.notified ?? "—"} · answer due ${f.due ?? "—"} · answered by ${who}`}
        right={<span className={"pill " + (STATUS_TONE[f.status] ?? "")}>{STATUS_LABEL[f.status] ?? f.status}</span>} />

      <div className="fsteps mb-4">{STEPS_PATH.map((l, i) => <div key={l} className={"fstep" + (step > i + 1 || f.status === "closed" ? " done" : step === i + 1 ? " on" : "")}><i>{step > i + 1 || f.status === "closed" ? "✓" : i + 1}</i><span>{l}</span></div>)}</div>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Where" value={STATUS_LABEL[f.status] ?? f.status} hint={["rca_review", "plan_review", "closure_requested"].includes(f.status) ? "Compliance's turn" : closedOrCancelled ? "" : `${who}'s turn`} />
        <Metric label="Answer due" value={f.due ?? "—"} tone={f.due && f.due < t0 && step <= 2 ? "red" : undefined} />
        <Metric label="Corrective plan" value={p.total ? `${p.done} / ${p.total}` : "—"} hint={p.total ? (p.remaining.length ? `${p.remaining.length} remaining` : "complete") : step < 2 ? "opens at step 2" : "nothing planned yet"} tone={p.total && !p.remaining.length ? "green" : undefined} />
        <Metric label="Rounds" value={`${rcaRounds.length} · ${planRounds.length}`} hint={`root cause · plan${rounds.some((r) => r.decision === "sent_back") ? ` · ${rounds.filter((r) => r.decision === "sent_back").length} sent back` : ""}`} />
      </div>

      {sentBack && sentBack.decision === "sent_back" && (
        <section className="card mb-4 sentback">
          <div className="ch"><span className="eyebrow">{f.status === "rca_back" ? "Root cause" : "Action plan"} sent back — {sentBack.points?.length ?? 0} point{(sentBack.points?.length ?? 0) === 1 ? "" : "s"} to address</span><span className="mini">by {name(sentBack.decided_by)} · {sentBack.decided_at?.slice(0, 10)}</span></div>
          <div className="cb"><Pts pts={sentBack.points} /><p className="mini mt-2">{f.status === "rca_back" ? "Complete the analysis below; your previous text is kept as a starting point." : "Adjust the plan on the right, then send it again."}</p></div>
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

          {/* step 1 */}
          <section className={"card" + (step === 1 ? " stepon" : "")}>
            <div className="ch"><span className="eyebrow">Step 1 · Root cause{mayWriteRca ? ` — round ${f.current_round + 1}` : rca ? ` — round ${rca.n}` : ""}</span>{rca && !mayWriteRca && <span className="mini">{rca.decision === "accepted" ? `accepted by ${name(rca.decided_by)} · ${rca.decided_at?.slice(0, 10)}` : `by ${name(rca.answered_by)} · ${rca.answered_at.slice(0, 10)}`}</span>}</div>
            <div className="cb">
              {mayWriteRca ? (
                <form action={answerFinding} className="grid gap-3"><input type="hidden" name="id" value={f.id} />
                  <label><span className="mini">Root cause — why did the organisation let this happen? (not what was found, not who)</span><textarea name="root_cause" className="inp" rows={4} required defaultValue={lastRca?.root_cause ?? ""} placeholder="Example: the procedure for … did not name who checks …, so the check depended on memory when the roster changed." /></label>
                  <label><span className="mini">Contributing factors — procedure, training, resources, supervision, interface, tools</span><textarea name="factors" className="inp" rows={3} defaultValue={lastRca?.factors ?? ""} /></label>
                  <label><span className="mini">Immediate action taken</span><textarea name="immediate" className="inp" rows={2} defaultValue={lastRca?.immediate ?? ""} /></label>
                  <div className="flex items-center justify-between"><span className="mini">Step 2, the action plan, opens once Compliance accepts the cause.</span><button className="btn primary" type="submit">Send the root cause to Compliance</button></div>
                </form>
              ) : rca ? <RcaText r={rca} /> : <p className="mini">Waiting for {who}.</p>}
            </div>
          </section>

          {rcaRounds.length > 1 && (
            <section className="card"><div className="ch"><span className="eyebrow">Previous root cause rounds</span></div>
              <div className="cb grid gap-2">{rcaRounds.filter((r) => r !== rca || mayWriteRca).reverse().map((r) => <details key={r.id}><summary><b>Round {r.n}</b> · {name(r.answered_by)} · {r.answered_at.slice(0, 10)} · {r.decision === "accepted" ? "accepted" : r.decision === "sent_back" ? `sent back — ${r.points?.length ?? 0} point${(r.points?.length ?? 0) === 1 ? "" : "s"}` : "under review"}</summary><div className="mini mt-2"><RcaText r={r} /></div>{r.decision === "sent_back" && <div className="mini mt-2"><Pts pts={r.points} /></div>}</details>)}</div></section>
          )}

          <section className="card">
            <div className="ch"><span className="eyebrow">History</span></div>
            <div className="cb mini">{events.length ? events.map((e, i) => <div key={i}>{e.at.slice(0, 16).replace("T", " ")} · {e.action.replace(/^finding_/, "").replace(/_/g, " ")} · {name(e.actor)}</div>) : "—"}</div>
          </section>
        </div>

        <div className="grid gap-4">
          {reviewing && <ReviewCard r={reviewing} stage={f.status === "rca_review" ? "rca" : "plan"} />}

          {/* step 2 */}
          <section className={"card" + (step === 2 ? " stepon" : "") + (step < 2 ? " locked" : "")}>
            <div className="ch"><span className="eyebrow">Step 2 · Corrective action plan{planR && step >= 2 ? ` — round ${planR.n}` : ""}</span><span className="mini">{step < 2 ? "opens once the root cause is accepted" : p.total ? `${p.done} / ${p.total} done` : "empty"}</span></div>
            {step >= 2 && p.total > 0 && <div className="bar"><i style={{ width: `${Math.round((100 * p.done) / p.total)}%` }} /></div>}
            {step < 2 ? <div className="cb mini">The plan is built against the accepted cause: expected manual changes (S.A.M. follows them through the revision) and other actions (owner, date, evidence).</div> : (
              <div className="cb grid gap-3">
                {planR?.decision === "accepted" && <p className="mini">Plan accepted by {name(planR.decided_by)} on {planR.decided_at?.slice(0, 10)}{planR.note ? ` — ${planR.note}` : ""}.</p>}
                <div>
                  <div className="eyebrow mb-1">Expected manual changes <span className="mini">(shown to the author when a draft of the manual opens; verified after publication)</span></div>
                  {changes.length ? <table className="tbl"><tbody>{changes.map((c) => (
                    <tr key={c.id}><td><b className="mono">{c.manual_code ?? "manual"}</b> {c.section_ref}<div className="mini">{c.expected}</div>{c.verified_note && <div className="mini">Compliance: {c.verified_note}</div>}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><span className={"pill " + (c.status === "verified" ? "green" : c.status === "published" ? "amber" : "")}>{CHANGE_LABEL[c.status] ?? c.status}</span>
                        {c.revision_id && <div className="mini"><Link href={`/docs/editor/${c.revision_id}`}>open revision</Link></div>}
                        {c.status === "published" && compliance && <form action={verifyChange} className="flex gap-1 justify-end mt-1"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} /><input name="note" className="inp" placeholder="text found / remark" style={{ width: 160, marginTop: 0 }} /><button className="btn" name="verdict" value="ok">Verified</button><button className="btn" name="verdict" value="no">Not in</button></form>}
                        {["pending", "deferred"].includes(c.status) && mayEditPlan && <form action={removeChange} className="mt-1"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} /><button className="btn mini" type="submit">Remove</button></form>}</td></tr>))}</tbody></table>
                    : <p className="mini">None yet.</p>}
                  {mayEditPlan && (
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
                  {mayEditPlan && <details className="mt-2"><summary className="mini">+ Action</summary><div className="mt-2"><NewActionForm entity={f.entity} source="finding" finding_id={f.id} owner_role={f.owner_role} compact stay /></div></details>}
                </div>
                {maySendPlan && (
                  <form action={sendPlan} className="grid gap-2" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={f.id} />
                    <label><span className="mini">Note to Compliance (optional — how the plan answers the cause)</span><textarea name="comment" className="inp" rows={2} /></label>
                    <div className="flex items-center justify-between"><span className="mini">{p.total ? `${p.total} item${p.total === 1 ? "" : "s"} in the plan` : "Add at least one change or one action."}</span><button className="btn primary" type="submit" disabled={!p.total}>Send the plan to Compliance</button></div>
                  </form>
                )}
                {f.status === "accepted" && actor && <form action={requestClosure} className="flex items-center justify-between" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={f.id} /><span className="mini">{p.remaining.length ? `${p.remaining.length} item${p.remaining.length === 1 ? "" : "s"} still open — S.A.M. proposes the closure when everything is verified.` : "Everything is verified."}</span><button className="btn" type="submit" disabled={!!p.remaining.length && !compliance}>Request closure</button></form>}
              </div>
            )}
          </section>

          {planRounds.filter((r) => r.decision === "sent_back").length > 0 && (
            <section className="card"><div className="ch"><span className="eyebrow">Previous plan rounds</span></div>
              <div className="cb grid gap-2">{planRounds.filter((r) => r.decision).reverse().map((r) => <details key={r.id}><summary><b>Round {r.n}</b> · {name(r.answered_by)} · {r.answered_at.slice(0, 10)} · {r.decision === "accepted" ? "accepted" : `sent back — ${r.points?.length ?? 0} point${(r.points?.length ?? 0) === 1 ? "" : "s"}`}</summary>{r.comment && <p className="mini mt-2">{r.comment}</p>}{r.decision === "sent_back" && <div className="mini mt-2"><Pts pts={r.points} /></div>}</details>)}</div></section>
          )}

          {compliance && f.status === "closure_requested" && (
            <section className="card review">
              <div className="ch"><span className="eyebrow">Step 4 · Closure requested</span><span className="mini">{p.remaining.length ? `${p.remaining.length} item(s) not verified` : "plan complete"}</span></div>
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

          {compliance && !closedOrCancelled && f.status !== "closure_requested" && (
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
