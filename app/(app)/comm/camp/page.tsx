import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { describeTokens } from "@/lib/audience";
import { acknowledgeComm, archiveComm, markRead, mayWriteComm } from "../actions";

type Com = { id: string; entity: string; title: string; body: string; kind: string; audience: string[]; require_ack: boolean; due: string | null; status: string; created_at: string; sent_at: string | null; recipients: number; emailed: number; email_status: string | null; created_by: string | null; sent_by: string | null };
type Rec = { communication_id: string; person_id: string; read_at: string | null; acknowledged_at: string | null };
const KIND_TONE: Record<string, string> = { information: "", instruction: "amber", safety: "green", urgent: "red" };
const fr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

/* COM · Communications: what was sent in the working entity (office) or to me (staff, crew), and one message opened. */
export default async function Communications({ searchParams }: { searchParams: Promise<{ c?: string; f?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const db = supabaseAdmin();
  const office = await mayWriteComm(s);
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const me = s.person?.id ?? "";
  const { data: myRecs } = await db.from("communication_recipients").select("communication_id,person_id,read_at,acknowledged_at").eq("person_id", me);
  const mine = new Map(((myRecs ?? []) as Rec[]).map((r) => [r.communication_id, r]));
  let q = db.from("communications").select("*").neq("status", "archived").order("created_at", { ascending: false }).limit(300);
  if (scope) q = q.in("entity", scope);
  const { data } = await q;
  let list = (data ?? []) as Com[];
  if (!office) list = list.filter((c) => c.status === "sent" && mine.has(c.id));
  const ids = list.filter((c) => c.status === "sent").map((c) => c.id);
  const { data: recs } = ids.length ? await db.from("communication_recipients").select("communication_id,person_id,read_at,acknowledged_at").in("communication_id", ids) : { data: [] };
  const stats = new Map<string, { n: number; ack: number; read: number }>();
  for (const r of (recs ?? []) as Rec[]) { const x = stats.get(r.communication_id) ?? { n: 0, ack: 0, read: 0 }; x.n++; if (r.acknowledged_at) x.ack++; if (r.read_at) x.read++; stats.set(r.communication_id, x); }
  const f = sp.f ?? "all";
  const shown = list.filter((c) => f === "all" || (f === "drafts" ? c.status === "draft" : f === "todo" ? (mine.get(c.id) && !mine.get(c.id)!.acknowledged_at && c.require_ack) : true));
  const open = sp.c ? list.find((c) => c.id === sp.c) ?? null : null;
  if (open && me && mine.has(open.id) && !mine.get(open.id)!.read_at) await markRead(open.id, me);
  const { data: ppl } = await db.from("people").select("id,display_name");
  const names = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const todo = list.filter((c) => mine.get(c.id) && !mine.get(c.id)!.acknowledged_at && c.require_ack).length;
  const st = open ? stats.get(open.id) : null;
  return (
    <>
      <PageHeader eyebrow="Communication, Communications" title="Communications" sub={office ? "Messages to the staff of an entity, by post or by name: Inbox item, Teams card and e-mail, acknowledged one by one." : "Messages sent to you. Acknowledge the ones that ask for it."}
        right={office ? <Link className="btn primary" href="/comm/new">+ New communication</Link> : undefined} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="To acknowledge (me)" value={todo} tone={todo ? "amber" : "green"} hint={todo ? "messages waiting for you" : "nothing waiting"} />
        <Metric label={office ? "Sent" : "Received"} value={list.filter((c) => c.status === "sent").length} hint="in the working entity" />
        <Metric label="Drafts" value={list.filter((c) => c.status === "draft").length} hint={office ? "not sent yet" : "office only"} />
      </div>
      {open && (
        <section className="card mb-4" id="msg">
          <div className="ch"><span><span className={"pill " + (KIND_TONE[open.kind] ?? "")}>{open.kind}</span> <b>{open.title}</b></span>
            <span className="mini">{open.status === "draft" ? "Draft" : `Sent ${fr(open.sent_at)} by ${names.get(open.sent_by ?? "") ?? "S.A.M."}`}</span></div>
          <div className="cb grid gap-3">
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, maxWidth: "72ch" }}>{open.body}</div>
            <p className="mini">To {describeTokens(open.audience, ENT[open.entity]?.name ?? open.entity, names)}{open.require_ack && open.due ? `. Acknowledge by ${fr(open.due)}` : ""}.</p>
            <div className="flex gap-2 flex-wrap items-center">
              {mine.get(open.id) && open.require_ack && !mine.get(open.id)!.acknowledged_at && <form action={acknowledgeComm}><input type="hidden" name="id" value={open.id} /><button className="btn primary" type="submit">I have read and understood</button></form>}
              {mine.get(open.id)?.acknowledged_at && <span className="pill green">Acknowledged on {fr(mine.get(open.id)!.acknowledged_at)}</span>}
              {office && open.status === "draft" && <Link className="btn primary" href={`/comm/new?id=${open.id}`}>Edit and send</Link>}
              {office && st && <Link className="btn" href={`/comm/track?c=${open.id}`}>Read tracking: {st.ack} of {st.n} acknowledged</Link>}
              {office && <form action={archiveComm}><input type="hidden" name="id" value={open.id} /><button className="btn" type="submit">{open.status === "draft" ? "Delete the draft" : "Archive"}</button></form>}
            </div>
          </div>
        </section>
      )}
      <div className="seg mb-3">{[["all", "All"], ["todo", "To acknowledge"], ...(office ? [["drafts", "Drafts"]] : [])].map(([k, l]) => <Link key={k} href={`/comm/camp?f=${k}`} className={f === k ? "on" : ""}>{l}</Link>)}</div>
      <section className="card"><div className="cb" style={{ padding: 0 }}>
        {!shown.length ? <p className="p-4 mini">{office ? "No communication yet. Create the first one with New communication." : "No message for you here."}</p> : (
          <table className="tbl"><thead><tr><th className="entcol">Entity</th><th>Message</th><th>Kind</th><th>Sent</th><th>{office ? "Acknowledged" : "Me"}</th></tr></thead><tbody>
            {shown.map((c) => { const x = stats.get(c.id); const m = mine.get(c.id); return (
              <tr key={c.id} className={open?.id === c.id ? "on" : ""}>
                <td className="entcol"><span className={"ent " + c.entity}>{c.entity}</span></td>
                <td><Link href={`/comm/camp?c=${c.id}#msg`}><b>{c.title}</b></Link><div className="mini">{describeTokens(c.audience, ENT[c.entity]?.name ?? c.entity, names)}</div></td>
                <td><span className={"pill " + (KIND_TONE[c.kind] ?? "")}>{c.kind}</span></td>
                <td className="due">{c.status === "draft" ? <span className="pill">Draft</span> : fr(c.sent_at)}</td>
                <td className="mini">{office ? (x ? `${x.ack} / ${x.n}` : "") : m?.acknowledged_at ? "Acknowledged" : c.require_ack ? <b className="red">To acknowledge</b> : m?.read_at ? "Read" : "New"}</td>
              </tr>); })}
          </tbody></table>)}
      </div></section>
    </>
  );
}
