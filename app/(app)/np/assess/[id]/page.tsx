import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { FORMS, OUTCOME, isDesk, mayEdit, maySee, missingToSign, progress, type Assessment } from "@/lib/competency";
import { deleteDraft, reopenAssessment, saveAssessment } from "../actions";

const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "—");

/* NP-03 · one assessment sheet: page 1 (header, outcome, signature), page 2 (the points), page 3 for ENR-COMP-02 (diplomas, trainings). */
export default async function Sheet({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; signed?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const { id } = await params; const sp = await searchParams;
  const db = supabaseAdmin();
  const { data } = await db.from("competency_assessments").select("*").eq("id", id).maybeSingle();
  const a = data as Assessment | null;
  if (!a || !maySee(s, a)) notFound();
  const F = FORMS[a.form]; const edit = mayEdit(s, a); const p = progress(a); const miss = missingToSign(a);
  const mine = a.assessor_id === s.person?.id; const o = a.outcome ? OUTCOME[a.outcome] : null;
  const { data: ppl } = edit ? await db.from("people").select("id,display_name,entities,home_entity").order("display_name").limit(1500) : { data: [] };
  const people = ((ppl ?? []) as { id: string; display_name: string; entities: string[] | null; home_entity: string | null }[]).filter((x) => x.id === a.assessor_id || x.home_entity === a.entity || (x.entities ?? []).includes(a.entity));
  const sections = [...new Set(a.items.map((i) => i.section))];
  const fnLabel = a.functions.map((c) => F.functions.find((f) => f.code === c)?.label ?? c).join(", ");
  const ro = !edit;

  return (
    <>
      <PageHeader eyebrow="NP management, Competency assessment" title={`${a.person_name}, competence assessment`}
        sub={`${a.form_ref}, ${a.form_edition ?? ""}${F.basis ? ", " + F.basis : ""}. ${ENT[a.entity]?.name ?? a.entity}.`}
        tag={a.status === "signed" ? <span className={"pill " + (o?.[1] ?? "green")}>signed on {fr(a.signed_at)} by {a.assessor_name}: fit for position, {o?.[0] ?? "—"}</span> : <span className="pill amber">draft, {p.done}/{p.n} points graded</span>}
        right={<Link className="btn" href={`/np/assess?entity=${a.entity}`}>All assessments</Link>} />
      {sp.saved && <p className="mini mb-3">Saved.</p>}
      {sp.signed && a.status !== "signed" && <p className="mini red mb-3">Not signed: {mine ? "still missing " + miss.join(", ") : "only the assessor named on the sheet signs it"}.</p>}

      <form action={saveAssessment}>
        <input type="hidden" name="id" value={a.id} />
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Page 1</span><span className="mini">{a.kind === "initial" ? "initial assessment" : "recurrent assessment"}</span></div>
          <div className="cb">
            <div className="flex flex-wrap gap-3 items-end">
              <label style={{ width: 240 }}><span className="mini">Name, first name</span><input className="inp" value={a.person_name} readOnly /></label>
              <label style={{ width: 280 }}><span className="mini">Position</span><input name="position" className="inp" defaultValue={a.position ?? ""} readOnly={ro} /></label>
              <label style={{ width: 160 }}><span className="mini">Date of assessment</span><input name="assessed_on" type="date" className="inp" defaultValue={a.assessed_on ?? ""} readOnly={ro} /></label>
              <label style={{ width: 180 }}><span className="mini">Date of the last assessment</span><input name="last_assessed_on" type="date" className="inp" defaultValue={a.last_assessed_on ?? ""} readOnly={ro} /></label>
              <label style={{ width: 240 }}><span className="mini">Assessor</span>{edit ? <select name="assessor_id" className="inp" defaultValue={a.assessor_id ?? ""}>{!a.assessor_id && <option value="">—</option>}{people.filter((x) => x.id !== a.person_id).map((x) => <option key={x.id} value={x.id}>{x.display_name}</option>)}</select> : <input className="inp" value={a.assessor_name ?? ""} readOnly />}</label>
            </div>
            <p className="mini mt-3">Functions assessed: <b>{fnLabel}</b></p>
            <label className="block mt-3"><span className="mini">Organizational changes during the period that may impact required training</span><textarea name="org_changes" className="inp" rows={2} defaultValue={a.org_changes ?? ""} readOnly={ro} /></label>
            <p className="mini mt-3">The evaluator must assess the collaborator through oral questions for each of the evaluation points, and an overall assessment will then be given in the “Remarks” column.</p>
            <p className="mini mt-1">Evaluation levels: {F.levels.map(([n, l]) => `${n}: ${l}`).join("  ·  ")}</p>
          </div>
        </section>

        {sections.map((sec) => (
          <section className="card mb-4" key={sec}>
            <div className="ch"><span className="eyebrow">{sec}</span><span className="mini">{a.items.filter((i) => i.section === sec && i.level).length}/{a.items.filter((i) => i.section === sec).length}</span></div>
            <table className="tbl">
              <thead><tr><th style={{ width: 50 }}>N°</th><th>Points to evaluate</th><th style={{ width: 190 }}>Assessment level</th><th style={{ width: "32%" }}>RMK</th></tr></thead>
              <tbody>{a.items.filter((i) => i.section === sec).map((i) => (
                <tr key={i.k}>
                  <td className="mono">{i.k}</td>
                  <td>{i.text}</td>
                  <td>{edit ? <span className="flex gap-3" role="radiogroup" aria-label={`Level, point ${i.k}`}>{[1, 2, 3, 4].map((n) => <label key={n} className="flex items-center gap-1" title={F.levels.find((l) => l[0] === n)?.[1]}><input type="radio" name={`l_${i.k}`} value={n} defaultChecked={i.level === n} />{n}</label>)}</span>
                    : i.level ? <span className={"pill " + (i.level >= 4 ? "green" : i.level === 3 ? "" : i.level === 2 ? "amber" : "red")} title={F.levels.find((l) => l[0] === i.level)?.[1]}>{i.level}</span> : <span className="mini">—</span>}</td>
                  <td>{edit ? <input name={`r_${i.k}`} className="inp" style={{ marginTop: 0 }} defaultValue={i.remark ?? ""} /> : (i.remark ?? "")}</td>
                </tr>))}</tbody>
            </table>
          </section>
        ))}

        {F.page3 && (
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Page 3, certificates at the date of the competency assessment</span></div>
            <div className="cb grid md:grid-cols-2 gap-3">
              <label><span className="mini">Diplomas: title, date (one per line)</span><textarea name="diplomas" className="inp" rows={4} defaultValue={a.diplomas ?? ""} readOnly={ro} /></label>
              <label><span className="mini">Trainings: title, date, recurrent Y/N, validity date (one per line)</span><textarea name="trainings" className="inp" rows={4} defaultValue={a.trainings ?? ""} readOnly={ro} /></label>
            </div>
          </section>
        )}

        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Assessed considered fit for position</span>{p.low > 0 && <span className="mini">{p.low} point{p.low === 1 ? "" : "s"} at level 1 or 2</span>}</div>
          <div className="cb">
            {edit ? <div className="flex flex-wrap gap-5">{Object.entries(OUTCOME).map(([k, [l]]) => <label key={k} className="flex items-center gap-2"><input type="radio" name="outcome" value={k} defaultChecked={a.outcome === k} />{l}</label>)}</div>
              : <span className={"pill " + (o?.[1] ?? "")}>{o?.[0] ?? "not decided"}</span>}
            <label className="block mt-3"><span className="mini">Training required (if any)</span><textarea name="training_required" className="inp" rows={2} defaultValue={a.training_required ?? ""} readOnly={ro} /></label>
            <label className="block mt-3" style={{ width: 220 }}><span className="mini">Next assessment due (as the manual requires)</span><input name="next_due" type="date" className="inp" defaultValue={a.next_due ?? ""} readOnly={ro} /></label>
            {a.status === "signed" && <p className="mt-3"><b>Assessor signature:</b> {a.assessor_name}, signed in S.A.M. on {fr(a.signed_at)}.</p>}
            {edit && (
              <div className="mt-4 flex flex-wrap gap-2 items-center">
                <button className="btn" type="submit" name="intent" value="save">Save the draft</button>
                {mine && <button className="btn primary" type="submit" name="intent" value="sign">Save and sign as assessor</button>}
                <span className="mini">{miss.length ? "Before the signature: " + miss.join(", ") + "." : mine ? "Nothing missing: the sheet can be signed. Once signed it is no longer edited." : `Nothing missing: ${a.assessor_name ?? "the assessor"} signs it.`}</span>
              </div>
            )}
          </div>
        </section>
      </form>

      {edit && <form action={deleteDraft} className="mb-4"><input type="hidden" name="id" value={a.id} /><button className="mini underline" type="submit">Delete this draft</button></form>}
      {a.status === "signed" && isDesk(s) && (
        <form action={reopenAssessment} className="flex gap-2 items-end mb-4"><input type="hidden" name="id" value={a.id} />
          <label style={{ width: 360 }}><span className="mini">Reopen (an error on the sheet): the reason, kept in the audit log</span><input name="reason" className="inp" required /></label>
          <button className="btn" type="submit">Reopen</button></form>
      )}
    </>
  );
}
