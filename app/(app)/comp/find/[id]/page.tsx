import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import EntityBand from "@/components/EntityBand";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_STATUS } from "@/lib/actions-shared";
import { CHANGE_LABEL, guessType, LEVEL_LABEL, loadFinding, TYPE_GUIDE, TYPE_LABEL, TYPES, needsAuthority, plan, progress, ROUTE_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, stepOf, STEPS_PATH, type Assistant, type Point, type Round } from "@/lib/findings";
import { addChange, checkPlan, decideClosure, gotoStep, openDossier, recordChangeAuthority, removeChange, requestClosure, reviewAnswer, saveRootCause, sendAnalysis, setAuthorityDecision, setFindingType, updateFinding, verifyChange } from "../actions";
import { rulesCited } from "@/lib/regulation-items";
import { RuleText } from "@/components/RuleText";
import { authorityStep, DECISION_LABEL, DECISION_TONE, effectiveDue, EXT_LABEL } from "@/lib/authority-audit";
import { Icon } from "@/lib/icons";

/* FND-03 · the finding sheet. The NP writes in order — ① root cause, read by S.A.M. with them; ② corrective action plan, read by S.A.M.
 * with them; ③ send both — then Compliance accepts both (the plan starts) or sends back with the points to address. S.A.M.'s reading
 * is phrased for the author before sending and for Compliance after; it is never a verdict shown as a judgement of the person. */
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
  const writing = actor && ["open", "back"].includes(f.status);
  const step = stepOf(f);
  const closedOrCancelled = ["closed", "cancelled"].includes(f.status);
  const current = rounds.find((r) => r.n === f.current_round) ?? null;
  const sentBack = f.status === "back" && current?.decision === "sent_back" ? current : null;
  const mayEditPlan = writing || (compliance && !closedOrCancelled && f.status !== "closure_requested");
  const p = plan(changes, actions);
  const t0 = new Date().toISOString().slice(0, 10);
  const [{ data: ppl }, { data: mans }, { data: evs }] = await Promise.all([
    db.from("people").select("id,display_name").limit(500),
    db.from("manuals").select("id,code,title").eq("entity", f.entity).order("code"),
    db.from("audit_log").select("at,actor,action,after").eq("object_type", "finding").eq("object_id", f.id).order("id", { ascending: false }).limit(40),
  ]);
  // 10/11 · the rules the finding cites, with their text from the EARs loaded in S.A.M.; and the audit it comes from
  const [rules, { data: aud }] = await Promise.all([rulesCited(db, f.entity, f.requirement), f.audit_id ? db.from("audits").select("id,number,title,kind,done_on,planned_month").eq("id", f.audit_id).maybeSingle() : Promise.resolve({ data: null })]);
  const audit = aud as { id: string; number: string; title: string; kind: string; done_on: string | null; planned_month: string } | null;
  const ftype = f.finding_type ?? guessType(f); const typeBySam = !f.finding_type || f.finding_type_by === "sam";
  const guide = TYPE_GUIDE[ftype];
  const name = (pid: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((q) => q.id === pid)?.display_name ?? "—";
  const manuals = (mans ?? []) as { id: string; code: string; title: string }[];
  const events = (evs ?? []) as { at: string; actor: string | null; action: string; after: Record<string, unknown> | null }[];
  const who = f.owner_person ? name(f.owner_person) : f.owner_role ?? "—";
  const Pts = ({ pts, part }: { pts: Point[] | null | undefined; part?: "rca" | "plan" }) => <ul className="pts">{(pts ?? []).filter((q) => !part || (q.part ?? "rca") === part).map((q, i) => <li key={i}><b>{q.label}</b>{q.detail && q.detail !== q.label ? <>, {q.detail}</> : null}</li>)}</ul>;
  /** S.A.M.'s reading for the author: what could make the part stronger. Never a score. */
  const SamNote = ({ a, part }: { a: Assistant | null; part: "rca" | "plan" }) => a ? (
    <div className="samnote"><div className="eyebrow">S.A.M. read this with you{a.model === "rules" ? " (quick check)" : ""}</div>
      {a.points.filter((q) => (q.part ?? "rca") === part).length ? <><p className="mini">Points that would strengthen it, your call:</p><Pts pts={a.points} part={part} /></> : <p className="mini">Nothing to point out: {part === "rca" ? "the text explains why the organisation let it happen." : "the plan answers the cause, each action has an owner and a date."}</p>}
    </div>
  ) : null;
  const RcaText = ({ r }: { r: Pick<Round, "root_cause" | "factors" | "immediate"> }) => <div className="grid gap-3">
    <div><div className="eyebrow">Root cause</div><p style={{ whiteSpace: "pre-wrap" }}>{r.root_cause}</p></div>
    {r.factors && <div><div className="eyebrow">Contributing factors</div><p style={{ whiteSpace: "pre-wrap" }}>{r.factors}</p></div>}
    {r.immediate && <div><div className="eyebrow">Immediate action</div><p style={{ whiteSpace: "pre-wrap" }}>{r.immediate}</p></div>}
  </div>;
  const PlanItems = (
    <>
      <div>
        <div className="eyebrow mb-1">Expected manual changes <span className="mini">(shown to the author when a draft of the manual opens; effective at the authority's approval / acknowledgement or at publication, then verified — MSM §2.3)</span></div>
        {changes.length ? <table className="tbl"><tbody>{changes.map((c) => (
          <tr key={c.id}><td><b className="mono">{c.manual_code ?? "manual"}</b> {c.section_ref}<div className="mini">{c.expected}</div>
              {(c.route || c.authority_ref || c.effective_on) && <div className="mini">{c.route ? `Effective by ${ROUTE_LABEL[c.route] ?? c.route}` : ""}{c.authority_ref ? ` · ${c.authority_ref}` : ""}{c.effective_on ? ` · ${c.effective_on}` : ""}{c.authority_file_id ? <> · <Link href={`/proj/auth/${c.authority_file_id}`}>application</Link></> : null}</div>}
              {c.verified_note && <div className="mini">Compliance: {c.verified_note}</div>}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{step >= 4 && <span className={"pill " + (c.status === "verified" ? "green" : c.status === "published" || c.status === "awaiting_authority" ? "amber" : "")}>{CHANGE_LABEL[c.status] ?? c.status}</span>}
              {c.revision_id && <div className="mini"><Link href={`/docs/editor/${c.revision_id}`}>open revision</Link></div>}
              {c.status === "published" && compliance && <form action={verifyChange} className="grid gap-1 justify-end mt-1" style={{ gridTemplateColumns: "auto auto" }}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} />
                {needsAuthority(c) && !c.authority_ref && <input name="authority_ref" className="inp mono" required placeholder="METEOR / TM-CAD ref." style={{ width: 150, marginTop: 0 }} />}
                {!c.effective_on && <input name="effective_on" type="date" className="inp" required style={{ marginTop: 0 }} title={needsAuthority(c) ? "Decision / acknowledgement date" : "Publication date"} />}
                <input name="note" className="inp" placeholder="text found / remark" style={{ width: 160, marginTop: 0 }} /><span className="flex gap-1"><button className="btn" name="verdict" value="ok">Verified</button><button className="btn" name="verdict" value="no">Not in</button></span></form>}
              {["awaiting_authority", "included"].includes(c.status) && compliance && <details className="mt-1"><summary className="mini">Record the authority's return / the publication</summary>
                <form action={recordChangeAuthority} className="grid gap-1 mt-1" style={{ gridTemplateColumns: "auto auto auto" }}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} />
                  <select name="route" className="inp" defaultValue={c.route ?? "approval"} style={{ marginTop: 0 }}><option value="approval">Approved by the authority</option><option value="notification">Acknowledged (notification)</option><option value="publication">Published (no authority)</option></select>
                  <input name="authority_ref" className="inp mono" placeholder="METEOR / TM-CAD ref." defaultValue={c.authority_ref ?? ""} style={{ width: 150, marginTop: 0 }} /><input name="effective_on" type="date" className="inp" required style={{ marginTop: 0 }} />
                  <div className="col-span-3 flex justify-end"><button className="btn" type="submit">Record</button></div></form></details>}
              {["pending", "deferred"].includes(c.status) && mayEditPlan && <form action={removeChange} className="mt-1"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="change" value={c.id} /><button className="btn mini" type="submit">Remove</button></form>}</td></tr>))}</tbody></table>
          : <p className="mini">None yet.</p>}
        {mayEditPlan && (
          <details className="mt-2"><summary className="mini">+ Expected manual change</summary>
            <form action={addChange} className="grid gap-2 grid-cols-3 mt-2"><input type="hidden" name="id" value={f.id} />
              <label><span className="mini">Manual</span><select name="manual_id" className="inp" defaultValue=""><option value="">— not in S.A.M. yet —</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.code}, {m.title}</option>)}</select></label>
              <label><span className="mini">or code</span><input name="manual_code" className="inp mono" placeholder="OM-A" /></label>
              <label><span className="mini">Section</span><input name="section_ref" className="inp mono" placeholder="5.2.3" /></label>
              <label className="col-span-3"><span className="mini">What must change</span><input name="expected" className="inp" required placeholder="Name who checks …, add the record …" /></label>
              <div className="col-span-3 flex justify-end"><button className="btn" type="submit">Add</button></div></form></details>
        )}
      </div>
      <div>
        <div className="eyebrow mb-1">Other actions <span className="mini">(contracts, training, audits, tools, owner, date, evidence, verified by Compliance)</span></div>
        {actions.length ? <table className="tbl"><tbody>{actions.map((a) => <tr key={a.id}><td><Link href={`/safe/actions/${a.id}`}><b className="mono">{a.number}</b> {a.title}</Link><div className="mini">{a.owner_role ?? name(a.owner_person)}, due {a.due ?? "—"}</div></td><td style={{ textAlign: "right" }}>{step >= 4 && <span className={"pill " + (ACTION_STATUS[a.status]?.[1] ?? "")}>{ACTION_STATUS[a.status]?.[0] ?? a.status}</span>}</td></tr>)}</tbody></table> : <p className="mini">None yet.</p>}
        {mayEditPlan && <details className="mt-2"><summary className="mini">+ Action</summary><div className="mt-2"><NewActionForm entity={f.entity} source="finding" finding_id={f.id} owner_role={f.owner_role} compact stay /></div></details>}
      </div>
    </>
  );
  const ds = f.draft_step;
  return (
    <>
      <EntityBand entity={f.entity} current={s.entity} multi={s.entities.length > 1} what="finding" />
      <PageHeader eyebrow={`Compliance, Findings, ${SOURCE_LABEL[f.source] ?? f.source}${f.authority ? `, ${f.authority}` : ""}`} title={`${f.number}, ${f.title}`} sub={`${LEVEL_LABEL[f.level] ?? f.level}${f.requirement ? `, ${f.requirement}` : ""}${f.audit_ref ? `, ${f.audit_ref}` : ""}, raised ${f.notified ?? "—"}, answer due ${f.due ?? "—"}, answered by ${who}, ${progress(f, changes, actions).label}`}
        right={<span className={"pill " + (STATUS_TONE[f.status] ?? "")}>{STATUS_LABEL[f.status] ?? f.status}</span>} />

      <div className="fsteps mb-4">{STEPS_PATH.map((l, i) => <div key={l} className={"fstep" + (step > i + 1 || f.status === "closed" ? " done" : step === i + 1 ? " on" : "")}><i>{step > i + 1 || f.status === "closed" ? <Icon name="check" size={12} /> : i + 1}</i><span>{l}</span></div>)}</div>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Where" value={STATUS_LABEL[f.status] ?? f.status} hint={["review", "closure_requested"].includes(f.status) ? "Compliance's turn" : closedOrCancelled ? "" : `${who}'s turn`} />
        <Metric label="Answer due" value={f.due ?? "—"} tone={f.due && f.due < t0 && step <= 3 ? "red" : undefined} />
        <Metric label="Corrective plan" value={p.total ? (step >= 4 ? `${p.done} / ${p.total}` : `${p.total} item${p.total === 1 ? "" : "s"}`) : "—"} hint={step >= 4 ? (!p.total ? "nothing attached yet" : p.remaining.length ? `${p.remaining.length} remaining` : "complete") : "starts once accepted"} tone={step >= 4 && p.total && !p.remaining.length ? "green" : step >= 4 && !p.total ? "amber" : undefined} />
        <Metric label="Rounds" value={rounds.length} hint={rounds.some((r) => r.decision === "sent_back") ? `${rounds.filter((r) => r.decision === "sent_back").length} sent back` : ""} />
      </div>

      {sentBack && (
        <section className="card mb-4 sentback">
          <div className="ch"><span className="eyebrow">Analysis sent back, {sentBack.points?.length ?? 0} point{(sentBack.points?.length ?? 0) === 1 ? "" : "s"} to address</span><span className="mini">by {name(sentBack.decided_by)}, {sentBack.decided_at?.slice(0, 10)}</span></div>
          <div className="cb grid grid-cols-2 gap-4">
            <div><div className="eyebrow">Root cause</div>{sentBack.points?.some((q) => (q.part ?? "rca") === "rca") ? <Pts pts={sentBack.points} part="rca" /> : <p className="mini">Nothing to change.</p>}</div>
            <div><div className="eyebrow">Action plan</div>{sentBack.points?.some((q) => q.part === "plan") ? <Pts pts={sentBack.points} part="plan" /> : <p className="mini">Nothing to change.</p>}</div>
          </div>
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
                <label><span className="mini">Answered by, post</span><input name="owner_role" className="inp mono" defaultValue={f.owner_role ?? ""} /></label>
                <label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue={f.owner_person ?? ""}><option value="">—</option>{((ppl ?? []) as { id: string; display_name: string }[]).map((q) => <option key={q.id} value={q.id}>{q.display_name}</option>)}</select></label>
                <label className="col-span-2"><span className="mini">Text</span><textarea name="description" className="inp" rows={4} defaultValue={f.description ?? ""} /></label>
                <div className="col-span-2 flex justify-end"><button className="btn" type="submit">Save</button></div></form></details>}</div>
            <div className="cb"><p style={{ whiteSpace: "pre-wrap" }}>{f.description ?? <span className="mini">No text pasted.</span>}</p>
              {audit && <p className="mini mt-2">From the audit <Link href={`/comp/audits/${audit.id}`}><b className="mono">{audit.number}</b> {audit.title}</Link>{audit.done_on ? `, ${audit.done_on}` : ""}</p>}</div>
          </section>

          {f.source === "authority" && (() => { const st = authorityStep(f); const d = effectiveDue({ due: f.due, extension: f.extension ?? null }); const D = ({ v }: { v: string | null | undefined }) => v ? <span className={"pill " + (DECISION_TONE[v] ?? "")}>{DECISION_LABEL[v] ?? v}</span> : <span className="mini">—</span>; return (
          <section className="card">
            <div className="ch"><span className="eyebrow">With the authority{f.authority ? `, ${f.authority}` : ""}</span><span className={"pill " + st.tone}>{st.label}</span></div>
            <div className="cb grid gap-2">
              <div className="grid grid-cols-4 gap-2 mini"><div>Reference<div className="mono" style={{ fontSize: 14 }}>{f.authority_ref ?? "—"}</div></div><div>Root cause<div><D v={f.authority_rca} /></div></div><div>Plan<div><D v={f.authority_pac} /></div></div><div>Proof<div><D v={f.authority_proof} /></div></div></div>
              <p className="mini">Deadline {d ?? "—"}{f.extension ? ` (${EXT_LABEL[f.extension]}, initially ${f.due})` : ""}{f.notified ? `, notified ${f.notified}` : ""}{f.finding_file ? <> · <a href={f.finding_file} target="_blank" rel="noreferrer">finding sheet ↗</a></> : null}</p>
              {f.proof && <div><div className="eyebrow">Proof of implementation sent</div><p className="mini" style={{ whiteSpace: "pre-wrap" }}>{f.proof}</p></div>}
              {f.extension_reason && <p className="mini" style={{ whiteSpace: "pre-wrap" }}><b>Note:</b> {f.extension_reason}</p>}
              {compliance && <details><summary className="mini">Record the authority's answer</summary><form action={setAuthorityDecision} className="grid gap-2 grid-cols-2 mt-2"><input type="hidden" name="id" value={f.id} />
                <label><span className="mini">Authority reference (METEOR…)</span><input name="authority_ref" className="inp mono" defaultValue={f.authority_ref ?? ""} /></label>
                <label><span className="mini">Finding sheet (link)</span><input name="finding_file" className="inp" defaultValue={f.finding_file ?? ""} /></label>
                {(["authority_rca", "authority_pac", "authority_proof"] as const).map((k) => <label key={k}><span className="mini">{k === "authority_rca" ? "Root cause" : k === "authority_pac" ? "Plan" : "Proof"}, authority's decision</span><select name={k} className="inp" defaultValue={f[k] ?? ""}><option value="">— not sent yet</option>{Object.entries(DECISION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
                <label><span className="mini">Extension granted</span><select name="extension" className="inp" defaultValue={f.extension ?? ""}><option value="">None</option>{Object.entries(EXT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="col-span-2"><span className="mini">Proof of implementation sent</span><textarea name="proof" className="inp" rows={3} defaultValue={f.proof ?? ""} /></label>
                <label className="col-span-2"><span className="mini">Note (extension reason, authority's comment)</span><textarea name="extension_reason" className="inp" rows={2} defaultValue={f.extension_reason ?? ""} /></label>
                <div className="col-span-2 flex justify-end"><button className="btn sm primary">Save</button></div></form></details>}
            </div>
          </section>); })()}

          <section className="card">
            <div className="ch"><span className="eyebrow">Type of finding</span><span className="mini">{typeBySam ? "proposed by S.A.M. from the text, change it if wrong" : "set by hand"}</span></div>
            <div className="cb grid gap-2">
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}><span className={"pill " + (typeBySam ? "amber" : "green")} style={{ fontSize: 13 }}>{TYPE_LABEL[ftype] ?? ftype}</span>
                {actor && !closedOrCancelled && <form action={setFindingType} className="flex gap-1"><input type="hidden" name="id" value={f.id} /><select name="type" className="inp" defaultValue={f.finding_type ?? ""} style={{ marginTop: 0, width: 260 }}><option value="" disabled>Change the type…</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select><button className="btn sm" type="submit">Set</button></form>}</div>
              {guide && <p className="mini">S.A.M. uses the type to suggest where to look for the root cause, it never writes it for you.</p>}
            </div>
          </section>

          <section className="card">
            <div className="ch"><span className="eyebrow">Regulation cited</span><span className="mono mini">{f.requirement ?? "no reference given"}</span></div>
            <div className="cb grid gap-2">
              {!rules.length ? <p className="mini">{f.requirement ? "No rule code S.A.M. recognises in the reference." : "No reference given on the finding."}</p> : rules.map((r) => (
                <details key={r.code} className="rulecited"><summary><b className="mono">{r.code}</b> {r.items.find((i) => i.kind === "ir" || i.kind === "cs")?.title ?? ""} <span className="mini">{r.reg ? `· ${r.reg.title}, ${r.reg.version}` : "· not in the texts loaded in S.A.M."}</span></summary>
                  <div className="mt-2">{r.items.length ? <RuleText items={r.items} version={r.reg!.version} onlineUrl={r.reg!.online_url} compact /> : <p className="mini">Load the Easy Access Rules that contain it (Regulation) to read it here.</p>}
                    {r.reg && <p className="mini mt-1"><Link href={`/reg/ear/${r.reg.key}?code=${encodeURIComponent(r.code)}`}>Open in Regulation ↗</Link></p>}</div></details>))}
            </div>
          </section>

          {writing ? (
            <>
              {/* ① root cause */}
              <section className={"card" + (ds === 1 ? " stepon" : "")}>
                <div className="ch"><span className="eyebrow">① Root cause</span>{ds !== 1 && f.draft_root_cause && <form action={gotoStep}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="step" value="1" /><button className="btn mini" type="submit">Edit</button></form>}</div>
                <div className="cb">
                  {ds === 1 ? (
                    <form action={saveRootCause} className="grid gap-3"><input type="hidden" name="id" value={f.id} />
                      {guide && <div className="samguide"><div className="eyebrow">Where to look, {TYPE_LABEL[ftype]}{typeBySam ? " (type proposed by S.A.M.)" : ""}</div><ul className="pts">{guide.look.map((q) => <li key={q}>{q}</li>)}</ul><p className="mini"><b>Avoid:</b> {guide.avoid}</p></div>}
                      <label><span className="mini">Root cause, why did the organisation let this happen? (not what was found, not who)</span><textarea name="root_cause" className="inp" rows={6} required defaultValue={f.draft_root_cause ?? ""} placeholder="Example: the procedure for … did not name who checks …, so the check depended on memory when the roster changed." /></label>
                      <SamNote a={f.rca_check} part="rca" />
                      <div className="flex gap-2 justify-end items-center"><span className="mini" style={{ marginRight: "auto" }}>Nothing goes to Compliance before step ③.</span><button className="btn" type="submit" name="next" value="0" title="Saves your text and shows S.A.M.'s remarks below; you stay on this step">Save and get S.A.M.'s remarks</button><button className="btn primary" type="submit" name="next" value="1">Save, next: action plan →</button></div>
                    </form>
                  ) : <RcaText r={{ root_cause: f.draft_root_cause, factors: f.draft_factors, immediate: f.draft_immediate }} />}
                </div>
              </section>
              {/* ② plan */}
              <section className={"card" + (ds === 2 ? " stepon" : "") + (ds < 2 ? " locked" : "")}>
                <div className="ch"><span className="eyebrow">② Corrective action plan</span><span className="mini">{ds < 2 ? "after the root cause" : `${p.total} item${p.total === 1 ? "" : "s"}`}{ds === 3 && <form action={gotoStep} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="step" value="2" /><button className="btn mini" type="submit">Edit</button></form>}</span></div>
                {ds >= 2 && <div className="cb grid gap-3">
                  {PlanItems}
                  {ds === 2 && (
                    <form action={checkPlan} className="grid gap-2" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={f.id} />
                      <label><span className="mini">How the plan answers the cause (optional, goes to Compliance)</span><textarea name="comment" className="inp" rows={2} defaultValue={f.draft_comment ?? ""} /></label>
                      <SamNote a={f.plan_check} part="plan" />
                      <div className="flex gap-2 justify-end"><button className="btn" type="submit" name="next" value="0" disabled={!p.total} title="Shows S.A.M.'s remarks on the plan below; you stay on this step">Get S.A.M.'s remarks on the plan</button><button className="btn primary" type="submit" name="next" value="1" disabled={!p.total}>Next: send →</button></div>
                    </form>
                  )}
                  {ds === 3 && f.draft_comment && <p className="mini">{f.draft_comment}</p>}
                </div>}
              </section>
              {/* ③ send */}
              <section className={"card" + (ds === 3 ? " stepon" : " locked")}>
                <div className="ch"><span className="eyebrow">③ Send to Compliance</span></div>
                <div className="cb">{ds === 3 ? (
                  <form action={sendAnalysis} className="flex items-center justify-between"><input type="hidden" name="id" value={f.id} /><span className="mini">Root cause and plan go together{f.status === "back" ? ` (round ${f.current_round + 1})` : ""}; Compliance accepts both before the plan starts.</span><button className="btn primary" type="submit" disabled={!f.draft_root_cause || !p.total}>Send the analysis</button></form>
                ) : <p className="mini">Once the root cause and the plan are written.</p>}</div>
              </section>
            </>
          ) : current ? (
            <section className="card">
              <div className="ch"><span className="eyebrow">{current.via === "import" ? "Analysis (imported from Monday)" : `Analysis, round ${current.n}`}</span><span className="mini">{current.decision === "accepted" ? `accepted by ${name(current.decided_by)}, ${current.decided_at?.slice(0, 10)}` : `by ${name(current.answered_by)}, ${current.answered_at.slice(0, 10)}`}</span></div>
              <div className="cb grid gap-3"><RcaText r={current} />{current.comment && <div><div className="eyebrow">How the plan answers the cause</div><p className="mini">{current.comment}</p></div>}</div>
            </section>
          ) : <section className="card"><div className="ch"><span className="eyebrow">Analysis</span></div><div className="cb mini">Waiting for {who}.</div></section>}

          {rounds.filter((r) => r.decision === "sent_back").length > 0 && (
            <section className="card"><div className="ch"><span className="eyebrow">Previous rounds</span></div>
              <div className="cb grid gap-2">{rounds.filter((r) => r.decision).reverse().map((r) => <details key={r.id}><summary><b>Round {r.n}</b>, {name(r.answered_by)}, {r.answered_at.slice(0, 10)}, {r.decision === "accepted" ? "accepted" : `sent back, ${r.points?.length ?? 0} point${(r.points?.length ?? 0) === 1 ? "" : "s"}`}</summary><div className="mini mt-2"><RcaText r={r} /></div>{r.decision === "sent_back" && <div className="mini mt-2"><Pts pts={r.points} /></div>}</details>)}</div></section>
          )}

          <section className="card">
            <div className="ch"><span className="eyebrow">History</span></div>
            <div className="cb mini">{events.length ? events.map((e, i) => <div key={i}>{e.at.slice(0, 16).replace("T", " ")} · {e.action.replace(/^finding_/, "").replace(/_/g, " ")} · {name(e.actor)}</div>) : "—"}</div>
          </section>
        </div>

        <div className="grid gap-4">
          {compliance && f.status === "review" && current && (
            <section className="card review">
              <div className="ch"><span className="eyebrow">Compliance review — round {current.n}</span><span className="mini">S.A.M. pre-read: {current.assistant ? `${current.assistant.verdict.replace("_", " ")} · ${current.assistant.points.length} suggestion${current.assistant.points.length === 1 ? "" : "s"}${current.assistant.model === "rules" ? " (rules — Claude unavailable)" : ""}` : "not available"}</span></div>
              <div className="cb">
                <form action={reviewAnswer} className="grid gap-3"><input type="hidden" name="id" value={f.id} />
                  {(["rca", "plan"] as const).map((part) => { const pts = (current.assistant?.points ?? []).filter((q) => (q.part ?? "rca") === part); return (
                    <div key={part}><div className="eyebrow mb-1">{part === "rca" ? "Root cause" : "Action plan"}</div>
                      {pts.length ? <ul className="pts chk">{pts.map((q) => <li key={`${part}:${q.code}`}><label><input type="checkbox" name="point" value={`${part}:${q.code}`} /> <span><b>{q.label}</b>, {q.detail}</span></label></li>)}</ul> : <p className="mini">S.A.M. found nothing to point out.</p>}</div>); })}
                  <p className="mini">Tick the points to send back to {who}; nothing goes out unticked.</p>
                  <div className="grid grid-cols-3 gap-2"><label className="col-span-2"><span className="mini">Your note (optional, added as a point if you send back)</span><textarea name="note" className="inp" rows={2} /></label><label><span className="mini">about</span><select name="note_part" className="inp" defaultValue="rca"><option value="rca">the root cause</option><option value="plan">the plan</option></select></label></div>
                  <div className="flex gap-2 justify-end"><button className="btn" type="submit" name="decision" value="back">Send back with the ticked points</button><button className="btn primary" type="submit" name="decision" value="accept">Accept root cause and plan, the plan starts</button></div>
                </form>
              </div>
            </section>
          )}

          {!writing && (
            <section className="card">
              <div className="ch"><span className="eyebrow">Corrective action plan</span><span className="mini">{step >= 4 ? (p.total ? `${p.done} / ${p.total} done` : "empty") : step === 3 ? "under review" : "not written yet"}</span></div>
              {step >= 4 && p.total > 0 && <div className="bar"><i style={{ width: `${Math.round((100 * p.done) / p.total)}%` }} /></div>}
              <div className="cb grid gap-3">
                {PlanItems}
                {f.status === "accepted" && actor && <form action={requestClosure} className="flex items-center justify-between" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={f.id} /><span className="mini">{!p.total ? "No manual change or action attached yet: add each item of the plan above (manual change or action) so S.A.M. follows it to closure." : p.remaining.length ? `${p.remaining.length} item${p.remaining.length === 1 ? "" : "s"} still open. S.A.M. proposes the closure when everything is verified.` : "Everything is verified."}</span><button className="btn" type="submit" disabled={(!!p.remaining.length || !p.total) && !compliance}>Request closure</button></form>}
              </div>
            </section>
          )}

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
            <div className="ch"><span className="eyebrow">Authority dossier</span><span className="mini">OM-FND, manual revision for finding closure</span></div>
            <div className="cb flex items-center justify-between">
              {f.authority_file_id ? <Link className="btn" href={`/proj/auth/${f.authority_file_id}`}>Open the dossier</Link> : <span className="mini">No dossier yet. Open it when a manual revision answers the finding at the authority.</span>}
              {compliance && !f.authority_file_id && <form action={openDossier}><input type="hidden" name="id" value={f.id} /><button className="btn" type="submit">Open the dossier</button></form>}
            </div>
          </section>

          {compliance && !closedOrCancelled && f.status !== "closure_requested" && (
            <details className="card"><summary className="ch" style={{ cursor: "pointer" }}><span className="eyebrow">Close or cancel</span></summary>
              <div className="cb"><form action={decideClosure} className="grid gap-2"><input type="hidden" name="id" value={f.id} />
                <label><span className="mini">Note</span><input name="note" className="inp" placeholder="Why, accepted by the authority on …, raised by mistake…" /></label>
                <div className="flex gap-2 justify-end"><button className="btn" name="what" value="cancel">Cancel the finding</button><button className="btn" name="what" value="close">Close directly</button></div></form></div></details>
          )}
          {f.closed_at && <section className="card"><div className="ch"><span className="eyebrow">{f.status === "cancelled" ? "Cancelled" : "Closed"}</span><span className="mini">{f.status === "closed" && f.effective_closed_on ? <>effective {f.effective_closed_on}, decided {f.closed_at.slice(0, 10)}</> : f.closed_at.slice(0, 10)}, {name(f.closed_by)}</span></div>{(f.closed_note || (f.status === "closed" && f.effective_closed_on)) && <div className="cb">{f.status === "closed" && f.effective_closed_on && <p className="mini">Closure date = date of the last approval / acknowledgement / publication of the plan (MSM §2.3), not the day the text was written.</p>}{f.closed_note}</div>}</section>}
        </div>
      </div>
    </>
  );
}
