import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import PrintAuto from "@/components/PrintAuto";
import { KIND_LABEL, monthLong, STATUS_LABEL, type Audit } from "@/lib/audit-programme";
import { breakdown, RESULT_LABEL, type Check } from "@/lib/audit-run";
import { LEVEL_LABEL } from "@/lib/findings";

export const dynamic = "force-dynamic";
const CSS = `
@page { size: A4; margin: 16mm 14mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9px Inter, Arial; color: #6b7a8c } }
body{background:#fff}
.mn{font:11px/1.5 Inter, Arial, sans-serif;color:#0d2a3f}
.mn h1{font-size:18px;margin:0 0 2px}.mn h2{font-size:12.5px;margin:14px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #0d2a3f;text-transform:uppercase;letter-spacing:.06em}
.mn table{width:100%;border-collapse:collapse;margin:4px 0}.mn th,.mn td{border:1px solid #c9d3dc;padding:4px 6px;vertical-align:top;text-align:left}.mn th{background:#eef3f7;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.mn .kv td:first-child{width:28%;color:#44546a;background:#f8fafb}.mn .pre{white-space:pre-wrap}.mn .mini{font-size:9.5px;color:#6b7a8c}.mn .sig td{height:44px}
.mn .r-conforming{color:#1d7a3a}.mn .r-partial{color:#8a5a00}.mn .r-non_conforming{color:#c40510;font-weight:700}.mn .sec{background:#f8fafb;font-weight:700}
`;
type A = Audit & { checklist_id: string | null; started_on: string | null; report_summary: string | null; report_at: string | null; closed_at: string | null; closed_by: string | null; imported_from: string | null };
/** Printable audit report (PRO-CM-02): header, result summary, the checks by section with results and comments, the findings, sign-off. */
export default async function PrintAudit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string; all?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("audits").select("*").eq("id", id).maybeSingle();
  const a = data as A | null; if (!a || (!s.group && !s.entities.includes(a.entity))) notFound();
  const [{ data: cd }, { data: fd }, { data: ppl }] = await Promise.all([
    db.from("audit_checks").select("*").eq("audit_id", a.id).order("ord").limit(5000),
    db.from("findings").select("number,title,level,status,requirement,owner_role,due").eq("audit_id", a.id).order("number"),
    db.from("people").select("id,display_name").limit(800),
  ]);
  const checks = (cd ?? []) as Check[]; const b = breakdown(checks);
  const name = (pid: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === pid)?.display_name ?? "—";
  const shown = sp.all === "1" ? checks : checks.filter((c) => c.result && c.result !== "not_applicable");
  const sections = [...new Set(shown.map((c) => c.section ?? "Checks"))];
  const F = (fd ?? []) as { number: string; title: string; level: string; status: string; requirement: string | null; owner_role: string | null; due: string | null }[];
  return (
    <div className="mn" style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
      <style>{CSS}</style>
      <PrintAuto fileName={`${a.number} audit report`} auto={sp.auto === "1"} />
      <div><b>{ENT[a.entity]?.name ?? a.entity}</b> · <span className="mini">Compliance monitoring — audit report (PRO-CM-02){a.imported_from ? ` · ${a.imported_from}` : ""}</span></div>
      <h1>{a.number} — {a.title}</h1>
      <div className="mini">{KIND_LABEL[a.kind]}{a.domain ? ` · ${a.domain}` : ""} · {STATUS_LABEL[a.status]}{a.closed_at ? ` ${a.closed_at.slice(0, 10)}` : a.status !== "closed" ? " — NOT CLOSED" : ""}</div>
      <table className="kv"><tbody>
        <tr><td>Planned · performed</td><td>{monthLong(a.planned_month)} · {a.planned_on ?? a.started_on ?? "—"}{a.planned_end ? ` → ${a.planned_end}` : ""}{a.done_on ? ` · completed ${a.done_on}` : ""}</td></tr>
        <tr><td>Lead auditor · team</td><td>{a.lead_auditor ? name(a.lead_auditor) : a.external_auditor ?? "—"}{a.auditors.length ? ` · ${a.auditors.map(name).join(", ")}` : ""}{a.lead_auditor && a.external_auditor ? ` · ${a.external_auditor}` : ""}</td></tr>
        {a.subcontractor && <tr><td>Subcontractor</td><td>{a.subcontractor}</td></tr>}{a.authority && <tr><td>Authority</td><td>{a.authority}</td></tr>}
        <tr><td>Scope</td><td>{a.scope ?? "—"}</td></tr>
        <tr><td>Results</td><td>{b.done} / {b.total} checks · {b.conforming} conforming · {b.partial} partially · {b.non_conforming} not conforming · {b.not_applicable} N/A · {b.not_covered} not covered</td></tr>
      </tbody></table>
      {a.report_summary && <><h2>Conclusion</h2><div className="pre">{a.report_summary}</div></>}
      <h2>Findings · {F.length}</h2>
      {F.length ? <table><thead><tr><th style={{ width: 130 }}>Finding</th><th>Title</th><th style={{ width: 90 }}>Level</th><th style={{ width: 110 }}>Requirement</th><th style={{ width: 70 }}>Answers</th><th style={{ width: 80 }}>Due</th></tr></thead><tbody>{F.map((f) => <tr key={f.number}><td>{f.number}</td><td>{f.title}</td><td>{LEVEL_LABEL[f.level] ?? f.level}</td><td>{f.requirement ?? "—"}</td><td>{f.owner_role ?? "—"}</td><td>{f.due ?? "—"}</td></tr>)}</tbody></table> : <div className="mini">No finding raised in this audit.</div>}
      <h2>Checks{sp.all === "1" ? "" : " (N/A omitted)"}</h2>
      <table><thead><tr><th style={{ width: 120 }}>Rule</th><th>Observation</th><th style={{ width: 110 }}>Result</th></tr></thead><tbody>
        {sections.map((sec) => [<tr key={sec}><td colSpan={3} className="sec">{sec}</td></tr>, ...shown.filter((c) => (c.section ?? "Checks") === sec).map((c) => <tr key={c.id}><td>{c.code}{c.ref ? ` ${c.ref}` : ""}</td><td>{c.question && <div><i>{c.question}</i></div>}{c.comment ?? ""}{c.evidence.length ? <div className="mini">Evidence: {c.evidence.map((e) => e.name).join(", ")}</div> : null}</td><td className={`r-${c.result ?? ""}`}>{c.result ? RESULT_LABEL[c.result] : "—"}</td></tr>)])}
      </tbody></table>
      <h2>Sign-off</h2>
      <table className="sig"><tbody><tr><td style={{ width: "50%" }}><span className="mini">Lead auditor</span></td><td><span className="mini">Compliance Monitoring Manager</span></td></tr></tbody></table>
      <div className="mini" style={{ marginTop: 8 }}>Generated by S.A.M. on {new Date().toISOString().slice(0, 10)} · results given by the auditors; the official texts in the version shown at audit time.</div>
    </div>
  );
}
