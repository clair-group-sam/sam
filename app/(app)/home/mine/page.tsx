import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { today } from "@/lib/authority";
import { KIND, myInbox } from "@/lib/inbox";

const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
const READ = ["reading", "communication", "promo_read"];

/* HOME-03 · Home › My space (pilots, instructors, staff): what I have to read, what else waits for me, my safety reports and their
 * feedback, and the three things I come for — report, read the manuals, find the emergency contacts. */
export default async function MySpace() {
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin(); const t0 = today();
  const [inbox, { data: rp }] = await Promise.all([
    myInbox(s),
    s.person ? db.from("reports").select("id,entity,headline,received_at,status,feedback,feedback_sent_at").eq("reporter_person", s.person.id).order("received_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const toRead = inbox.filter((t) => READ.includes(t.kind)); const other = inbox.filter((t) => !READ.includes(t.kind));
  const reports = (rp ?? []) as { id: string; entity: string; headline: string | null; received_at: string | null; status: string; feedback: string | null; feedback_sent_at: string | null }[];
  const openReports = reports.filter((r) => !["closed", "cancelled"].includes(r.status)); const withFeedback = reports.filter((r) => r.feedback_sent_at);
  const lateRead = toRead.filter((t) => t.due && t.due < t0).length;
  const first = s.name.split(" ")[0];
  const row = (t: (typeof inbox)[number]) => (
    <tr key={t.id}><td style={{ width: 170 }}><span className={"kind " + (KIND[t.kind]?.[1] ?? "")}>{KIND[t.kind]?.[0] ?? t.kind.replace(/_/g, " ")}</span></td>
      <td className={"due" + (t.due && t.due < t0 ? " red" : "")} style={{ width: 110 }}>{fr(t.due)}{t.due && t.due < t0 && <small> late</small>}</td>
      <td>{t.link ? <Link href={t.link} className="underline"><b>{t.title}</b></Link> : <b>{t.title}</b>}{t.detail && <div className="mini">{t.detail}</div>}</td></tr>);

  return (
    <>
      <PageHeader eyebrow="Home, My space" title={`Hello ${first}`} sub={`${s.entity !== "ALL" ? (ENT[s.entity]?.name ?? s.entity) + ". " : ""}What you have to read, your safety reports, and the shortcuts you need.`}
        right={<Link className="btn primary" href="/safe/new">+ Safety report</Link>} />
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Metric label="To read and acknowledge" value={toRead.length} tone={lateRead ? "red" : toRead.length ? "amber" : "green"} hint={lateRead ? `${lateRead} past their date` : toRead.length ? "manual revisions, communications, safety promotion" : "you are up to date"} />
        <Metric label="My reports in progress" value={openReports.length} tone={openReports.length ? "info" : "none"} hint={`${reports.length} sent in all`} />
        <Metric label="Feedback received" value={withFeedback.length} tone={withFeedback.length ? "green" : "none"} hint="answers to your reports" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Link className="card cb" href="/safe/new"><b>Report</b><div className="mini">an occurrence, a hazard, fatigue: a few lines are enough</div></Link>
        <Link className="card cb" href="/docs/lib"><b>Read the manuals</b><div className="mini">the published revisions, with search</div></Link>
        <Link className="card cb" href="/comm/camp"><b>Messages</b><div className="mini">communications and safety promotion</div></Link>
        <Link className="card cb" href="/erp/contacts"><b>Emergency</b><div className="mini">crisis directory and emergency plans</div></Link>
      </div>

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">To read and acknowledge</span><span className="mini">{toRead.length}</span></div>
        <table className="tbl"><tbody>{toRead.map(row)}{!toRead.length && <tr><td className="p-5 text-slate6">Nothing to read: you are up to date.</td></tr>}</tbody></table>
      </section>

      {other.length > 0 && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Also waiting for you</span><span className="mini">{other.length}</span></div>
          <table className="tbl"><tbody>{other.slice(0, 15).map(row)}</tbody></table>
        </section>
      )}

      <section className="card">
        <div className="ch"><span className="eyebrow">My safety reports</span><Link className="mini underline" href="/safe/mine">all my reports</Link></div>
        <table className="tbl"><tbody>
          {reports.slice(0, 8).map((r) => <tr key={r.id}><td className="mono" style={{ width: 110 }}>{fr(r.received_at?.slice(0, 10) ?? null)}</td><td><Link className="underline" href="/safe/mine"><b>{r.headline ?? "Report"}</b></Link>{r.feedback_sent_at && r.feedback && <div className="mini">Feedback: {r.feedback.slice(0, 220)}{r.feedback.length > 220 ? "…" : ""}</div>}</td>
            <td style={{ width: 200 }}><span className={"pill " + (r.feedback_sent_at ? "green" : "")}>{r.feedback_sent_at ? "feedback received" : r.status.replace(/_/g, " ")}</span></td></tr>)}
          {!reports.length && <tr><td className="p-5 text-slate6">You have not sent a report yet.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
