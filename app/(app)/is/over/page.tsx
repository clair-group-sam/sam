import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Metric, PageHeader } from "@/components/Page";
import { isData, level, score, onePerRef } from "../data";

/* Part-IS · Overview (EU 2023/203): systems, interfaces without an IS clause, open risks by level, events to report. */
export default async function IsOverview() {
  const s = await getSession(); if (!s) redirect("/login");
  const d = await isData(s);
  const { flows, risks, incidents } = d;
  const all = s.entity === "ALL" ? onePerRef(d.systems) : d.systems;
  const systems = all.filter((x) => x.status !== "awaiting");
  const awaiting = all.filter((x) => x.status === "awaiting");
  const critical = systems.filter((x) => x.attention === "critical");
  const grp = systems.filter((x) => x.resp === "grp");
  const tbc = systems.filter((x) => x.contract === "tbc" && x.resp !== "auth");
  const unsure = systems.filter((x) => x.status === "to_confirm" || x.ops_impact === "?");
  const assessed = (x: { entity: string; name: string }) => risks.some((r) => r.entity === x.entity && (r.system ?? "").toLowerCase().includes(x.name.toLowerCase().split(/[ (]/)[0]));
  const critNoRisk = critical.filter((x) => !assessed(x));
  const t0 = new Date().toISOString().slice(0, 10);
  const open = risks.filter((r) => r.status === "open");
  const red = open.filter((r) => score(r) >= 15), late = open.filter((r) => r.due && r.due < t0);
  const noClause = flows.filter((f) => f.is_clause !== true && f.criticality !== "low");
  const unrep = incidents.filter((i) => i.status === "open" && !i.reported);
  const review = risks.filter((r) => !r.reviewed_on || r.reviewed_on < new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10));
  const cells: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const r of open) if (r.likelihood && r.severity) cells[5 - r.likelihood][r.severity - 1]++;
  return (
    <>
      <PageHeader eyebrow="Part-IS, Overview" title="Information security" sub="Part-IS (EU 2023/203): the systems that matter for aviation safety, who holds them, their interfaces, the risks and the events. Built from the Cartographie Part-IS V7.1; each line opens its register." />
      <div className="grid grid-cols-4 gap-4 mb-3">
        <Metric label="Systems listed" value={systems.length} hint={`${critical.length} critical for flight safety`} />
        <Metric label="Under Group responsibility" value={grp.length} tone={grp.length ? "info" : undefined} hint="Clair Group is not Part-IS certified: control by contract" />
        <Metric label="Contracts to confirm" value={tbc.length} tone={tbc.length ? "amber" : undefined} hint="holder or IS clauses not confirmed (IS.I.OR.235)" />
        <Metric label="Departments without reply" value={awaiting.length} tone={awaiting.length ? "amber" : undefined} hint="inventory e-mail of 31/03/2026" />
      </div>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Critical without risk assessment" value={critNoRisk.length} tone={critNoRisk.length ? "red" : undefined} hint="IS.I.OR.205, one assessment per system" />
        <Metric label="Interfaces without IS clause" value={noClause.length} tone={noClause.length ? "amber" : undefined} hint="medium or high criticality" />
        <Metric label="Open risks" value={open.length} tone={red.length ? "red" : late.length ? "amber" : undefined} hint={`${red.length} high, ${late.length} past due`} />
        <Metric label="Events not reported" value={unrep.length} tone={unrep.length ? "amber" : undefined} hint="open events, check IS.I.OR.230" />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <section className="card"><div className="ch"><span className="eyebrow">Open risks: likelihood by severity</span><Link className="mini" href="/is/risks">Open the register</Link></div>
          <div className="cb"><table className="ismx"><tbody>{cells.map((row, i) => <tr key={i}><th>{5 - i}</th>{row.map((n, j) => <td key={j} className={"lv-" + level((5 - i) * (j + 1))}>{n || ""}</td>)}</tr>)}
            <tr><th></th>{[1, 2, 3, 4, 5].map((x) => <th key={x}>{x}</th>)}</tr></tbody></table>
            <p className="mini mt-2">Rows: likelihood 5 (frequent) to 1. Columns: severity 1 to 5. Score 15 and above is high.</p></div></section>
        <section className="card"><div className="ch"><span className="eyebrow">To do</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
          {critNoRisk.slice(0, 8).map((x) => <tr key={x.id}><td><span className="pill red">assess</span></td><td><Link href="/is/risks?new=1#edit"><b>{x.name}</b></Link><div className="mini">Critical, no IS risk assessment yet{s.entity === "ALL" ? `, ${(x.scope ?? []).join(", ")}` : ""}</div></td></tr>)}
          {critNoRisk.length > 8 && <tr><td></td><td className="mini">and {critNoRisk.length - 8} more critical systems</td></tr>}
          {awaiting.map((x) => <tr key={x.id}><td><span className="pill amber">reply</span></td><td><Link href={`/is/systems?open=${x.id}#edit`}><b>{x.name}</b></Link><div className="mini">No reply to the inventory, follow up</div></td></tr>)}
          {red.map((r) => <tr key={r.id}><td><span className="pill red">high</span></td><td><Link href={`/is/risks?open=${r.id}#edit`}><b>{r.threat}</b></Link><div className="mini">{r.system ?? ""}</div></td></tr>)}
          {noClause.slice(0, 6).map((f) => <tr key={f.id}><td><span className="pill amber">clause</span></td><td><Link href={`/is/flows?open=${f.id}#edit`}><b>{f.from_system} to {f.to_system}</b></Link><div className="mini">No Part-IS clause recorded{f.contract_ref ? ` in ${f.contract_ref}` : ""}</div></td></tr>)}
          {unrep.map((i) => <tr key={i.id}><td><span className="pill amber">event</span></td><td><Link href={`/is/inc?open=${i.id}#edit`}><b>{i.title}</b></Link><div className="mini">{i.occurred_on}, not reported</div></td></tr>)}
          {review.length > 0 && <tr><td><span className="pill">review</span></td><td><Link href="/is/risks"><b>{review.length} risk(s) not reviewed in 12 months</b></Link></td></tr>}
          {tbc.filter((x) => x.attention === "critical").slice(0, 6).map((x) => <tr key={"c" + x.id}><td><span className="pill amber">contract</span></td><td><Link href={`/is/systems?open=${x.id}#edit`}><b>{x.name}</b></Link><div className="mini">Critical: confirm the contract holder and its Part-IS clauses</div></td></tr>)}
          {unsure.length > 0 && <tr><td><span className="pill">confirm</span></td><td><Link href="/is/systems"><b>{unsure.length} system(s) with status or operational impact to confirm</b></Link></td></tr>}
          {!critNoRisk.length && !awaiting.length && !red.length && !noClause.length && !unrep.length && !review.length && <tr><td className="mini">Nothing to do.</td></tr>}
        </tbody></table></div></section>
      </div>
    </>
  );
}
