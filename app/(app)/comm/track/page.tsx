import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { mayWriteComm } from "../actions";

type Com = { id: string; entity: string; title: string; sent_at: string | null; due: string | null; require_ack: boolean };
type Rec = { communication_id: string; person_id: string; delivered_at: string; read_at: string | null; acknowledged_at: string | null };
const fr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

/* COM · Read tracking: for each communication sent, who acknowledged, who read without acknowledging, who has not opened it. */
export default async function ReadTracking({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  if (!(await mayWriteComm(s))) redirect("/comm/camp");
  const sp = await searchParams;
  const db = supabaseAdmin();
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  let q = db.from("communications").select("id,entity,title,sent_at,due,require_ack").eq("status", "sent").order("sent_at", { ascending: false }).limit(200);
  if (scope) q = q.in("entity", scope);
  const { data } = await q; const coms = (data ?? []) as Com[];
  const ids = coms.map((c) => c.id);
  const { data: rd } = ids.length ? await db.from("communication_recipients").select("*").in("communication_id", ids) : { data: [] };
  const recs = (rd ?? []) as Rec[];
  const { data: ppl } = await db.from("people").select("id,display_name,job_title");
  const P = new Map(((ppl ?? []) as { id: string; display_name: string; job_title: string | null }[]).map((p) => [p.id, p]));
  const t0 = new Date().toISOString().slice(0, 10);
  const by = (id: string) => recs.filter((r) => r.communication_id === id);
  const open = coms.find((c) => c.id === sp.c) ?? null;
  const late = coms.reduce((n, c) => n + (c.require_ack && c.due && c.due < t0 ? by(c.id).filter((r) => !r.acknowledged_at).length : 0), 0);
  const total = recs.length, ack = recs.filter((r) => r.acknowledged_at).length;
  return (
    <>
      <PageHeader eyebrow="Communication, Read tracking" title="Read tracking" sub="Who acknowledged each communication. Late acknowledgements follow the relance and escalation ladder of the Inbox." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Acknowledged" value={total ? `${Math.round((ack / total) * 100)} %` : "0"} hint={`${ack} of ${total} deliveries`} tone={total && ack === total ? "green" : undefined} />
        <Metric label="Late" value={late} tone={late ? "red" : "green"} hint={late ? "past the acknowledgement date" : "nobody late"} />
        <Metric label="Communications" value={coms.length} hint="sent in the working entity" />
      </div>
      <section className="card mb-4"><div className="cb" style={{ padding: 0 }}>
        {!coms.length ? <p className="p-4 mini">Nothing sent yet.</p> : <table className="tbl"><thead><tr><th>Communication</th><th>Sent</th><th>Due</th><th>Acknowledged</th><th>Read only</th><th>Not opened</th></tr></thead><tbody>
          {coms.map((c) => { const r = by(c.id); const a = r.filter((x) => x.acknowledged_at).length, ro = r.filter((x) => x.read_at && !x.acknowledged_at).length; const lateRow = c.require_ack && c.due && c.due < t0 && a < r.length; return (
            <tr key={c.id} className={open?.id === c.id ? "on" : ""}><td><Link href={`/comm/track?c=${c.id}#who`}><b>{c.title}</b></Link></td><td className="due">{fr(c.sent_at)}</td><td className={"due" + (lateRow ? " red" : "")}>{c.require_ack ? fr(c.due) : "no acknowledgement"}{lateRow && <small> late</small>}</td>
              <td>{a} / {r.length}</td><td className="mini">{ro}</td><td className="mini">{r.length - a - ro}</td></tr>); })}
        </tbody></table>}
      </div></section>
      {open && <section className="card" id="who"><div className="ch"><span className="eyebrow">{open.title}</span><Link className="mini" href={`/comm/camp?c=${open.id}`}>Open the message</Link></div>
        <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>Person</th><th>Delivered</th><th>Read</th><th>Acknowledged</th></tr></thead><tbody>
          {by(open.id).sort((a, b) => (a.acknowledged_at ? 1 : 0) - (b.acknowledged_at ? 1 : 0)).map((r) => <tr key={r.person_id}><td><b>{P.get(r.person_id)?.display_name ?? "?"}</b><div className="mini">{P.get(r.person_id)?.job_title ?? ""}</div></td><td className="due">{fr(r.delivered_at)}</td><td className="due">{fr(r.read_at)}</td><td>{r.acknowledged_at ? <span className="pill green">{fr(r.acknowledged_at)}</span> : <span className="pill amber">waiting</span>}</td></tr>)}
        </tbody></table></div></section>}
    </>
  );
}
