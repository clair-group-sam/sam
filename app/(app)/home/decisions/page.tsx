import Link from "next/link";
import { frText } from "@/lib/dates";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { today } from "@/lib/authority";
import { entityDash } from "@/lib/dashboard";
import { KIND, myInbox, groupProjects } from "@/lib/inbox";
import DueBand, { dueWindow } from "@/components/DueBand";

export const maxDuration = 60;
const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
/** What only the Accountable Manager can do: sign, accept a risk, arbitrate an escalation. The rest of the Inbox is information or routine. */
const DECISION = ["signature", "risk_acceptance", "risk_intolerable", "escalation", "change_request", "finding_closure", "committee_minutes"];

/* HOME-01 · Home › Decisions for me: what waits for the Accountable Manager — to sign, to accept, to arbitrate — then the state of
 * each entity in a few figures, each a link. Nothing to type here: every line opens the page where the decision is taken. */
export default async function Decisions() {
  const s = await getSession(); if (!s) redirect("/login");
  const ents = s.entity === "ALL" ? ENTS4.filter((e) => s.group || s.entities.includes(e)) : [s.entity];
  const db = supabaseAdmin(); const t0 = today();
  const [inbox, dash, due, { data: ch }] = await Promise.all([
    myInbox(s), Promise.all(ents.map((e) => entityDash(db, e).catch(() => null))), dueWindow(db, ents),
    db.from("np_changes").select("id,entity,post_code,seat,from_name,to_name,effective_on,acceptance").in("entity", ents).eq("status", "open").order("effective_on"),
  ]);
  const lines = groupProjects(inbox, t0);
  const decide = lines.filter((t) => DECISION.includes(t.kind)); const other = lines.filter((t) => !DECISION.includes(t.kind));
  const late = decide.filter((t) => t.due && t.due < t0).length;
  const changes = (ch ?? []) as { id: string; entity: string; post_code: string; seat: string; from_name: string | null; to_name: string | null; effective_on: string | null; acceptance: string }[];
  const D = dash.filter((d): d is NonNullable<typeof d> => !!d);
  const escalated = D.reduce((n, d) => n + d.overdue.am, 0); const level1 = D.reduce((n, d) => n + d.findings.level1, 0);
  const first = s.name.split(" ")[0];
  const row = (t: (typeof lines)[number]) => (
    <tr key={t.id}><td style={{ width: 70 }}><span className={"ent " + t.entity}>{t.entity}</span></td><td style={{ width: 170 }}><span className={"kind " + (KIND[t.kind]?.[1] ?? "")}>{KIND[t.kind]?.[0] ?? t.kind.replace(/_/g, " ")}</span></td>
      <td className={"due" + (t.due && t.due < t0 ? " red" : "")} style={{ width: 110 }}>{fr(t.due)}{t.due && t.due < t0 && <small> late</small>}</td>
      <td>{t.ctx && <div className="ctx">{t.ctxLink ? <Link href={t.ctxLink}>{t.ctx}</Link> : t.ctx}</div>}{t.link ? <Link href={t.link} className="underline"><b>{frText(t.title)}</b></Link> : <b>{frText(t.title)}</b>}{t.detail && <div className="mini">{frText(t.detail)}</div>}</td></tr>);

  return (
    <>
      <PageHeader eyebrow="Home, Decisions for me" title={`Decisions for you, ${first}`} sub="What waits for the Accountable Manager: to sign, to accept, to arbitrate. Each line opens the page where the decision is taken."
        right={<><Link className="btn" href="/dash/codir">CODIR / SRB</Link><Link className="btn" href="/home/tasks">Inbox ({lines.length} line{lines.length === 1 ? "" : "s"}, {inbox.length} task{inbox.length === 1 ? "" : "s"})</Link></>} />
      {s.role !== "am" && <p className="mini mb-3">You are not the Accountable Manager of this entity: “To decide or sign” below is read from your own Inbox. What waits for the AM is counted on the CODIR / SRB page.</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Metric label="To decide or sign" value={decide.length} tone={late ? "red" : decide.length ? "amber" : "green"} hint={late ? `${late} past their date` : decide.length ? "waiting for you" : "nothing waiting"} />
        <Metric label="Escalated to you" value={escalated} tone={escalated ? "red" : "green"} hint={escalated ? "late items that reached the AM" : "no escalation"} />
        <Metric label="Level 1 findings open" value={level1} tone={level1 ? "red" : "green"} hint={level1 ? "across your entities" : "none"} />
        <Metric label="Changes of nominated persons" value={changes.length} tone={changes.length ? "amber" : "none"} hint={changes.length ? "in progress: Form 4 / Form 2 to sign" : "none in progress"} />
      </div>

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">To decide or sign</span><span className="mini">{decide.length}</span></div>
        <table className="tbl"><tbody>{decide.map(row)}{!decide.length && <tr><td className="p-5 text-slate6">Nothing waits for your decision.</td></tr>}</tbody></table>
      </section>

      {changes.length > 0 && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Changes of nominated persons in progress</span><Link className="mini underline" href="/np/changes">Changes &amp; approvals</Link></div>
          <table className="tbl"><tbody>{changes.map((c) => <tr key={c.id}><td style={{ width: 70 }}><span className={"ent " + c.entity}>{c.entity}</span></td><td className="mono" style={{ width: 150 }}>{c.post_code}{c.seat === "deputy" ? " (deputy)" : ""}</td><td>{c.from_name ?? "vacant"} → <b>{c.to_name ?? "vacant"}</b></td><td className="mono" style={{ width: 120 }}>{fr(c.effective_on)}</td><td style={{ width: 220 }}>{c.acceptance === "required" ? "acceptance by the authority" : "no acceptance required"}</td></tr>)}</tbody></table>
        </section>
      )}

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">State of {D.length > 1 ? "each entity" : "the entity"}</span><Link className="mini underline" href="/dash/cs">Compliance &amp; Safety dashboard</Link></div>
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Findings open</th><th>Findings late</th><th>CAA applications</th><th>Late with us</th><th>Overdue items</th><th>Reached the AM</th></tr></thead>
          <tbody>{D.map((d) => (
            <tr key={d.entity}><td><span className={"ent " + d.entity}>{d.entity}</span> {ENT[d.entity]?.name}</td>
              <td><Link className="underline" href={`/comp/find?entity=${d.entity}`}>{d.findings.open}</Link>{d.findings.level1 > 0 && <span className="pill red ml-1">{d.findings.level1} level 1</span>}</td>
              <td className={d.findings.late ? "red" : ""}>{d.findings.late}</td><td><Link className="underline" href="/proj/auth">{d.files.open}</Link></td><td className={d.files.lateOurs ? "red" : ""}>{d.files.lateOurs}</td>
              <td><Link className="underline" href="/dash/cs/overdue">{d.overdue.total}</Link></td><td className={d.overdue.am ? "red" : ""}>{d.overdue.am}</td></tr>))}</tbody>
        </table>
      </section>

      {due && <DueBand dues={due.dues} win={due.win} lanes={ents} />}

      {other.length > 0 && (
        <section className="card">
          <div className="ch"><span className="eyebrow">Also in your Inbox</span><span className="mini">{other.length}</span></div>
          <table className="tbl"><tbody>{other.slice(0, 12).map(row)}</tbody></table>
          {other.length > 12 && <div className="cb mini">{other.length - 12} more in the <Link className="underline" href="/home/tasks">Inbox</Link>.</div>}
        </section>
      )}
    </>
  );
}
