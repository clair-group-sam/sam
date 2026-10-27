import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { DECISIONS, KINDS, MOC_CATEGORIES, MSM_REF, RA_STATUS, SEVERITIES, LIKELIHOODS, msmChecks, riskLabel, schemeOf, tolerability, type Hz, type Ra } from "@/lib/risk";

export const dynamic = "force-dynamic";
const CSS = `
@page { size: A4; margin: 16mm 14mm 16mm 14mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9px Inter, Arial; color: #6b7a8c } }
body{background:#fff}
.ra{font:11px/1.45 Inter, Arial, sans-serif;color:#0d2a3f}
.ra h1{font-size:18px;margin:0 0 2px}.ra h2{font-size:12.5px;margin:14px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #0d2a3f;text-transform:uppercase;letter-spacing:.06em}
.ra .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.ra .ent{font-weight:700;font-size:12px}
.ra table{width:100%;border-collapse:collapse;margin:4px 0}.ra th,.ra td{border:1px solid #c9d3dc;padding:4px 6px;vertical-align:top;text-align:left}.ra th{background:#f1f5f8;font-weight:700}
.ra .kv td:first-child{width:32%;color:#44546a;background:#f8fafb}
.ra .r{color:#a3271b;font-weight:700}.ra .y{color:#8a5a00;font-weight:700}.ra .g{color:#1e7a3c;font-weight:700}
.ra .hz{page-break-inside:avoid}.ra ul{margin:2px 0 2px 14px;padding:0}.ra .mini{font-size:9.5px;color:#6b7a8c}
.ra .sig td{height:44px}
`;
const tc = (t: string | null) => (t === "intolerable" ? "r" : t === "tolerable" ? "y" : t === "acceptable" ? "g" : "");

/** Printable risk assessment (Centrik-like export) for the authority file: set-up, participants, hazards, decision, sign-offs, MSM conformity. */
export default async function PrintRisk({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("risk_assessments").select("*").eq("id", id).maybeSingle();
  const a = data as Ra | null;
  if (!a || !s.entities.includes(a.entity)) notFound();
  const { data: hz } = await db.from("hazards").select("id,ref,title,description,consequence,main_impact,proposed,status,lik_before,sev_before,lik_after,sev_after,needs_review,owner_role,hazard_mitigations(text,existing,owner_role,due,done_at)").eq("assessment_id", id).eq("proposed", false).order("created_at");
  const hazards = ((hz ?? []) as unknown as Hz[]).filter((h) => h.status !== "closed");
  const sch = schemeOf(a.entity);
  const checks = msmChecks(a, hazards);
  const lab = (l: number | null, v: string | null) => { const t = tolerability(l, v, sch); return <span className={tc(t)}>{riskLabel(l, v, sch) ?? "—"}{t ? ` (${t})` : ""}</span>; };
  return (
    <div className="ra">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="top"><div><div className="ent">{ENT[a.entity]?.name ?? a.entity}</div><div className="mini">{MSM_REF[a.entity]}</div></div><div className="mini" style={{ textAlign: "right" }}>S.A.M. · {KINDS[a.kind]}<br />printed {new Date().toISOString().slice(0, 10)}</div></div>
      <h1>{a.number} — {a.name}</h1>
      <div className="mini">Version {a.version} · {RA_STATUS[a.status]?.[0]}{a.decision ? ` · ${DECISIONS[a.decision]}` : ""}</div>

      <h2>Set-up</h2>
      <table className="kv"><tbody>
        <tr><td>Domain</td><td>{a.domain ?? "—"}</td></tr>
        <tr><td>Owner</td><td>{a.owner_role ?? "—"}</td></tr>
        {a.kind !== "moc" && <tr><td>Conducted on · next due</td><td>{a.conducted_on ?? "—"} · {a.next_due ?? "—"}</td></tr>}
        <tr><td>Description</td><td style={{ whiteSpace: "pre-wrap" }}>{a.description ?? "—"}</td></tr>
        <tr><td>Participants</td><td>{(a.participants ?? []).length ? (a.participants ?? []).map((p) => `${p.name}${p.role ? " (" + p.role + ")" : ""}`).join(" · ") : "—"}</td></tr>
        <tr><td>Method</td><td>Hazard – consequence; severity A–E × likelihood 1–5 ({sch === "centrik" ? "scores: green 1–10 acceptable, yellow 20–100 tolerable, red 300–2500 intolerable" : "ICAO tolerability table"}); reasonably worst case.</td></tr>
      </tbody></table>

      {a.kind === "moc" && (<>
        <h2>The change</h2>
        <table className="kv"><tbody>
          <tr><td>Category · type</td><td>{MOC_CATEGORIES[a.category ?? ""] ?? a.category ?? "—"} · {a.change_type ?? "—"} · {a.start_date ?? "—"}{a.end_date ? ` → ${a.end_date}` : ""}</td></tr>
          <tr><td>Reason · requestor</td><td>{a.reason ?? "—"}{a.requestor ? ` · ${a.requestor}` : ""}</td></tr>
          <tr><td>Regulations, domains, services affected</td><td>{a.affected ?? "—"}</td></tr>
          <tr><td>Criticality and impact (human performance)</td><td>{a.criticality ?? "—"}</td></tr>
          <tr><td>Prior safety assessments impacted</td><td>{a.prior_assessments ?? "—"}</td></tr>
          <tr><td>Actions and controls in place / to create</td><td>{a.actions_in_place ?? "—"}</td></tr>
          <tr><td>Authority</td><td>{a.authority_route ?? "—"}</td></tr>
        </tbody></table>
      </>)}

      <h2>Hazards ({hazards.length})</h2>
      <table><thead><tr><th style={{ width: "21%" }}>Hazard</th><th style={{ width: "21%" }}>Consequence</th><th>Current mitigation</th><th>Planned mitigation</th><th style={{ width: "11%" }}>Pre</th><th style={{ width: "11%" }}>Post</th></tr></thead>
        <tbody>{hazards.map((h) => (
          <tr key={h.id} className="hz">
            <td><b>{h.title}</b><div className="mini">{h.ref}</div>{h.description && <div className="mini">{h.description}</div>}</td>
            <td>{h.consequence ?? "—"}</td>
            <td><ul>{(h.hazard_mitigations ?? []).filter((m) => m.existing).map((m, i) => <li key={i}>{m.text}</li>)}</ul></td>
            <td><ul>{(h.hazard_mitigations ?? []).filter((m) => !m.existing).map((m, i) => <li key={i}>{m.text}{m.owner_role ? ` (${m.owner_role}${m.due ? `, ${m.due}` : ""})` : ""}{m.done_at ? " — done" : ""}</li>)}</ul></td>
            <td>{lab(h.lik_before, h.sev_before)}</td><td>{lab(h.lik_after, h.sev_after)}</td>
          </tr>))}</tbody></table>
      <p className="mini">Severity: {SEVERITIES.map((x) => `${x.id} ${x.label}`).join(" · ")} — Likelihood: {LIKELIHOODS.map((x) => `${x.id} ${x.label}`).join(" · ")}</p>

      <h2>Decision and sign-off</h2>
      <table className="kv sig"><tbody>
        <tr><td>Decision</td><td>{a.decision ? DECISIONS[a.decision] : "—"}{a.decision_comment ? ` — ${a.decision_comment}` : ""}</td></tr>
        <tr><td>Validated by (nominated person / SM)</td><td>{a.validated_at ? `${a.validated_name ?? ""}${a.validated_role ? " (" + a.validated_role + ")" : ""} — ${a.validated_at.slice(0, 10)} (electronic sign-off in S.A.M.)` : ""}</td></tr>
        <tr><td>Residual risk accepted</td><td>{a.accepted_at ? `Accountable Manager ${a.accepted_name ?? ""} — ${a.accepted_at.slice(0, 10)} (electronic sign-off in S.A.M.)` : a.status === "accepted" ? `By the sign-off above (residual risk not red) — the Accountable Manager keeps the final say (MSM)` : ""}</td></tr>
      </tbody></table>

      <h2>Conformity with the MSM</h2>
      <table><tbody>{checks.map((c, i) => <tr key={i}><td style={{ width: 22 }} className={c.ok ? "g" : "r"}>{c.ok ? "✓" : "✕"}</td><td>{c.label}{c.detail ? <span className="mini"> — {c.detail}</span> : null}</td><td style={{ width: "22%" }} className="mini">{c.ref}</td></tr>)}</tbody></table>
    </div>
  );
}
