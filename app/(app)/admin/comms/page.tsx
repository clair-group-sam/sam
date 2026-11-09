import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { fr, hm, registersSession, scopeOf } from "../guard";

type Item = { at: string; entity: string; what: string; title: string; to: string; channel: string; link?: string };

/* Registers · Communications register: everything S.A.M. sent (manual update notices, communications, Teams cards), newest first. */
export default async function CommunicationsRegister({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const s = await registersSession(); const sp = await searchParams;
  const db = supabaseAdmin(); const scope = scopeOf(s);
  let n = db.from("manual_notices").select("sent_at,entity,subject,recipients,emailed,email_status,manual_id").order("sent_at", { ascending: false }).limit(300);
  let c = db.from("communications").select("id,sent_at,entity,title,recipients,emailed,email_status").eq("status", "sent").order("sent_at", { ascending: false }).limit(300);
  if (scope) { n = n.in("entity", scope); c = c.in("entity", scope); }
  const [{ data: nd }, { data: cd }, { data: td }] = await Promise.all([n, c,
    db.from("teams_cards").select("sent_at,card_kind,tasks(entity,title,kind)").order("sent_at", { ascending: false }).limit(400)]);
  const items: Item[] = [
    ...((nd ?? []) as { sent_at: string; entity: string; subject: string | null; recipients: number; emailed: number; email_status: string | null; manual_id: string }[]).map((x) => ({ at: x.sent_at, entity: x.entity, what: "Manual update", title: x.subject ?? "", to: `${x.recipients} readers`, channel: `Inbox, e-mail ${x.email_status ?? ""} (${x.emailed})`, link: `/docs/manual/${x.manual_id}?tab=readers` })),
    ...((cd ?? []) as { id: string; sent_at: string; entity: string; title: string; recipients: number; emailed: number; email_status: string | null }[]).map((x) => ({ at: x.sent_at, entity: x.entity, what: "Communication", title: x.title, to: `${x.recipients} people`, channel: `Inbox, Teams, e-mail ${x.email_status ?? ""} (${x.emailed})`, link: `/comm/track?c=${x.id}` })),
    ...((td ?? []) as unknown as { sent_at: string; card_kind: string; tasks: { entity: string; title: string; kind: string } | null }[])
      .filter((x) => x.tasks && (!scope || scope.includes(x.tasks.entity))).map((x) => ({ at: x.sent_at, entity: x.tasks!.entity, what: "Teams card", title: x.tasks!.title, to: "1 person", channel: `Teams (${x.card_kind})` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const k = sp.k ?? "all";
  const shown = items.filter((i) => k === "all" || i.what === k).slice(0, 500);
  const count = (w: string) => items.filter((i) => i.what === w).length;
  return (
    <>
      <PageHeader eyebrow="Registers, Communications register" title="Communications register" sub="What S.A.M. sent and to how many people: manual update notices, communications and personal Teams cards. Read tracking keeps the person-by-person detail." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Manual update notices" value={count("Manual update")} />
        <Metric label="Communications" value={count("Communication")} />
        <Metric label="Teams cards" value={count("Teams card")} hint="last 400" />
      </div>
      <div className="seg mb-3">{[["all", "All"], ["Manual update", "Manual updates"], ["Communication", "Communications"], ["Teams card", "Teams cards"]].map(([v, l]) => <Link key={v} href={`/admin/comms?k=${encodeURIComponent(v)}`} className={k === v ? "on" : ""}>{l}</Link>)}</div>
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!shown.length ? <p className="p-4 mini">Nothing sent in this scope yet.</p> : (
        <table className="tbl"><thead><tr><th>Sent</th><th className="entcol">Entity</th><th>What</th><th>Subject</th><th>To</th><th>Channels</th></tr></thead><tbody>
          {shown.map((i, x) => <tr key={x}><td className="due">{fr(i.at)} <span className="mini">{hm(i.at)}</span></td><td className="entcol"><span className={"ent " + i.entity}>{i.entity}</span></td><td>{i.what}</td>
            <td>{i.link ? <Link href={i.link}><b>{i.title}</b></Link> : <b>{i.title}</b>}</td><td className="mini">{i.to}</td><td className="mini">{i.channel}</td></tr>)}
        </tbody></table>)}</div></section>
    </>
  );
}
