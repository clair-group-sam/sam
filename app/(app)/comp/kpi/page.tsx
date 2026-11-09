import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { computeKpis, KPI_DEFS, KPI_STATUS_LABEL, KPI_STATUS_TONE, type KpiValue } from "@/lib/compliance-kpi";
import { addMonths, monthLabel } from "@/lib/audit-programme";
import { today } from "@/lib/authority";
import { saveTarget, takeSnapshot } from "./actions";

/* KPI-01 · Compliance › Indicators (ENR-CM-06): C1…C11 computed live from S.A.M., target and alert threshold per entity,
 * the last 12 monthly snapshots as the sheet shows them. Safety indicators (S1…S11) stay in Safety › Overview / SRB pack. */
type Sp = { ent?: string };
const fmt = (v: number | null, unit: string) => v === null ? "—" : unit === "%" ? `${v} %` : unit === "d" ? `${v} d` : String(v);
export default async function Kpi({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? ENTS4 : s.entities) : [s.entity];
  const entity = sp.ent && scope.includes(sp.ent) ? sp.ent : scope[0];
  const db = supabaseAdmin(); const t0 = today();
  const desk = s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
  const am = s.roles.map(basePost).some((r) => ["AM", "SUPERADMIN"].includes(r));
  const since = addMonths(t0.slice(0, 7) + "-01", -11);
  const [{ values, targets }, { data: snap }] = await Promise.all([computeKpis(db, entity, t0), db.from("kpi_snapshots").select("*").eq("entity", entity).gte("month", since).order("month")]);
  const snaps = (snap ?? []) as { code: string; month: string; value: number | null; status: string | null }[];
  const months = Array.from({ length: 12 }, (_, i) => addMonths(since, i));
  const by = (c: string) => values.find((v) => v.code === c) as KpiValue;
  const n = (st: string) => values.filter((v) => v.status === st).length;
  const thisMonth = t0.slice(0, 7) + "-01";
  const hasThisMonth = snaps.some((x) => x.month === thisMonth);
  return (
    <>
      <PageHeader eyebrow="Compliance · Indicators" title="Compliance indicators — ENR-CM-06" sub="C1 to C11 computed from the programme, the checks, the findings, the watch, the applications, the revisions and the subcontractors in S.A.M. Targets and alert thresholds are the Accountable Manager's, revised at the management review. One snapshot per month feeds the CODIR / SRB."
        right={<div className="flex gap-2 items-center">{scope.length > 1 && <div className="tabs" style={{ margin: 0 }}>{scope.map((e) => <Link key={e} href={`/comp/kpi?ent=${e}`} className={"tab" + (e === entity ? " on" : "")}><span className="entdot" style={{ background: ENT_COLOR[e] ?? "#888" }} />{e}</Link>)}</div>}
          {desk && <form action={takeSnapshot}><input type="hidden" name="entity" value={entity} /><button className={"btn " + (hasThisMonth ? "" : "primary")}>{hasThisMonth ? "Refresh this month's snapshot" : "Take this month's snapshot"}</button></form>}</div>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Measured" value={`${values.length - n("n_a")} / ${values.length}`} hint={n("n_a") ? `${n("n_a")} not measurable yet` : "every indicator has data"} />
        <Metric label="On target" value={n("on_target")} tone="green" />
        <Metric label="Alert" value={n("alert")} tone={n("alert") ? "amber" : undefined} />
        <Metric label="Off target" value={n("off_target")} tone={n("off_target") ? "red" : undefined} />
      </div>
      <section className="card mb-4"><div className="ch"><span><span className="entdot" style={{ background: ENT_COLOR[entity] ?? "#888" }} /><b>{ENT[entity]?.name ?? entity}</b> <span className="mini">· live at {t0}</span></span><span className="mini">direction · target · alert threshold</span></div>
        <div className="cb" style={{ padding: 0 }}>
          <table className="tbl"><thead><tr><th>ID</th><th>Indicator</th><th>Value</th><th>Target</th><th>Status</th><th>Owner · origin</th></tr></thead><tbody>
            {KPI_DEFS.map((d) => { const v = by(d.code); const t = targets.find((x) => x.code === d.code); return (
              <tr key={d.code}><td className="mono"><b>{d.code}</b></td>
                <td>{d.label}<div className="mini">{d.how} <span className="mono">{d.ref}</span></div>{v.note && <div className="mini" style={{ color: "var(--slate5)" }}>{v.note}</div>}</td>
                <td className="mono" style={{ whiteSpace: "nowrap" }}><b>{fmt(v.value, d.unit)}</b>{v.numerator !== null && v.denominator !== null && v.denominator > 0 && <div className="mini">{v.numerator} / {v.denominator}</div>}</td>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>{t ? <>{d.dir} {fmt(t.target, d.unit)}{t.alert !== null && <div className="mini">alert {fmt(t.alert, d.unit)}</div>}</> : <span className="mini">no target</span>}
                  {(am || desk) && <details><summary className="mini">set</summary><form action={saveTarget} className="grid gap-1 mt-1"><input type="hidden" name="entity" value={entity} /><input type="hidden" name="code" value={d.code} /><input name="target" className="inp mono" defaultValue={t?.target ?? ""} placeholder="target" required style={{ width: 90, marginTop: 0 }} /><input name="alert" className="inp mono" defaultValue={t?.alert ?? ""} placeholder="alert" style={{ width: 90, marginTop: 0 }} /><input name="origin" className="inp" defaultValue={t?.origin ?? ""} placeholder="origin (finding / audit)" style={{ width: 160, marginTop: 0 }} /><button className="btn sm">Save</button></form></details>}</td>
                <td><span className={"pill " + (KPI_STATUS_TONE[v.status] ?? "")}>{KPI_STATUS_LABEL[v.status]}</span></td>
                <td className="mini">{t?.owner_role ?? "CMM"}{t?.origin ? <div>{t.origin}</div> : null}</td></tr>); })}
          </tbody></table>
        </div></section>
      <section className="card"><div className="ch"><span className="eyebrow">Monthly snapshots · last 12 months</span><span className="mini">{snaps.length ? `${new Set(snaps.map((x) => x.month)).size} month${new Set(snaps.map((x) => x.month)).size > 1 ? "s" : ""} recorded` : "no snapshot yet — the first days of each month S.A.M. records the previous month; the desk can take one now"}</span></div>
        <div className="cb" style={{ overflow: "auto", padding: 0 }}>
          <table className="matrix"><thead><tr><th style={{ textAlign: "left" }}>ID</th>{months.map((m) => <th key={m}>{monthLabel(m, true)}</th>)}</tr></thead><tbody>
            {KPI_DEFS.map((d) => <tr key={d.code}><td style={{ textAlign: "left" }}><b className="mono">{d.code}</b> <span className="mini">{d.label}</span></td>{months.map((m) => { const x = snaps.find((q) => q.code === d.code && q.month === m); return <td key={m} className={x?.status ? "k-" + x.status : ""} title={x?.status ? KPI_STATUS_LABEL[x.status] : ""}>{x ? fmt(x.value, d.unit) : ""}</td>; })}</tr>)}
          </tbody></table>
        </div></section>
    </>
  );
}
