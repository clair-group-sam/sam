import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { DECISIONS, DOMAINS, KINDS, MOC_CATEGORIES, MOC_STATUS, MSM_REF, RA_STATUS, mayAccept, mayEditRisk, mayValidate, msmChecks, riskLabel, schemeOf, tolerability, tolTone, worstTol, type Hz, type Ra } from "@/lib/risk";
import { PdfButton } from "@/components/RiskPdfButton";
import { acceptAssessment, createHazard, discardHazard, keepHazard, mocStep, proposeHazards, reopenAssessment, updateAssessment, validateAssessment } from "../../actions";

export const maxDuration = 60;
type E = { id: number; at: string; kind: string; note: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Safety › Risk register › assessment: set-up, participants, hazards (pre / post), MOC steps, MSM conformity, NP sign-off, AM acceptance, PDF. */
export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("risk_assessments").select("*").eq("id", id).maybeSingle();
  const a = data as Ra | null;
  if (!a || !s.entities.includes(a.entity)) notFound();
  const [{ data: hz }, { data: ev }] = await Promise.all([
    db.from("hazards").select("id,ref,title,description,consequence,main_impact,proposed,status,lik_before,sev_before,lik_after,sev_after,needs_review,owner_role,hazard_mitigations(text,existing,owner_role,due,done_at),hazard_reports(report_id)").eq("assessment_id", id).order("created_at"),
    db.from("risk_events").select("id,at,kind,note").eq("assessment_id", id).order("at"),
  ]);
  const hazards = (hz ?? []) as unknown as (Hz & { hazard_reports: { report_id: string }[] })[]; const events = (ev ?? []) as E[];
  const sch = schemeOf(a.entity);
  const live = hazards.filter((h) => h.status !== "closed");
  const checks = msmChecks(a, hazards);
  const draft = a.status === "draft";
  const edit = mayEditRisk(s) && draft;
  const worstPost = worstTol(live.filter((h) => !h.proposed).map((h) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, sch)));
  const reports = [...new Set(hazards.flatMap((h) => h.hazard_reports.map((r) => r.report_id)))];
  const signBlock = [!live.length && "no hazard", live.some((h) => h.proposed) && "hazards proposed by SAM to keep or discard", live.some((h) => !h.lik_after || !h.sev_after) && "hazards without a post-mitigation rating"].filter(Boolean) as string[];
  const moc = a.kind === "moc";
  return (
    <>
      <PageHeader eyebrow={`Safety · Risk register · ${KINDS[a.kind]} · ${ENT[a.entity]?.name ?? a.entity}`} title={`${a.number} — ${a.name}`}
        tag={<span className="flex gap-2 items-center flex-wrap"><span className={"pill " + (RA_STATUS[a.status]?.[1] ?? "")}>{RA_STATUS[a.status]?.[0]}</span>{moc && a.moc_status && <span className={"pill " + (MOC_STATUS[a.moc_status]?.[1] ?? "")}>MOC · {MOC_STATUS[a.moc_status]?.[0]}</span>}{a.decision && <span className="pill">{DECISIONS[a.decision]}</span>}{worstPost && <span className={"pill " + tolTone(worstPost)}>residual {worstPost}</span>}<span className="mini">v{a.version}{a.source !== "sam" ? ` · imported from ${a.source}` : ""}</span></span>}
        sub={`${a.domain ?? "—"} · owner ${a.owner_role ?? "—"} · ${MSM_REF[a.entity] ?? ""}${a.kind !== "moc" ? ` · next review ${a.next_due ?? "—"}` : a.start_date ? ` · planned ${a.start_date}` : ""}`}
        right={<><PdfButton id={a.id} />{a.project_id && <Link className="btn" href={`/proj/boards/${a.project_id}`}>Project</Link>}{a.authority_file_id && <Link className="btn" href={`/proj/auth/${a.authority_file_id}`}>Authority file</Link>}<Link className="btn" href={moc ? "/safe/moc" : "/safe/risk"}>{moc ? "All MOCs" : "Register"}</Link></>} />

      <div className="repgrid2">
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Hazards summary</span><span className="mini">hazard – consequence · pre → post mitigation{sch === "centrik" ? " · score" : ""}</span></div>
            <table className="tbl"><tbody>
              {hazards.map((h) => {
                const pre = tolerability(h.lik_before, h.sev_before, sch), po = tolerability(h.lik_after, h.sev_after, sch);
                const cur = (h.hazard_mitigations ?? []).filter((m) => m.existing).length, plan = (h.hazard_mitigations ?? []).filter((m) => !m.existing);
                return (
                  <tr key={h.id} className={(h.proposed ? "hz-proposed" : "") + (h.status === "closed" ? " muted" : "")}>
                    <td style={{ width: 105 }} className="mono"><Link className="underline" href={`/safe/risk/${h.id}`}>{h.ref}</Link>{h.proposed && <div className="mini">proposed</div>}{h.needs_review && <div className="mini red">to reassess</div>}</td>
                    <td><Link href={`/safe/risk/${h.id}`}><b>{h.title}</b></Link>{h.consequence && <div className="mini">→ {h.consequence}</div>}<div className="mini">{cur} current · {plan.length} planned mitigation{plan.length === 1 ? "" : "s"}{plan.some((m) => !m.done_at && m.due && m.due < new Date().toISOString().slice(0, 10)) ? " · overdue" : ""}{h.hazard_reports.length ? ` · ${h.hazard_reports.length} report${h.hazard_reports.length > 1 ? "s" : ""}` : ""}</div></td>
                    <td style={{ width: 165 }}>{pre ? <span className={"pill " + tolTone(pre)}>{riskLabel(h.lik_before, h.sev_before, sch)}</span> : <span className="mini">—</span>} → {po ? <span className={"pill " + tolTone(po)}>{riskLabel(h.lik_after, h.sev_after, sch)}</span> : <span className="mini">—</span>}</td>
                    <td style={{ width: 120 }} className="text-right">{h.proposed && edit && <span className="flex gap-1 justify-end"><form action={keepHazard}><input type="hidden" name="id" value={h.id} /><button className="btn">Keep</button></form><form action={discardHazard}><input type="hidden" name="id" value={h.id} /><button className="btn" title="Discard">✕</button></form></span>}</td>
                  </tr>);
              })}
              {!hazards.length && <tr><td className="p-4 mini">No hazard yet.</td></tr>}
            </tbody></table>
            {edit && (
              <div className="cb">
                <form action={createHazard} className="grid gap-2 mb-3" style={{ gridTemplateColumns: "1fr 1fr auto" }}><input type="hidden" name="assessment_id" value={a.id} /><input type="hidden" name="stay" value="1" />
                  <input name="title" className="inp" placeholder="Hazard" required style={{ marginTop: 0 }} /><input name="consequence" className="inp" placeholder="Consequence (reasonably worst case)" style={{ marginTop: 0 }} /><button className="btn">Add</button></form>
                <form action={proposeHazards}><input type="hidden" name="id" value={a.id} /><button className="btn">🤝 Ask SAM to propose hazards</button> <span className="mini">rated pre / post with mitigations and owners — each stays “proposed” until you keep it</span></form>
              </div>
            )}
          </section>

          {moc && (
            <section className="card mb-4">
              <div className="ch"><span className="eyebrow">The change · MOC steps 1–6</span><span className="mini">{MSM_REF[a.entity]}.4</span></div>
              <form action={updateAssessment} className="cb grid grid-cols-2 gap-2"><input type="hidden" name="id" value={a.id} />
                <label className="col-span-2"><span className="mini">1 · The change in detail (indirect changes, timing, transition period)</span><textarea name="description" className="inp" rows={4} defaultValue={a.description ?? ""} disabled={!edit} /></label>
                <label><span className="mini">2 · Reason for the change</span><textarea name="reason" className="inp" rows={2} defaultValue={a.reason ?? ""} disabled={!edit} /></label>
                <label><span className="mini">Requestor · induced responsibilities</span><textarea name="requestor" className="inp" rows={2} defaultValue={a.requestor ?? ""} disabled={!edit} /></label>
                <label><span className="mini">3 · Regulations, domains and services affected</span><textarea name="affected" className="inp" rows={2} defaultValue={a.affected ?? ""} disabled={!edit} /></label>
                <label><span className="mini">4 · Criticality and impact (incl. human performance)</span><textarea name="criticality" className="inp" rows={2} defaultValue={a.criticality ?? ""} disabled={!edit} /></label>
                <label><span className="mini">5 · Prior safety assessments impacted</span><textarea name="prior_assessments" className="inp" rows={2} defaultValue={a.prior_assessments ?? ""} disabled={!edit} /></label>
                <label><span className="mini">6 · Actions and controls already in place / to create</span><textarea name="actions_in_place" className="inp" rows={2} defaultValue={a.actions_in_place ?? ""} disabled={!edit} /></label>
                <label><span className="mini">Category</span><select name="category" className="inp" defaultValue={a.category ?? "other"} disabled={!edit}>{Object.entries(MOC_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span className="mini">Permanent / temporary</span><select name="change_type" className="inp" defaultValue={a.change_type ?? "permanent"} disabled={!edit}><option value="permanent">permanent</option><option value="temporary">temporary</option></select></label>
                <label><span className="mini">Start</span><input type="date" name="start_date" className="inp" defaultValue={a.start_date ?? ""} disabled={!edit} /></label>
                <label><span className="mini">End (temporary change)</span><input type="date" name="end_date" className="inp" defaultValue={a.end_date ?? ""} disabled={!edit} /></label>
                <label className="col-span-2"><span className="mini">Authority</span><select name="authority_route" className="inp" defaultValue={a.authority_route ?? ""} disabled={!edit}><option value="">to decide</option><option value="approval">prior approval</option><option value="notification">notification</option><option value="none">not required</option></select></label>
                {edit && <div className="col-span-2 flex justify-end"><button className="btn">Save</button></div>}
              </form>
            </section>
          )}

          <section className="card">
            <div className="ch"><span className="eyebrow">Journal</span><span className="mini">append-only</span></div>
            <div className="cb"><ul className="journal">{events.map((e) => <li key={e.id}><span className="mini mono mr-2">{when(e.at)}</span><b>{e.kind.replace(/_/g, " ")}</b> — {e.note}</li>)}</ul></div>
          </section>
        </div>

        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Decision &amp; sign-off</span></div>
            <div className="cb">
              {draft && (mayValidate(s) ? (signBlock.length ? <p className="mini">Sign-off possible once: {signBlock.join(" · ")}.</p> : (
                <form action={validateAssessment} className="grid gap-2"><input type="hidden" name="id" value={a.id} />
                  <select name="decision" className="inp" defaultValue={a.decision ?? (worstPost === "intolerable" ? "stop" : "continue")}>{Object.entries(DECISIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <textarea name="decision_comment" className="inp" rows={2} defaultValue={a.decision_comment ?? ""} placeholder="Comments (e.g. hazards reviewed, related reports do not change the values…)" />
                  <button className="btn primary">Sign off — {s.name.split(" ")[0]}</button>
                  <span className="mini">Validation by the most relevant nominated person, his/her deputy or the SM.</span>
                </form>)) : <p className="mini">Waiting for the sign-off of the most relevant nominated person (or deputy / SM).</p>)}
              {a.validated_at && <p className="mb-2">✓ Signed off by <b>{a.validated_name}</b>{a.validated_role ? ` (${a.validated_role})` : ""} · {a.validated_at.slice(0, 10)}{a.decision ? ` · ${DECISIONS[a.decision]}` : ""}{a.decision_comment ? <><br /><span className="mini">{a.decision_comment}</span></> : null}</p>}
              {a.status === "validated" && (mayAccept(s) ? (
                <form action={acceptAssessment} className="grid gap-2 mt-2"><input type="hidden" name="id" value={a.id} />
                  <p className="mini">The residual risk stays red. Approve the activity anyway (justification required) or stop it.</p>
                  <textarea name="comment" className="inp" rows={2} placeholder="Justification / conditions" />
                  <div className="flex gap-2"><button className="btn primary" name="verdict" value="approve">Approve the red risk (AM)</button><button className="btn" name="verdict" value="stop">Stop (AM)</button></div>
                </form>
              ) : <p className="mini">Residual risk red: waiting for the Accountable Manager&apos;s decision.</p>)}
              {a.status === "accepted" && !a.accepted_at && <p className="mini mb-2">Accepted by the sign-off (green / yellow residual risk) — the AM may overrule it by opening a new version.</p>}
              {a.accepted_at && <p className="mb-2">✓ Decided by the AM <b>{a.accepted_name}</b> · {a.accepted_at.slice(0, 10)}</p>}
              {moc && a.status === "accepted" && a.moc_status === "approved" && <form action={mocStep} className="mt-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="implemented" /><button className="btn primary">Mark the change as implemented</button></form>}
              {moc && a.moc_status === "implemented" && <form action={mocStep} className="mt-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="closed" /><button className="btn primary">Close the MOC</button></form>}
              {!draft && mayEditRisk(s) && !["archived", "cancelled"].includes(a.status) && <form action={reopenAssessment} className="mt-3 grid gap-2"><input type="hidden" name="id" value={a.id} />{mayAccept(s) && <input name="comment" className="inp" placeholder="Reason (AM overrule: scoring / decision changed)" />}<button className="btn">{mayAccept(s) ? "Overrule — new version" : "Reopen — new version"} (v{a.version + 1})</button></form>}
            </div>
          </section>

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">MSM conformity</span><span className="mini">{checks.filter((c) => c.ok).length}/{checks.length} · {MSM_REF[a.entity]}</span></div>
            <div className="cb"><ul className="checks">{checks.map((c, i) => <li key={i}><span className={c.ok ? "ok" : "ko"}>{c.ok ? "✓" : "✕"}</span><span className="flex-1">{c.label}{c.detail ? <span className="mini"> — {c.detail}</span> : null}</span><span className="mini mono">{c.ref}</span></li>)}</ul></div>
          </section>

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Set-up</span></div>
            <form action={updateAssessment} className="cb grid gap-2"><input type="hidden" name="id" value={a.id} />
              <label><span className="mini">Name</span><input name="name" className="inp" defaultValue={a.name} disabled={!edit} /></label>
              {!moc && <label><span className="mini">Description</span><textarea name="description" className="inp" rows={3} defaultValue={a.description ?? ""} disabled={!edit} /></label>}
              <div className="grid grid-cols-2 gap-2">
                <label><span className="mini">Domain</span><select name="domain" className="inp" defaultValue={a.domain ?? ""} disabled={!edit}><option value="">—</option>{[...new Set([...DOMAINS, a.domain ?? ""])].filter(Boolean).map((d) => <option key={d}>{d}</option>)}</select></label>
                <label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" defaultValue={a.owner_role ?? ""} disabled={!edit} /></label>
                {!moc && <label><span className="mini">Next review</span><input type="date" name="next_due" className="inp" defaultValue={a.next_due ?? ""} disabled={!edit} /></label>}
                {!moc && <label><span className="mini">Top risk</span><select name="top_risk" className="inp" defaultValue={a.top_risk ? "1" : "0"} disabled={!edit}><option value="0">no</option><option value="1">yes</option></select></label>}
              </div>
              <label><span className="mini">Participants — one per line: Name — role</span><textarea name="participants" className="inp" rows={3} defaultValue={(a.participants ?? []).map((p) => `${p.name}${p.role ? " — " + p.role : ""}`).join("\n")} disabled={!edit} /></label>
              {edit && <div className="flex justify-end"><button className="btn">Save</button></div>}
              {!draft && <p className="mini">Signed versions are read-only — reopen a new version to change them.</p>}
            </form>
          </section>

          {reports.length > 0 && (
            <section className="card"><div className="ch"><span className="eyebrow">Related safety reports</span></div>
              <div className="cb">{reports.map((r) => <Link key={r} href={`/safe/reports/${r}`} className="kind k-safe mr-1">Report {r}</Link>)}</div></section>
          )}
        </div>
      </div>
    </>
  );
}
