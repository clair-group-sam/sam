import { fr } from "@/lib/dates";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { FORMS, OUTCOME, VALIDITY_MONTHS, maySee, type Assessment } from "@/lib/competency";
import { signatureDataUri } from "@/lib/signature";

export const dynamic = "force-dynamic";
const CSS = `
@page { size: A4; margin: 16mm 14mm 16mm 14mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9px Inter, Arial; color: #6b7a8c } }
body{background:#fff}
.ca{font:11px/1.45 Inter, Arial, sans-serif;color:#0d2a3f}
.ca h1{font-size:17px;margin:0 0 2px}.ca h2{font-size:12px;margin:14px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #0d2a3f;text-transform:uppercase;letter-spacing:.06em}
.ca .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.ca .ent{font-weight:700;font-size:12px}
.ca table{width:100%;border-collapse:collapse;margin:4px 0}.ca th,.ca td{border:1px solid #c9d3dc;padding:4px 6px;vertical-align:top;text-align:left}.ca th{background:#f1f5f8;font-weight:700}
.ca .kv td:first-child{width:32%;color:#44546a;background:#f8fafb}.ca tr{page-break-inside:avoid}
.ca .c{text-align:center;width:34px}.ca .mini{font-size:9.5px;color:#6b7a8c}.ca .box{display:inline-block;width:10px;height:10px;border:1px solid #0d2a3f;margin-right:5px;vertical-align:-1px;text-align:center;line-height:9px;font-size:9px}
.ca .sig td{height:84px}.ca pre{font:inherit;white-space:pre-wrap;margin:0}
`;

/** Printable competency assessment, laid out as the house form (ENR-COMP-01 OPS, ENR-COMP-02 CAMO): page 1 heading, the points with
 *  their level 1 to 4 and remarks, fit for position, training required, signatures; page 3 for the CAMO form. */
export default async function PrintAssessment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession(); if (!s) redirect("/login");
  const { data } = await supabaseAdmin().from("competency_assessments").select("*").eq("id", id).maybeSingle();
  const a = data as Assessment | null;
  if (!a || !maySee(s, a)) notFound();
  // 24/11 (Guillaume) · the handwritten signature of the assessor only, and only on a sheet the assessor signed in S.A.M.
  const sig = a.status === "signed" ? await signatureDataUri(supabaseAdmin(), a.signed_by) : null;
  const F = FORMS[a.form]; const signed = a.status === "signed";
  const sections = [...new Set(a.items.map((i) => i.section))];
  const lines = (t: string | null) => (t ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="ca">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="top">
        <div><div className="ent">{ENT[a.entity]?.name ?? a.entity}</div><h1>Competence assessment</h1><div className="mini">{a.kind === "initial" ? "Initial assessment" : "Recurrent assessment"}{F.basis ? `, ${F.basis}` : ""}</div></div>
        <div style={{ textAlign: "right" }}><b>{a.form_ref}</b><div className="mini">{a.form_edition}</div>{!signed && <div style={{ color: "#a3271b", fontWeight: 700 }}>NOT SIGNED</div>}</div>
      </div>
      <table className="kv"><tbody>
        <tr><td>Name, first name</td><td><b>{a.person_name}</b></td></tr>
        <tr><td>Position</td><td>{a.position ?? ""}</td></tr>
        <tr><td>Functions assessed</td><td>{F.functions.map((f) => <span key={f.code} style={{ marginRight: 14 }}><span className="box">{a.functions.includes(f.code) ? "X" : ""}</span>{f.label}</span>)}</td></tr>
        <tr><td>Date of assessment</td><td>{fr(a.assessed_on)}</td></tr>
        <tr><td>Date of the last assessment</td><td>{fr(a.last_assessed_on)}</td></tr>
        <tr><td>Assessor</td><td>{a.assessor_name ?? ""}{a.assessor_name ? ", Compliance Monitoring Manager" : ""}</td></tr>
        <tr><td>Organizational changes during the period that may impact required training</td><td><pre>{a.org_changes ?? ""}</pre></td></tr>
      </tbody></table>
      <p className="mini">The evaluator must assess the collaborator through oral questions for each of the evaluation points, and an overall assessment will then be given in the “Remarks” column. Evaluation levels: {F.levels.map(([n, l]) => `${n}: ${l}`).join("  ·  ")}</p>
      {sections.map((sec) => (
        <div key={sec}>
          <h2>{sec}</h2>
          <table><thead><tr><th style={{ width: 34 }}>N°</th><th>Points to evaluate</th><th className="c">1</th><th className="c">2</th><th className="c">3</th><th className="c">4</th><th style={{ width: "28%" }}>RMK</th></tr></thead>
            <tbody>{a.items.filter((i) => i.section === sec).map((i) => (
              <tr key={i.k}><td>{i.k}</td><td>{i.text}</td>{[1, 2, 3, 4].map((n) => <td key={n} className="c">{i.level === n ? "X" : ""}</td>)}<td>{i.remark ?? ""}</td></tr>))}</tbody></table>
        </div>
      ))}
      <h2>Assessed considered fit for position</h2>
      <p>{Object.entries(OUTCOME).map(([k, [l]]) => <span key={k} style={{ marginRight: 18 }}><span className="box">{a.outcome === k ? "X" : ""}</span>{l}</span>)}</p>
      <table className="kv"><tbody>
        <tr><td>Training required (if any)</td><td><pre>{a.training_required ?? ""}</pre></td></tr>
        <tr><td>Validity</td><td>{VALIDITY_MONTHS} months (MSM 4-5){a.next_due ? `: next assessment due by ${fr(a.next_due)}` : ""}</td></tr>
      </tbody></table>
      <table className="sig"><thead><tr><th style={{ width: "50%" }}>Assessor</th><th>Assessed</th></tr></thead><tbody><tr>
        <td>{signed ? <>{sig && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={sig} alt="" style={{ maxHeight: 46, maxWidth: 200, display: "block" }} /></>}<b>{a.assessor_name}</b>, Compliance Monitoring Manager<br />Signed in S.A.M. on {fr(a.signed_at)}</> : ""}</td>
        <td><b>{a.person_name}</b>{a.submitted_at ? <><br />Pre-filled and sent in S.A.M. on {fr(a.submitted_at)}</> : ""}</td></tr></tbody></table>
      {F.page3 && (
        <div style={{ pageBreakBefore: "always" }}>
          <h2>Certificates at the date of the competency assessment</h2>
          <table><thead><tr><th>Diplomas: title, date</th></tr></thead><tbody>{(lines(a.diplomas).length ? lines(a.diplomas) : [""]).map((l, i) => <tr key={i}><td style={{ height: 18 }}>{l}</td></tr>)}</tbody></table>
          <table><thead><tr><th>Trainings: title, date, recurrent Y/N, validity date</th></tr></thead><tbody>{(lines(a.trainings).length ? lines(a.trainings) : [""]).map((l, i) => <tr key={i}><td style={{ height: 18 }}>{l}</td></tr>)}</tbody></table>
        </div>
      )}
      <p className="mini" style={{ marginTop: 10 }}>Record kept in S.A.M.; signatures are electronic and traced in the audit log.</p>
    </div>
  );
}
