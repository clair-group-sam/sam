import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { FORMS, OUTCOME, isDesk, mayPrefill, maySee, mayValidate, missingToSign, progress, selfProgress, type Assessment } from "@/lib/competency";
import { deleteDraft, reopenAssessment, saveAssessment, savePrefill } from "../actions";

const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "—");
const tone = (n: number) => (n >= 4 ? "green" : n === 3 ? "" : n === 2 ? "amber" : "red");

/* NP-03 · one assessment sheet. Three readings of the same page: the person pre-filling (their level and comment),
 * Compliance validating (its level beside the person's, the outcome, the signature), and the signed sheet. */
export default async function Sheet({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; signed?: string; sent?: string; returned?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const { id } = await params; const sp = await searchParams;
  const db = supabaseAdmin();
  const { data } = await db.from("competency_assessments").select("*").eq("id", id).maybeSingle();
  const a = data as Assessment | null;
  if (!a || !maySee(s, a)) notFound();
  const F = FORMS[a.form]; const pre = mayPrefill(s, a); const val = mayValidate(s, a); const signed = a.status === "signed";
  const p = progress(a); const sf = selfProgress(a); const miss = missingToSign(a); const o = a.outcome ? OUTCOME[a.outcome] : null;
  const isPerson = a.person_id === s.person?.id;
  const showAssessor = val || signed;                       // the person sees the grades of Compliance once the sheet is signed
  const hasSelf = a.items.some((i) => i.self || i.self_remark) || pre;
  const sections = [...new Set(a.items.map((i) => i.section))];
  const fnLabel = a.functions.map((c) => F.functions.find((f) => f.code === c)?.label ?? c).join(", ");
  const lvlTitle = (n: number) => F.levels.find((l) => l[0] === n)?.[1];
  const tag = signed ? <span className={"pill " + (o?.[1] ?? "green")}>signed on {fr(a.signed_at)} by {a.assessor_name}: fit for position, {o?.[0] ?? "—"}</span>
    : a.status === "submitted" ? <span className="pill amber">pre-filled on {fr(a.submitted_at)}, to validate by Compliance{val ? `, ${p.done}/${p.n} points graded` : ""}</span>
    : a.person_id ? <span className="pill">being pre-filled by {isPerson ? "you" : a.person_name}, {sf.done}/{sf.n} points</span> : <span className="pill amber">draft, {p.done}/{p.n} points graded</span>;
  const roHead = !val; const roPerson = !(val || pre);

  return (
    <>
      <PageHeader eyebrow="NP management, Competency assessment" title={`${a.person_name}, competence assessment`}
        sub={`${a.form_ref}, ${a.form_edition ?? ""}${F.basis ? ", " + F.basis : ""}. ${ENT[a.entity]?.name ?? a.entity}.`} tag={tag}
        right={<Link className="btn" href={`/np/assess?entity=${a.entity}`}>All assessments</Link>} />
      {sp.saved && <p className="mini mb-3">Saved.</p>}
      {sp.sent && <p className="mini mb-3">Sent to Compliance, which validates and signs. You will find the signed sheet here.</p>}
      {sp.returned && <p className="mini mb-3">Returned to {a.person_name} for completion.</p>}
      {sp.signed && !signed && <p className="mini red mb-3">Not signed: still missing {miss.join(", ")}.</p>}
      {pre && <p className="mb-3">Give your own level on each point (1 to 4) and a comment where useful, complete page 3, then send the sheet to Compliance.</p>}

      <form action={pre ? savePrefill : saveAssessment}>
        <input type="hidden" name="id" value={a.id} />
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Page 1</span><span className="mini">{a.kind === "initial" ? "initial assessment" : "recurrent assessment"}</span></div>
          <div className="cb">
            <div className="flex flex-wrap gap-3 items-end">
              <label style={{ width: 240 }}><span className="mini">Name, first name</span><input className="inp" value={a.person_name} readOnly /></label>
              <label style={{ width: 280 }}><span className="mini">Position</span><input name="position" className="inp" defaultValue={a.position ?? ""} readOnly={roHead} /></label>
              <label style={{ width: 160 }}><span className="mini">Date of assessment</span><input name="assessed_on" type="date" className="inp" defaultValue={a.assessed_on ?? ""} readOnly={roHead} /></label>
              <label style={{ width: 180 }}><span className="mini">Date of the last assessment</span><input name="last_assessed_on" type="date" className="inp" defaultValue={a.last_assessed_on ?? ""} readOnly={roHead} /></label>
              <label style={{ width: 240 }}><span className="mini">Assessor</span><input className="inp" value={a.assessor_name ?? (val ? s.name + " (on signature)" : "Compliance Monitoring Manager")} readOnly /></label>
            </div>
            <p className="mini mt-3">Functions assessed: <b>{fnLabel}</b></p>
            <label className="block mt-3"><span className="mini">Organizational changes during the period that may impact required training</span><textarea name="org_changes" className="inp" rows={2} defaultValue={a.org_changes ?? ""} readOnly={roPerson} /></label>
            <p className="mini mt-3">The evaluator must assess the collaborator through oral questions for each of the evaluation points, and an overall assessment will then be given in the “Remarks” column.</p>
            <p className="mini mt-1">Evaluation levels: {F.levels.map(([n, l]) => `${n}: ${l}`).join("  ·  ")}</p>
          </div>
        </section>

        {sections.map((sec) => (
          <section className="card mb-4" key={sec}>
            <div className="ch"><span className="eyebrow">{sec}</span><span className="mini">{a.items.filter((i) => i.section === sec && (pre ? i.self : i.level)).length}/{a.items.filter((i) => i.section === sec).length}</span></div>
            <table className="tbl">
              <thead><tr><th style={{ width: 50 }}>N°</th><th>Points to evaluate</th>{hasSelf && <th style={{ width: pre ? 190 : 210 }}>{isPerson ? "My level" : "Pre-filled by the person"}</th>}{pre && <th style={{ width: "30%" }}>My comment</th>}
                {showAssessor && <><th style={{ width: 190 }}>Assessment level</th><th style={{ width: "26%" }}>RMK</th></>}</tr></thead>
              <tbody>{a.items.filter((i) => i.section === sec).map((i) => (
                <tr key={i.k}>
                  <td className="mono">{i.k}</td>
                  <td>{i.text}</td>
                  {hasSelf && <td>{pre ? <span className="flex gap-3" role="radiogroup" aria-label={`My level, point ${i.k}`}>{[1, 2, 3, 4].map((n) => <label key={n} className="flex items-center gap-1" title={lvlTitle(n)}><input type="radio" name={`s_${i.k}`} value={n} defaultChecked={i.self === n} />{n}</label>)}</span>
                    : <>{i.self ? <span className={"pill " + tone(i.self)} title={lvlTitle(i.self)}>{i.self}</span> : <span className="mini">—</span>}{i.self_remark && <div className="mini mt-1">{i.self_remark}</div>}</>}</td>}
                  {pre && <td><input name={`sr_${i.k}`} className="inp" style={{ marginTop: 0 }} defaultValue={i.self_remark ?? ""} /></td>}
                  {showAssessor && <>
                    <td>{val ? <span className="flex gap-3" role="radiogroup" aria-label={`Level, point ${i.k}`}>{[1, 2, 3, 4].map((n) => <label key={n} className="flex items-center gap-1" title={lvlTitle(n)}><input type="radio" name={`l_${i.k}`} value={n} defaultChecked={(i.level ?? i.self) === n} />{n}</label>)}</span>
                      : i.level ? <span className={"pill " + tone(i.level)} title={lvlTitle(i.level)}>{i.level}</span> : <span className="mini">—</span>}</td>
                    <td>{val ? <input name={`r_${i.k}`} className="inp" style={{ marginTop: 0 }} defaultValue={i.remark ?? ""} /> : (i.remark ?? "")}</td></>}
                </tr>))}</tbody>
            </table>
          </section>
        ))}
        {val && hasSelf && <p className="mini mb-4">Where you have not graded a point yet, the level given by the person is proposed: change it where your assessment differs. Saving records the levels shown as yours.</p>}

        {F.page3 && (
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Page 3, certificates at the date of the competency assessment</span></div>
            <div className="cb grid md:grid-cols-2 gap-3">
              <label><span className="mini">Diplomas: title, date (one per line)</span><textarea name="diplomas" className="inp" rows={4} defaultValue={a.diplomas ?? ""} readOnly={roPerson} /></label>
              <label><span className="mini">Trainings: title, date, recurrent Y/N, validity date (one per line)</span><textarea name="trainings" className="inp" rows={4} defaultValue={a.trainings ?? ""} readOnly={roPerson} /></label>
            </div>
          </section>
        )}

        {pre && (
          <section className="card mb-4"><div className="cb flex flex-wrap gap-2 items-center">
            <button className="btn" type="submit" name="intent" value="save">Save</button>
            <button className="btn primary" type="submit" name="intent" value="send">Save and send to Compliance</button>
            <span className="mini">{sf.done < sf.n ? `${sf.n - sf.done} point${sf.n - sf.done === 1 ? "" : "s"} without your level: you can still send, Compliance grades every point.` : "Every point has your level."} Once sent, the sheet is no longer yours to change.</span>
          </div></section>
        )}

        {showAssessor && (
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Assessed considered fit for position</span>{p.low > 0 && <span className="mini">{p.low} point{p.low === 1 ? "" : "s"} at level 1 or 2</span>}</div>
            <div className="cb">
              {val ? <div className="flex flex-wrap gap-5">{Object.entries(OUTCOME).map(([k, [l]]) => <label key={k} className="flex items-center gap-2"><input type="radio" name="outcome" value={k} defaultChecked={a.outcome === k} />{l}</label>)}</div>
                : <span className={"pill " + (o?.[1] ?? "")}>{o?.[0] ?? "not decided"}</span>}
              <label className="block mt-3"><span className="mini">Training required (if any)</span><textarea name="training_required" className="inp" rows={2} defaultValue={a.training_required ?? ""} readOnly={!val} /></label>
              <label className="block mt-3" style={{ width: 220 }}><span className="mini">Next assessment due</span><input name="next_due" type="date" className="inp" defaultValue={a.next_due ?? ""} readOnly={!val} /></label>
              {signed && <p className="mt-3"><b>Assessor signature:</b> {a.assessor_name}, Compliance, signed in S.A.M. on {fr(a.signed_at)}.</p>}
              {val && (
                <div className="mt-4 flex flex-wrap gap-2 items-center">
                  <button className="btn" type="submit" name="intent" value="save">Save</button>
                  {a.person_id && a.status === "submitted" && <button className="btn" type="submit" name="intent" value="return">Return to {a.person_name} for completion</button>}
                  <button className="btn primary" type="submit" name="intent" value="sign">Save and sign as assessor</button>
                  <span className="mini">{a.status === "draft" && a.person_id ? `${a.person_name} is still pre-filling (${sf.done}/${sf.n}). ` : ""}{miss.length ? "Before the signature: " + miss.join(", ") + "." : "Nothing missing. Once signed the sheet is no longer edited."}</span>
                </div>
              )}
            </div>
          </section>
        )}
      </form>

      {!signed && (val || (pre && a.created_by === s.person?.id)) && <form action={deleteDraft} className="mb-4"><input type="hidden" name="id" value={a.id} /><button className="mini underline" type="submit">Delete this sheet (opened by mistake)</button></form>}
      {signed && isDesk(s) && !isPerson && (
        <form action={reopenAssessment} className="flex gap-2 items-end mb-4"><input type="hidden" name="id" value={a.id} />
          <label style={{ width: 360 }}><span className="mini">Reopen (an error on the sheet): the reason, kept in the audit log</span><input name="reason" className="inp" required /></label>
          <button className="btn" type="submit">Reopen</button></form>
      )}
    </>
  );
}
