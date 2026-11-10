import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { SurvTabs } from "@/components/SurvTabs";
import { ENT_COLOR, ENTS4 } from "@/lib/nav";
import { addMonths, KIND_LABEL, monthLong, STATUS_LABEL, type Audit } from "@/lib/audit-programme";
import { today } from "@/lib/authority";
import { AuditImport } from "@/components/AuditImport";

type Sp = { tab?: string; src?: string; view?: string };
/* AUD-02 · Compliance › Audits (PRO-CM-02): the audits of the programme as they run — mine, to start, in progress, reports to close, done. */
export default async function Audits({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin(); const desk = s.role === "cmm"; const t0 = today();
  let q = db.from("audits").select("*").order("planned_month", { ascending: true }).limit(1500);
  if (scope) q = q.in("entity", scope);
  const { data } = await q;
  const every = (data ?? []) as (Audit & { started_on: string | null; checklist_id: string | null })[];
  // two registers, never mixed (Guillaume 10/11): what we plan and run (internal, subcontractors, checks) · what the authority does to us
  const src = sp.src === "authority" ? "authority" : "internal";
  const all = every.filter((a) => (a.kind === "authority") === (src === "authority"));
  const nAuth = every.filter((a) => a.kind === "authority").length, nInt = every.length - nAuth;
  const { data: ppl } = await db.from("people").select("id,display_name").limit(500);
  const name = (id: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === id)?.display_name ?? "—";
  const me = s.person?.id;
  const mine = all.filter((a) => (a.lead_auditor === me || (me && a.auditors.includes(me))) && !["closed", "cancelled"].includes(a.status));
  const open = all.filter((a) => ["planned", "in_progress", "report"].includes(a.status));
  const tab = sp.tab ?? (mine.length ? "mine" : "open");
  const rows = tab === "mine" ? mine : tab === "open" ? open : tab === "report" ? all.filter((a) => a.status === "report") : tab === "done" ? all.filter((a) => a.status === "closed").reverse() : all;
  const tabs: [string, string, number][] = [["mine", "Mine", mine.length], ["open", "Open", open.length], ["report", "Reports to close", all.filter((a) => a.status === "report").length], ["done", "Done", all.filter((a) => a.status === "closed").length], ["all", "All", all.length]];
  const late = open.filter((a) => a.status === "planned" && addMonths(a.planned_month, 1) <= t0);
  // 10/11 · the audits as a board by stage (Guillaume: « pas clair »): what to start, what runs, what has a report to close, what is done this year
  const view = sp.view === "list" ? "list" : "board";
  const isLateA = (a: Audit) => a.status === "planned" && addMonths(a.planned_month, 1) <= t0;
  const soon = addMonths(t0.slice(0, 7) + "-01", 6);
  const cols = [
    { key: "start", label: "To start", sub: late.length ? `${late.length} with the month passed, then the next 6 months` : "the next 6 months", tone: late.length ? "red" : "amber", list: all.filter((a) => a.status === "planned" && a.planned_month < soon), more: all.filter((a) => a.status === "planned" && a.planned_month >= soon).length },
    { key: "run", label: "In progress", sub: "checklist being run", tone: "", list: all.filter((a) => a.status === "in_progress"), more: 0 },
    { key: "report", label: "Report to close", sub: "findings raised, report to sign", tone: "amber", list: all.filter((a) => a.status === "report"), more: 0 },
    { key: "done", label: `Done in ${t0.slice(0, 4)}`, sub: "closed this year", tone: "green", list: all.filter((a) => a.status === "closed" && (a.done_on ?? a.planned_month).startsWith(t0.slice(0, 4))).reverse(), more: 0 },
  ];
  let cq = db.from("checklists").select("id,entity,code,title,domain,imported_from").eq("active", true).order("entity").order("code");
  if (scope) cq = cq.in("entity", scope);
  const { data: cld } = desk ? await cq : { data: [] };
  const checklists = (cld ?? []) as { id: string; entity: string; code: string; title: string; domain: string | null; imported_from: string | null }[];
  const { data: cnt } = checklists.length ? await db.from("checklist_items").select("checklist_id").in("checklist_id", checklists.map((c) => c.id)).eq("active", true).limit(50000) : { data: [] };
  const nItems = (id: string) => ((cnt ?? []) as { checklist_id: string }[]).filter((x) => x.checklist_id === id).length;
  return (
    <>
      <PageHeader eyebrow="Compliance, Surveillance plan" title="Audits" sub={src === "authority" ? "What the authority did to us: audits, inspections, recurrent evaluations and meetings (DSAC, OSAC, TM-CAD, EASA), with their findings. Not part of our programme." : "Each audit runs its checklist: the official text of each rule, S.A.M.'s help on where to look, a result with evidence, a finding when needed, then the report. Planned in the Programme tab."} right={undefined} />
      <SurvTabs on="audits" />
      <div className="seg mb-3" style={{ display: "inline-flex" }}>
        <Link href={`/comp/audits?src=internal&view=${view}`} className={src === "internal" ? "on" : ""}>Internal audits &amp; subcontractors <span className="mini">{nInt}</span></Link>
        <Link href={`/comp/audits?src=authority&view=${view}`} className={src === "authority" ? "on" : ""}>Authority audits &amp; inspections <span className="mini">{nAuth}</span></Link>
      </div>
      <div className="seg mb-3" style={{ display: "inline-flex", marginLeft: 8 }}><Link href={`/comp/audits?src=${src}&view=board`} className={view === "board" ? "on" : ""}>Board</Link><Link href={`/comp/audits?src=${src}&view=list`} className={view === "list" ? "on" : ""}>List</Link></div>
      {view === "board" ? (
        <div className="wboard mb-4">{cols.map((c) => (
          <div key={c.key} className={"wcol " + c.tone}>
            <div className="wcolh"><b>{c.label}</b><span className="wcount">{c.list.length}</span></div>
            <div className="mini wcolsub">{c.sub}</div>
            {c.list.slice(0, 12).map((a) => { const lt = isLateA(a); return (
              <Link key={a.id} href={`/comp/audits/${a.id}`} className={"wcard" + (lt ? " late" : "")}>
                <div className="wcm" style={{ marginTop: 0 }}><span><span className="entdot" style={{ background: ENT_COLOR[a.entity] ?? "var(--field)" }} /><b className="mono">{a.number}</b></span><span className={"akind " + a.kind}>{src === "authority" ? (a.authority ?? "Authority") : KIND_LABEL[a.kind]?.replace(" audit", "")}</span></div>
                <div className="wct">{a.title}</div>
                <div className="wcm"><span>{src === "authority" ? (a.external_auditor ?? "") : a.lead_auditor ? name(a.lead_auditor) : a.external_auditor ?? "no auditor"}</span><span className={"wdue" + (lt ? " late" : "")}>{a.done_on ?? (a.planned_on ?? monthLong(a.planned_month))}{lt ? " · late" : ""}</span></div>
                {!a.checklist_id && a.kind !== "authority" && a.status !== "closed" && <div className="mini" style={{ color: "var(--amber-ink)" }}>no checklist yet</div>}
              </Link>); })}
            {c.list.length > 12 && <Link href={`/comp/audits?src=${src}&view=list`} className="mini wmore">+ {c.list.length - 12} more, see the list</Link>}
            {c.more > 0 && <Link href={`/comp/audits?src=${src}&view=list&tab=open`} className="mini wmore">{c.more} planned later</Link>}
            {!c.list.length && <p className="mini wmore">Nothing.</p>}
          </div>))}</div>
      ) : <>
      <div className="tabs mb-2">{tabs.map(([k, l, n]) => <Link key={k} href={`/comp/audits?src=${src}&tab=${k}&view=list`} className={"tab" + (tab === k ? " on" : "")}>{l} <span className="mini">{n}</span></Link>)}</div>
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!rows.length ? <p className="p-4 mini">Nothing here.</p> : (
        <table className="tbl"><thead><tr><th>Audit</th><th>Month</th><th>{src === "authority" ? "Authority" : "Auditor"}</th><th>Status</th></tr></thead><tbody>{rows.map((a) => {
          const isLate = a.status === "planned" && addMonths(a.planned_month, 1) <= t0;
          return <tr key={a.id}><td><Link href={`/comp/audits/${a.id}`}><b className="mono">{a.number}</b> {a.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[a.entity] ?? "var(--field)" }} />{a.entity}, {KIND_LABEL[a.kind]}{a.subcontractor ? `, ${a.subcontractor}` : ""}{a.authority ? `, ${a.authority}` : ""}{!a.checklist_id && a.kind !== "authority" ? <span className="red">, no checklist</span> : ""}</div></td>
            <td className={isLate ? "late" : ""}>{monthLong(a.planned_month)}{a.planned_on && <div className="mini mono">{a.planned_on}{a.planned_end ? ` → ${a.planned_end}` : ""}</div>}</td>
            <td>{src === "authority" ? <>{a.authority ?? a.external_auditor ?? "—"}{a.external_auditor && a.authority && a.external_auditor !== a.authority && <div className="mini">{a.external_auditor}</div>}</> : a.lead_auditor ? name(a.lead_auditor) : a.external_auditor ?? "—"}</td>
            <td><span className={"pill " + (a.status === "closed" ? "green" : a.status === "report" ? "amber" : isLate ? "red" : a.status === "in_progress" ? "amber" : "")}>{STATUS_LABEL[a.status]}</span>{a.done_on && <div className="mini mono">{a.done_on}</div>}</td></tr>;
        })}</tbody></table>)}</div></section></>}
      {desk && <details className="card mt-4 mb-4"><summary className="ch"><span className="eyebrow">Checklists, {checklists.length}</span><span className="mini">the templates behind the audits, linked to the programme's modules</span></summary>
        <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>Checklist</th><th>Domain</th><th>Items</th><th>Origin</th></tr></thead><tbody>{checklists.map((c) => <tr key={c.id}><td><Link href={`/comp/prog/cl/${c.id}`}><b className="mono">{c.code}</b> {c.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[c.entity] ?? "var(--field)" }} />{c.entity}</div></td><td className="mini">{c.domain ?? "—"}</td><td className={nItems(c.id) ? "" : "late"}>{nItems(c.id)}</td><td className="mini">{c.imported_from ?? "S.A.M."}</td></tr>)}{!checklists.length && <tr><td className="mini" colSpan={4}>No checklist yet, create one from a programme module, or import from Centrik.</td></tr>}</tbody></table></div></details>}
      {desk && <AuditImport entities={s.group ? ENTS4 : s.entities} initial={s.entity === "ALL" ? (s.group ? ENTS4 : s.entities)[0] : s.entity} />}
    </>
  );
}
