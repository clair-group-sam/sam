import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Metric, PageHeader } from "@/components/Page";
import { isData, level, score } from "../data";

/* Part-IS · Overview (EU 2023/203): systems, interfaces without an IS clause, open risks by level, events to report. */
export default async function IsOverview() {
  const s = await getSession(); if (!s) redirect("/login");
  const { systems, flows, risks, incidents } = await isData(s);
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
      <PageHeader eyebrow="Part-IS, Overview" title="Information security" sub="Part-IS (EU 2023/203): the systems that matter for aviation safety, their interfaces, the risks and the events. Each figure opens its register." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Systems" value={systems.length} hint={`${systems.filter((x) => x.criticality === "high").length} high criticality`} />
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
          {red.map((r) => <tr key={r.id}><td><span className="pill red">high</span></td><td><Link href={`/is/risks?open=${r.id}#edit`}><b>{r.threat}</b></Link><div className="mini">{r.system ?? ""}</div></td></tr>)}
          {noClause.slice(0, 6).map((f) => <tr key={f.id}><td><span className="pill amber">clause</span></td><td><Link href={`/is/flows?open=${f.id}#edit`}><b>{f.from_system} to {f.to_system}</b></Link><div className="mini">No Part-IS clause recorded{f.contract_ref ? ` in ${f.contract_ref}` : ""}</div></td></tr>)}
          {unrep.map((i) => <tr key={i.id}><td><span className="pill amber">event</span></td><td><Link href={`/is/inc?open=${i.id}#edit`}><b>{i.title}</b></Link><div className="mini">{i.occurred_on}, not reported</div></td></tr>)}
          {review.length > 0 && <tr><td><span className="pill">review</span></td><td><Link href="/is/risks"><b>{review.length} risk(s) not reviewed in 12 months</b></Link></td></tr>}
          {!red.length && !noClause.length && !unrep.length && !review.length && <tr><td className="mini">Nothing to do.</td></tr>}
        </tbody></table></div></section>
      </div>
    </>
  );
}
