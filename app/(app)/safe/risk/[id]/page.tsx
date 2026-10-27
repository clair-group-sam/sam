import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { HZ_STATUS, TOL_LABEL, KINDS, mayEditRisk, schemeOf, tolerability, tolTone } from "@/lib/risk";
import { RiskMatrix, RiskPill } from "@/components/RiskMatrix";
import { addMitigation, doneMitigation, keepHazard, discardHazard, reviewedNoChange, updateHazard } from "../actions";

type H = { id: string; entity: string; ref: string; title: string; description: string | null; consequence: string | null; main_impact: string | null; source: string; report_id: string | null; assessment_id: string | null; proposed: boolean; owner_role: string | null; status: string; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; review_date: string | null; needs_review: boolean; log_hazard_id: string | null; local_only: boolean };
type M = { id: string; text: string; existing: boolean; owner_role: string | null; due: string | null; done_at: string | null };
type E = { id: number; at: string; kind: string; note: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Safety › Risk register › hazard: consequence, pre / post rating on the entity's matrix, current and planned mitigations, related reports, journal. */
export default async function HazardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("hazards").select("*").eq("id", id).maybeSingle();
  const h = data as H | null;
  if (!h || !s.entities.includes(h.entity)) notFound();
  const [{ data: ms }, { data: ev }, { data: ra }, { data: reps }] = await Promise.all([
    db.from("hazard_mitigations").select("id,text,existing,owner_role,due,done_at").eq("hazard_id", id).order("created_at"),
    db.from("risk_events").select("id,at,kind,note").eq("hazard_id", id).order("at"),
    h.assessment_id ? db.from("risk_assessments").select("id,number,name,kind,status").eq("id", h.assessment_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("hazard_reports").select("report_id,linked_at,reports(headline,headline_en,received_at)").eq("hazard_id", id),
  ]);
  // hazard log ⇄ studies: a log hazard lists the MOC / RA hazards that reference it; a study hazard shows its log hazard
  const [{ data: by }, { data: lh }] = await Promise.all([
    db.from("hazards").select("id,ref,title,lik_after,sev_after,risk_assessments!inner(id,kind,number,name,status)").eq("log_hazard_id", id),
    h.log_hazard_id ? db.from("hazards").select("id,ref,title,lik_after,sev_after").eq("id", h.log_hazard_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const studies = (by ?? []) as unknown as { id: string; ref: string; title: string; lik_after: number | null; sev_after: string | null; risk_assessments: { id: string; kind: string; number: string; name: string; status: string } }[];
  const logH = lh as { id: string; ref: string; title: string; lik_after: number | null; sev_after: string | null } | null;
  const mit = (ms ?? []) as M[]; const events = (ev ?? []) as E[]; const a = ra as { id: string; number: string; name: string; kind: string; status: string } | null;
  const related = (reps ?? []) as unknown as { report_id: string; reports: { headline: string; headline_en: string | null } | null }[];
  const signed = !!a && a.status !== "draft";
  const edit = mayEditRisk(s) && h.status !== "closed" && !signed;
  const sch = schemeOf(h.entity);
  const tb = tolerability(h.lik_before, h.sev_before, sch), ta = tolerability(h.lik_after, h.sev_after, sch);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader eyebrow={`Safety · ${a?.kind === "hazard_log" ? "Hazard log" : a ? KINDS[a.kind] : "Risk"} · ${h.ref}`} title={h.title}
        tag={<span className="flex gap-2 items-center"><span className={"pill " + (HZ_STATUS[h.status]?.[1] ?? "")}>{HZ_STATUS[h.status]?.[0]}</span><RiskPill lik={h.lik_before} sev={h.sev_before} entity={h.entity} prefix="pre" /><RiskPill lik={h.lik_after} sev={h.sev_after} entity={h.entity} prefix="post" />{h.proposed && <span className="pill">proposed by SAM</span>}{h.needs_review && <span className="pill red">to reassess</span>}</span>}
        sub={`${h.entity}${a ? ` · ${KINDS[a.kind]} ${a.number} — ${a.name}` : ""}`}
        right={<>{a && <Link className="btn" href={`/safe/risk/a/${a.id}`}>{a.number}</Link>}<Link className="btn" href="/safe/risk">Hazard log</Link></>} />
      {signed && <p className="mini mb-3">The assessment {a!.number} is signed: to change this hazard, reopen a new version of the assessment.</p>}
      {h.proposed && edit && (
        <section className="card hz-proposed mb-4"><div className="cb flex gap-3 items-center"><span className="flex-1">SAM proposed this hazard. Keep it (its planned mitigations with an owner then reach their Inbox) or discard it.</span>
          <form action={keepHazard}><input type="hidden" name="id" value={h.id} /><button className="btn primary">Keep</button></form><form action={discardHazard}><input type="hidden" name="id" value={h.id} /><button className="btn">Discard</button></form></div></section>
      )}
      {h.needs_review && mayEditRisk(s) && (
        <section className="card hz-proposed mb-4"><form action={reviewedNoChange} className="cb flex gap-3 items-center"><input type="hidden" name="id" value={h.id} /><span className="flex-1">A new occurrence was linked to this hazard: reassess it (MSM §3.5.1). Changing a rating closes the reassessment; or record that the values stay valid.</span>
          <input name="note" className="inp" placeholder="Why the values stay valid" style={{ marginTop: 0, maxWidth: 320 }} /><button className="btn">Reviewed — no change</button></form></section>
      )}
      <div className="repgrid2">
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Hazard – consequence</span></div>
            <form action={updateHazard} className="cb grid gap-2"><input type="hidden" name="id" value={h.id} />
              <label><span className="mini">Hazard (headline)</span><input name="title" className="inp" defaultValue={h.title} disabled={!edit} /></label>
              <label><span className="mini">Description</span><textarea name="description" className="inp" rows={2} defaultValue={h.description ?? ""} disabled={!edit} /></label>
              <label><span className="mini">Consequence (reasonably worst case)</span><textarea name="consequence" className="inp" rows={2} defaultValue={h.consequence ?? ""} disabled={!edit} /></label>
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Main impact</span><input name="main_impact" className="inp" defaultValue={h.main_impact ?? ""} disabled={!edit} placeholder="safety · security · CIA (Part-IS)…" /></label><label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" defaultValue={h.owner_role ?? ""} disabled={!edit} /></label></div>
              {edit && <div className="flex justify-end"><button className="btn">Save</button></div>}
            </form>
          </section>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Mitigations</span><span className="mini">a planned mitigation with an owner goes to their Inbox</span></div>
            <div className="cb">
              <table className="tbl mb-3"><tbody>{mit.map((x) => (
                <tr key={x.id}><td style={{ width: 120 }}><span className={"kind " + (x.existing || x.done_at ? "k-read" : x.due && x.due < today ? "k-comp" : "k-cert")}>{x.existing ? "Current" : x.done_at ? "Done" : x.due && x.due < today ? "Overdue" : "Planned"}</span></td>
                  <td>{x.text}<div className="mini">{x.owner_role ?? ""}{x.due ? ` · by ${x.due}` : ""}{x.done_at ? ` · done ${x.done_at.slice(0, 10)}` : ""}</div></td>
                  <td style={{ width: 90 }} className="text-right">{!x.existing && !x.done_at && mayEditRisk(s) && <form action={doneMitigation}><input type="hidden" name="id" value={x.id} /><button className="btn">Done</button></form>}</td></tr>))}
                {!mit.length && <tr><td className="mini p-3">No mitigation listed yet.</td></tr>}</tbody></table>
              {edit && (
                <form action={addMitigation} className="grid gap-2" style={{ gridTemplateColumns: "1fr 130px 90px 140px auto" }}><input type="hidden" name="hazard_id" value={h.id} />
                  <input name="text" className="inp" placeholder="Mitigation" required />
                  <select name="existing" className="inp"><option value="0">planned</option><option value="1">current (in place)</option></select>
                  <input name="owner_role" className="inp mono" placeholder="post" />
                  <input type="date" name="due" className="inp" />
                  <button className="btn">Add</button>
                </form>
              )}
            </div>
          </section>
          {logH && <section className="card mb-4"><div className="ch"><span className="eyebrow">In the hazard log</span><RiskPill lik={logH.lik_after} sev={logH.sev_after} entity={h.entity} prefix="log" /></div><div className="cb"><Link className="underline mono" href={`/safe/risk/${logH.id}`}>{logH.ref}</Link> {logH.title}<p className="mini mt-1">When this study is accepted with a different residual rating, the log hazard is flagged for reassessment.</p></div></section>}
          {a && a.kind !== "hazard_log" && !logH && h.local_only && <p className="mini mb-4">Kept local to {a.number}: temporary hazard, not in the hazard log.</p>}
          {studies.length > 0 && <section className="card mb-4"><div className="ch"><span className="eyebrow">Studies referencing this hazard</span><span className="mini">MOC / risk assessments</span></div>
            <table className="tbl"><tbody>{studies.map((x) => <tr key={x.id}><td style={{ width: 120 }} className="mono"><Link className="underline" href={`/safe/risk/a/${x.risk_assessments.id}`}>{x.risk_assessments.number}</Link></td><td>{x.risk_assessments.name}<div className="mini">{KINDS[x.risk_assessments.kind]} · <Link className="underline" href={`/safe/risk/${x.id}`}>{x.ref}</Link> {x.title}</div></td><td style={{ width: 110 }}><RiskPill lik={x.lik_after} sev={x.sev_after} entity={h.entity} prefix="post" /></td></tr>)}</tbody></table></section>}
          {related.length > 0 && <section className="card mb-4"><div className="ch"><span className="eyebrow">Related safety reports</span></div><div className="cb">{related.map((r) => <div key={r.report_id}><Link className="underline" href={`/safe/reports/${r.report_id}`}>Report {r.report_id}</Link> — {r.reports?.headline_en ?? r.reports?.headline}</div>)}</div></section>}
          <section className="card">
            <div className="ch"><span className="eyebrow">Journal</span></div>
            <div className="cb"><ul className="journal">{events.map((e) => <li key={e.id}><span className="mini mono mr-2">{when(e.at)}</span><b>{e.kind.replace(/_/g, " ")}</b> — {e.note}</li>)}</ul></div>
          </section>
        </div>
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Pre-mitigation risk</span>{tb && <span className={"pill " + tolTone(tb)}>{TOL_LABEL[tb]}</span>}</div>
            <div className="cb"><RiskMatrix id={h.id} entity={h.entity} which="before" lik={h.lik_before} sev={h.sev_before} editable={edit || (h.needs_review && mayEditRisk(s) && !signed)} /><p className="mini mt-2">With the current mitigations, before the planned ones.</p></div>
          </section>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Post-mitigation risk</span>{ta && <span className={"pill " + tolTone(ta)}>{TOL_LABEL[ta]}</span>}</div>
            <div className="cb"><RiskMatrix id={h.id} entity={h.entity} which="after" lik={h.lik_after} sev={h.sev_after} editable={edit || (h.needs_review && mayEditRisk(s) && !signed)} /><p className="mini mt-2">Once the planned mitigations are in place.</p></div>
          </section>
          {mayEditRisk(s) && !signed && (
            <section className="card"><div className="ch"><span className="eyebrow">Status</span></div>
              <div className="cb flex gap-2">{(["open", "monitoring", "closed"] as const).filter((x) => x !== h.status).map((x) => <form key={x} action={updateHazard}><input type="hidden" name="id" value={h.id} /><input type="hidden" name="status" value={x} /><button className="btn">{x === "open" ? "Reopen" : x === "monitoring" ? "Monitoring" : "Archive the hazard"}</button></form>)}</div></section>
          )}
        </div>
      </div>
    </>
  );
}
