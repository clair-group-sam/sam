import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { INV_LEVEL, INV_STATUS, invLate, mayOpen, mayRead, type Investigation } from "@/lib/investigations";
import { openInvestigation } from "./actions";

/** Safety › Investigations (SAF-08): internal safety investigations opened on reports — lead, due date, step, recommendations. */
export default async function Investigations({ searchParams }: { searchParams: Promise<{ st?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const { data } = await db.from("investigations").select("*").in("entity", scope).order("created_at", { ascending: false }).limit(300);
  const all = ((data ?? []) as Investigation[]).filter((i) => mayRead(s, i));
  const { data: acts } = all.length ? await db.from("safety_actions").select("investigation_id,status").in("investigation_id", all.map((i) => i.id)) : { data: [] };
  const nAct = (id: string) => ((acts ?? []) as { investigation_id: string; status: string }[]).filter((a) => a.investigation_id === id);
  const open = all.filter((i) => !["closed", "cancelled"].includes(i.status));
  const rows = sp.st === "closed" ? all.filter((i) => i.status === "closed") : sp.st === "all" ? all : open;
  const desk = mayOpen(s) && s.entity !== "ALL";
  const { data: reps } = desk ? await db.from("reports").select("id,headline,received_at").eq("entity", s.entity).neq("status", "closed").order("received_at", { ascending: false }).limit(60) : { data: [] };
  const { data: ppl } = desk ? await db.from("people").select("id,display_name").contains("entities", [s.entity]).order("display_name").limit(400) : { data: [] };
  const tab = (k: string, l: string) => <Link key={k} href={k ? `/safe/inv?st=${k}` : "/safe/inv"} className={"btn" + ((sp.st ?? "") === k ? " on" : "")}>{l}</Link>;
  return (
    <>
      <PageHeader eyebrow="Safety · Safety assurance" title="Investigations" sub="Internal safety investigation of a report: scope, facts and timeline, analysis of the contributing factors, causes, conclusions and safety recommendations — just culture, no blame." right={<>{tab("", "Open")}{tab("closed", "Closed")}{tab("all", "All")}</>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open" value={open.length} />
        <Metric label="Overdue" value={open.filter((i) => invLate(i)).length} tone={open.some((i) => invLate(i)) ? "red" : undefined} />
        <Metric label="Closed this year" value={all.filter((i) => i.status === "closed" && (i.closed_at ?? "").startsWith(new Date().getUTCFullYear().toString())).length} />
        <Metric label="Recommendations open" value={open.reduce((n, i) => n + nAct(i.id).filter((a) => ["open", "in_progress"].includes(a.status)).length, 0)} hint="safety actions" />
      </div>
      <section className="card mb-5">
        <table className="tbl"><thead><tr><th style={{ width: 160 }}>Number</th><th>Investigation</th><th style={{ width: 150 }}>Lead</th><th style={{ width: 100 }}>Due</th><th style={{ width: 90 }}>Actions</th><th style={{ width: 150 }}>Step</th></tr></thead>
          <tbody>{rows.map((i) => (
            <tr key={i.id}>
              <td className="mono"><Link className="underline" href={`/safe/inv/${i.id}`}>{i.number}</Link>{scope.length > 1 && <div><span className={"ent " + i.entity}>{i.entity}</span></div>}</td>
              <td><Link href={`/safe/inv/${i.id}`}><b>{i.title}</b></Link><div className="mini">{INV_LEVEL[i.level]?.[0]}{i.report_id ? ` · report ${i.report_id}` : ""}</div></td>
              <td className="mini">{i.lead_name ?? "—"}</td>
              <td className={"mono" + (invLate(i) ? " text-red-700" : "")}>{i.due ?? "—"}</td>
              <td className="mini">{nAct(i.id).length || "—"}</td>
              <td><span className={"pill " + (invLate(i) ? "red" : INV_STATUS[i.status]?.[1] ?? "")}>{invLate(i) ? "Overdue" : INV_STATUS[i.status]?.[0]}</span></td>
            </tr>))}
            {!rows.length && <tr><td colSpan={6} className="p-5 mini">{sp.st ? "Nothing here." : "No investigation open. Open one from a report (Safety › Reports › the report › Open an investigation) or below."}</td></tr>}</tbody></table>
      </section>
      {desk && <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">+ Open an investigation</span><span className="mini">{ENT[s.entity]?.name ?? s.entity}</span></summary>
        <form action={openInvestigation} className="cb grid grid-cols-6 gap-2">
          <input type="hidden" name="entity" value={s.entity} />
          <label className="col-span-3"><span className="mini">On report</span><select name="report_id" className="inp" defaultValue=""><option value="">— none (a topic, a trend)</option>{((reps ?? []) as { id: string; headline: string }[]).map((r) => <option key={r.id} value={r.id}>{r.id} — {r.headline.slice(0, 80)}</option>)}</select></label>
          <label className="col-span-3"><span className="mini">Title (default: the report title)</span><input name="title" className="inp" /></label>
          <label className="col-span-2"><span className="mini">Level</span><select name="level" className="inp" defaultValue="standard">{Object.entries(INV_LEVEL).map(([k, [l, d]]) => <option key={k} value={k}>{l} · {d} days</option>)}</select></label>
          <label className="col-span-2"><span className="mini">Lead</span><select name="lead_person" className="inp" defaultValue={s.person?.id ?? ""}>{((ppl ?? []) as { id: string; display_name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
          <label className="col-span-2"><span className="mini">Due (default from the level)</span><input type="date" name="due" className="inp" /></label>
          <label className="col-span-6"><span className="mini">Terms of reference — scope and the questions to answer</span><textarea name="terms" className="inp" rows={2} /></label>
          <div className="col-span-6 flex justify-end"><button className="btn primary">Open</button></div>
        </form></details>}
    </>
  );
}
