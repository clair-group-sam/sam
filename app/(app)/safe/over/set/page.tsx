import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader } from "@/components/Page";
import { AREA, BASIS, DIR, METRICS, PERIOD, mayEditSpi, type SpiDef, type Target } from "@/lib/spi";
import { copyTargets, saveDef, setStatus } from "../actions";

/** SPI set & targets of the entity (ENR-CM-06 « Définitions »): indicator, safety objective, how it is obtained, target and alert threshold per year. */
export default async function SpiSet({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!mayEditSpi(s)) redirect("/safe/over");
  const sp = await searchParams; const year = Number(sp.y) || new Date().getUTCFullYear();
  if (s.entity === "ALL") return <PageHeader eyebrow="Safety · Overview" title="SPI set & targets" sub="Pick an entity in the top bar." />;
  const e = s.entity; const db = supabaseAdmin();
  const { data: defs } = await db.from("spi_defs").select("*").eq("entity", e).order("sort");
  const D = (defs ?? []) as SpiDef[];
  const { data: tg } = D.length ? await db.from("spi_targets").select("spi_id,year,target,alert,note").in("spi_id", D.map((d) => d.id)) : { data: [] };
  const T = (tg ?? []) as (Target & { spi_id: string; year: number })[];
  const tOf = (id: string, y: number) => T.find((t) => t.spi_id === id && t.year === y);
  const proposed = D.filter((d) => d.status === "proposed").length; const nextMissing = D.some((d) => tOf(d.id, year) && !tOf(d.id, year + 1));
  const sel = (name: string, val: string | null, opts: Record<string, string>, empty?: string) => <select name={name} defaultValue={val ?? ""} className="inp">{empty != null && <option value="">{empty}</option>}{Object.entries(opts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  const metricOpts = Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, m.label]));
  const basisOpts = Object.fromEntries(Object.entries(BASIS).map(([k, b]) => [k, b.label]));
  const Form = ({ d }: { d?: SpiDef }) => { const t = d ? tOf(d.id, year) : undefined; return (
    <form action={saveDef} className="grid grid-cols-6 gap-2">
      <input type="hidden" name="entity" value={e} /><input type="hidden" name="year" value={year} />{d && <input type="hidden" name="id" value={d.id} />}
      {!d && <label><span className="mini">Code</span><input name="code" className="inp mono" required placeholder="SPI-44" /></label>}
      <label className={d ? "col-span-4" : "col-span-3"}><span className="mini">Indicator</span><input name="label" className="inp" required defaultValue={d?.label} /></label>
      <label className="col-span-2"><span className="mini">Safety objective (MSM)</span><input name="objective" className="inp" defaultValue={d?.objective ?? ""} /></label>
      <label><span className="mini">Area</span>{sel("area", d?.area ?? "other", AREA)}</label>
      <label className="col-span-2"><span className="mini">Obtained</span>{sel("metric", d?.metric ?? null, metricOpts, "entered monthly by the desk")}</label>
      <label><span className="mini">Expressed as</span>{sel("basis", d?.basis ?? "count", basisOpts)}</label>
      <label><span className="mini">Target set</span>{sel("period", d?.period ?? "month", PERIOD)}</label>
      <label><span className="mini">Direction</span>{sel("direction", d?.direction ?? "le", { le: "≤ at most", ge: "≥ at least", eq: "= exactly" })}</label>
      <label><span className="mini">Target {year}</span><input name="target" className="inp mono" defaultValue={t?.target ?? ""} placeholder="TBD" /></label>
      <label><span className="mini">Alert threshold</span><input name="alert" className="inp mono" defaultValue={t?.alert ?? ""} placeholder="none" /></label>
      <label><span className="mini">Owner</span><input name="owner_role" className="inp mono" defaultValue={d?.owner_role ?? "SM"} /></label>
      <label className="col-span-2"><span className="mini">Reference</span><input name="ref" className="inp" defaultValue={d?.ref ?? "ENR-CM-06"} /></label>
      <label className="col-span-1"><span className="mini">Note on the target</span><input name="target_note" className="inp" defaultValue={t?.note ?? ""} /></label>
      <div className="col-span-6 flex justify-end gap-2"><button className="btn primary">{d ? "Save" : "Add the SPI"}</button></div>
    </form>); };
  return (
    <>
      <PageHeader eyebrow="Safety · Overview" title={`SPI set & targets ${year}`} sub={`${ENT[e]?.name ?? e} — safety performance indicators linked to the safety objectives of the MSM; targets set by the AM on proposal of the SM and reviewed yearly at the SRB (AMC1 ORA.GEN.200(a)(1)).`}
        right={<><div className="yseg">{[year - 1, year, year + 1].map((y) => <Link key={y} href={`/safe/over/set?y=${y}`} className={"btn" + (y === year ? " on" : "")}>{y}</Link>)}</div><Link href={`/safe/over?y=${Math.min(year, new Date().getUTCFullYear())}`} className="btn">← Overview</Link></>} />
      {proposed > 0 && <section className="card mb-4"><div className="cb flex items-center gap-3"><span><b>{proposed} SPIs are proposed</b> — taken from the ASJFR set (same MSM family, same matrix). Change, retire or add what you need, then confirm the set: the SPIs become active on the Overview.</span>
        <form action={setStatus} className="ml-auto"><input type="hidden" name="entity" value={e} /><input type="hidden" name="status" value="active" /><button className="btn primary">Confirm the set</button></form></div></section>}
      {nextMissing && <form action={copyTargets} className="mb-4 flex justify-end"><input type="hidden" name="entity" value={e} /><input type="hidden" name="from" value={year} /><button className="btn">Carry the {year} targets to {year + 1}</button></form>}
      <section className="card mb-5">
        <table className="tbl">
          <thead><tr><th style={{ width: 90 }}>Code</th><th>Indicator</th><th style={{ width: 170 }}>Target {year}</th><th style={{ width: 120 }}>Status</th></tr></thead>
          <tbody>{D.map((d) => { const t = tOf(d.id, year); return (
            <tr key={d.id} id={d.code} className={d.status === "retired" ? "opacity-50" : ""}>
              <td className="mono">{d.code}</td>
              <td><details><summary className="cursor-pointer"><b>{d.label}</b><div className="mini">{d.objective} · {d.metric ? `S.A.M.: ${METRICS[d.metric]?.label}` : "entered monthly"} · {BASIS[d.basis].label} · target {PERIOD[d.period]}</div></summary><div className="mt-3"><Form d={d} /></div></details></td>
              <td className="mono">{t?.target == null ? "TBD" : `${DIR[d.direction]} ${t.target}`}{t?.alert != null && <div className="mini">alert {t.alert}</div>}</td>
              <td><span className={"pill " + (d.status === "active" ? "green" : d.status === "proposed" ? "amber" : "")}>{d.status}</span>
                <form action={setStatus} className="mt-1"><input type="hidden" name="entity" value={e} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="status" value={d.status === "retired" ? "active" : "retired"} /><button className="btn">{d.status === "retired" ? "Restore" : "Retire"}</button></form></td>
            </tr>); })}
            {!D.length && <tr><td colSpan={4} className="p-6 mini">No SPI yet — add the first one below.</td></tr>}
          </tbody>
        </table>
      </section>
      <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">+ New SPI</span></summary><div className="cb"><Form /></div></details>
    </>
  );
}
