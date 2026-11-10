import Link from "next/link";
import { PageHeader, Metric } from "@/components/Page";
import { SurvTabs } from "@/components/SurvTabs";
import { ENT } from "@/lib/nav";
import { monthLong, type Audit } from "@/lib/audit-programme";
import { LEVEL_LABEL } from "@/lib/findings";
import { authorityStep, DECISION_LABEL, DECISION_TONE, effectiveDue, EXT_LABEL, type AuthFinding } from "@/lib/authority-audit";
import { today } from "@/lib/authority";
import { saveAuthorityAudit } from "../actions";

type AA = Audit & { report_received_on: string | null; report_files: string[]; closed_at: string | null };
const fileName = (u: string) => { try { return decodeURIComponent(u.split("/").pop() ?? u); } catch { return u.split("/").pop() ?? u; } };
const Dec = ({ v }: { v: string | null }) => v ? <span className={"pill " + (DECISION_TONE[v] ?? "")}>{DECISION_LABEL[v] ?? v}</span> : <span className="mini">—</span>;

/* 10/11 · the sheet of an authority audit: what the authority sent us and where each of its findings stands with it. No checklist, no internal report. */
export function AuthorityAudit({ a, findings, desk, name }: { a: AA; findings: AuthFinding[]; desk: boolean; name: (id: string | null) => string }) {
  const t0 = today();
  const open = findings.filter((f) => !["closed", "cancelled"].includes(f.status));
  const dues = open.map((f) => effectiveDue(f)).filter((d): d is string => !!d).sort();
  const late = dues.filter((d) => d < t0).length;
  const happened = !!a.done_on || (a.planned_end ?? a.planned_on ?? a.planned_month) <= t0;
  const stage = a.status === "cancelled" ? ["Cancelled", ""] : !happened ? ["Announced", "amber"] : open.length ? ["Findings to answer", late ? "red" : "amber"] : findings.length || a.status === "closed" ? ["Closed", "green"] : ["Report awaited", ""];
  const byLevel = (l: string) => findings.filter((f) => f.level === l).length;
  return (
    <>
      <PageHeader eyebrow={`Compliance, Surveillance plan, authority audit, ${a.entity}`} title={`${a.number}, ${a.title}`}
        sub={`${ENT[a.entity]?.name ?? a.entity}, ${a.authority ?? "authority"}${a.external_auditor && a.external_auditor !== a.authority ? ` (${a.external_auditor})` : ""}, ${a.planned_on ? `on ${a.planned_on}${a.planned_end && a.planned_end !== a.planned_on ? ` → ${a.planned_end}` : ""}` : monthLong(a.planned_month)}`}
        tag={<span className={"pill " + stage[1]}>{stage[0]}</span>}
        right={<Link className="btn" href="/comp/audits?src=authority">All authority audits</Link>} />
      <SurvTabs on="audits" />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Report received" value={a.report_received_on ?? "—"} hint={a.report_files.length ? `${a.report_files.length} file${a.report_files.length > 1 ? "s" : ""}` : "no file yet"} tone={happened && !a.report_received_on ? "amber" : undefined} />
        <Metric label="Findings" value={findings.length} hint={[byLevel("1") && `${byLevel("1")} level 1`, byLevel("2") && `${byLevel("2")} level 2`, byLevel("obs") && `${byLevel("obs")} observation${byLevel("obs") > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "none"} />
        <Metric label="Open" value={open.length} hint={open.length ? `${open.filter((f) => authorityStep(f).label === "Answer to send").length} answer to send, ${open.filter((f) => authorityStep(f).label.startsWith("Sent")).length} awaiting the authority` : "all closed"} tone={open.length ? "amber" : findings.length ? "green" : undefined} />
        <Metric label="Next deadline" value={dues[0] ?? "—"} hint={late ? `${late} past due` : dues.length ? "earliest of the open findings, extension included" : ""} tone={late ? "red" : dues[0] ? "amber" : undefined} />
      </div>

      <section className="card mb-4"><div className="ch"><span className="eyebrow">Findings notified by the authority, {findings.length}</span><span className="mini">answer deadline includes the extension granted</span></div>
        <div className="cb" style={{ padding: 0 }}>{!findings.length ? <p className="p-4 mini">{happened ? "No finding recorded. When the report arrives, raise each finding (Findings › + Raise a finding, source Authority, this audit's reference)." : "The audit has not taken place yet."}</p> : (
          <table className="tbl"><thead><tr><th>Ref.</th><th>Finding</th><th>Level</th><th>Owner</th><th>Deadline</th><th>Root cause</th><th>Plan</th><th>Proof</th><th>Where it stands</th></tr></thead><tbody>{findings.map((f) => {
            const d = effectiveDue(f); const st = authorityStep(f); const lateF = !!d && d < t0 && !["closed", "cancelled"].includes(f.status);
            return <tr key={f.id} className="rowlink">
              <td className="mono mini">{f.authority_ref ?? "—"}</td>
              <td><Link className="stretch" href={`/comp/find/${f.id}`}><b className="mono">{f.number}</b> {f.title}</Link>{f.requirement && <div className="mini mono">{f.requirement.slice(0, 90)}{f.requirement.length > 90 ? "…" : ""}</div>}</td>
              <td>{LEVEL_LABEL[f.level] ?? f.level}</td>
              <td className="mini">{f.owner_person ? name(f.owner_person) : f.owner_role ?? "—"}</td>
              <td className={lateF ? "late" : ""}>{d ?? "—"}{f.extension && <div className="mini">{EXT_LABEL[f.extension]}</div>}</td>
              <td><Dec v={f.authority_rca} /></td><td><Dec v={f.authority_pac} /></td><td><Dec v={f.authority_proof} /></td>
              <td><span className={"pill " + st.tone}>{st.label}</span>{f.closed_at && f.status === "closed" && <div className="mini">{f.closed_at.slice(0, 10)}</div>}</td></tr>; })}</tbody></table>)}
        </div></section>

      <div className="grid grid-cols-2 gap-4">
        <section className="card"><div className="ch"><span className="eyebrow">Report of the authority</span></div><div className="cb grid gap-2">
          {a.report_files.length ? a.report_files.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{fileName(u)} ↗</a>) : <p className="mini">No report attached yet.</p>}
          <p className="mini">{a.report_received_on ? `Received ${a.report_received_on}.` : ""}{a.closed_at ? ` Closed ${a.closed_at.slice(0, 10)}.` : ""}</p>
          {desk && <details><summary className="mini">Record the report</summary><form action={saveAuthorityAudit} className="grid gap-2 mt-2"><input type="hidden" name="id" value={a.id} />
            <label><span className="mini">Report received on (findings notified)</span><input type="date" name="report_received_on" className="inp" defaultValue={a.report_received_on ?? ""} /></label>
            <label><span className="mini">Link to the report (METEOR, SharePoint…), one per line</span><textarea name="report_files" className="inp mono" rows={2} defaultValue={a.report_files.join("\n")} /></label>
            <label><span className="mini">Closed by the authority on</span><input type="date" name="closed_on" className="inp" defaultValue={a.closed_at?.slice(0, 10) ?? ""} /></label>
            <div className="flex justify-end"><button className="btn sm primary">Save</button></div></form></details>}
        </div></section>
        <section className="card"><div className="ch"><span className="eyebrow">What the authority decides, per finding</span></div><div className="cb mini grid gap-1">
          <p><b>Root cause</b> and <b>plan</b>: sent by us (METEOR / TM-CAD), then accepted or refused by the authority.</p>
          <p><b>Proof</b>: once the plan is done, the evidence of implementation; the authority accepts it and closes the finding.</p>
          <p><b>Deadline</b>: date given by the authority, plus any extension it granted (1 or 3 months).</p>
        </div></section>
      </div>
    </>
  );
}
