import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader } from "@/components/Page";
import { monthShort } from "@/components/SpiCharts";
import { ACTIVITY, BASIS, METRICS, mayEditSpi, monthsOf, type SpiDef } from "@/lib/spi";
import { saveData } from "../actions";

/** Monthly data entry (ENR-CM-06 « Données mensuelles »): activity hours and the SPIs S.A.M. cannot compute. Computed SPIs can be corrected month by month on their own page. */
export default async function SpiData({ searchParams }: { searchParams: Promise<{ y?: string; all?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!mayEditSpi(s)) redirect("/safe/over");
  const sp = await searchParams; const year = Number(sp.y) || new Date().getUTCFullYear();
  if (s.entity === "ALL") return <><PageHeader eyebrow="Safety · Overview" title="Monthly data" sub="Pick an entity in the top bar: data is entered entity by entity." /></>;
  const e = s.entity; const db = supabaseAdmin();
  const [{ data: defs }, { data: rows }] = await Promise.all([
    db.from("spi_defs").select("*").eq("entity", e).neq("status", "retired").order("sort"),
    db.from("spi_data").select("key,month,value,den,source").eq("entity", e).gte("month", `${year}-01-01`).lte("month", `${year}-12-31`),
  ]);
  const D = (defs ?? []) as SpiDef[];
  const V = new Map(((rows ?? []) as { key: string; month: string; value: number; den: number | null; source: string }[]).map((r) => [`${r.key}|${r.month.slice(0, 7)}`, r]));
  const months = monthsOf(year); const cur = new Date().toISOString().slice(0, 7);
  const needs = new Set(D.map((d) => BASIS[d.basis].den).filter(Boolean) as string[]);
  const manual = D.filter((d) => !d.metric); const computed = D.filter((d) => d.metric);
  const cell = (key: string, m: string, pct?: boolean) => {
    const r = V.get(`${key}|${m}`); const fut = m > cur;
    return (
      <td key={m} className={"dcell" + (r && r.source !== "manual" ? " imp" : "")}>
        <input name={`v|${key}|${m}`} defaultValue={r ? String(r.value) : ""} disabled={fut} className="inp mono" />
        {r && <input type="hidden" name={`o|${key}|${m}`} value={String(r.value)} />}
        {pct && <><input name={`d|${key}|${m}`} defaultValue={r?.den != null ? String(r.den) : ""} disabled={fut} className="inp mono den" placeholder="of" />{r?.den != null && <input type="hidden" name={`od|${key}|${m}`} value={String(r.den)} />}</>}
      </td>);
  };
  const head = <tr><th style={{ width: 280 }}>Data</th>{months.map((m) => <th key={m} className="dcell">{monthShort(m)}</th>)}</tr>;
  return (
    <>
      <PageHeader eyebrow="Safety · Overview" title={`Monthly data ${year}`} sub={`${ENT[e]?.name ?? e} — enter at month end what S.A.M. cannot count itself (ENR-CM-06). Reports, MOR, ERC, hazards, assessments and actions are counted by S.A.M.`}
        right={<><div className="yseg">{[year - 1, year].map((y) => <Link key={y} href={`/safe/over/data?y=${y}`} className={"btn" + (y === year ? " on" : "")}>{y}</Link>)}</div><Link href={`/safe/over?y=${year}`} className="btn">← Overview</Link></>} />
      <form action={saveData}>
        <input type="hidden" name="entity" value={e} />
        <section className="card mb-5 overflow-x-auto">
          <div className="ch"><span className="eyebrow">Activity</span><span className="mini">denominator of the rates{needs.size ? ` — needed: ${[...needs].map((k) => ACTIVITY[k].toLowerCase()).join(", ")}` : ""}</span></div>
          <table className="tbl dgrid"><thead>{head}</thead><tbody>
            {Object.entries(ACTIVITY).map(([k, l]) => <tr key={k} className={needs.has(k) ? "" : "opacity-60"}><td><b>{l}</b>{needs.has(k) && <div className="mini">used by the SPI rates</div>}</td>{months.map((m) => cell(k, m))}</tr>)}
          </tbody></table>
        </section>
        <section className="card mb-5 overflow-x-auto">
          <div className="ch"><span className="eyebrow">SPIs entered by hand</span><span className="mini">counts of the month · percentages as « x of y » · scores 1–5</span></div>
          <table className="tbl dgrid"><thead>{head}</thead><tbody>
            {manual.map((d) => <tr key={d.id}><td><Link href={`/safe/over/spi/${d.id}?y=${year}`} className="hover:underline"><span className="mono">{d.code}</span> {d.label}</Link><div className="mini">{d.basis === "percent" ? "x of y" : d.basis === "score" ? "score 1–5" : BASIS[d.basis].den ? `events (rate ${BASIS[d.basis].short})` : "number"}</div></td>{months.map((m) => cell(`spi:${d.code}`, m, d.basis === "percent"))}</tr>)}
            {!manual.length && <tr><td colSpan={13} className="mini p-4">Every SPI of this entity is computed by S.A.M.</td></tr>}
          </tbody></table>
        </section>
        {sp.all ? <section className="card mb-5 overflow-x-auto">
          <div className="ch"><span className="eyebrow">Corrections of computed SPIs</span><span className="mini">a value entered here replaces what S.A.M. counts for that month — use it for history or a known gap</span></div>
          <table className="tbl dgrid"><thead>{head}</thead><tbody>
            {computed.map((d) => <tr key={d.id}><td><Link href={`/safe/over/spi/${d.id}?y=${year}`} className="hover:underline"><span className="mono">{d.code}</span> {d.label}</Link><div className="mini">S.A.M.: {METRICS[d.metric!]?.label}</div></td>{months.map((m) => cell(`spi:${d.code}`, m, d.basis === "percent"))}</tr>)}
          </tbody></table>
        </section> : <p className="mini mb-5"><Link className="underline" href={`/safe/over/data?y=${year}&all=1`}>Show the corrections of the computed SPIs</Link> (history, known gaps).</p>}
        <div className="flex justify-end gap-2 sticky bottom-3"><span className="mini self-center">Cells in grey were imported from the ENR-CM-06 workbook.</span><button className="btn primary">Save the month data</button></div>
      </form>
    </>
  );
}
