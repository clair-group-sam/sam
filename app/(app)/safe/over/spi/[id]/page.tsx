import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import NewActionForm from "@/components/NewActionForm";
import { SpiLine, monthShort } from "@/components/SpiCharts";
import { ACTIVITY, AREA, BASIS, DIR, METRICS, PERIOD, VERDICT, aggOf, fmt, mayEditSpi, spiBoard, targetText, valueOver } from "@/lib/spi";
import { setMonth } from "../../actions";

/** One SPI: definition, how it is obtained, its months against the target, entered corrections, actions raised from it. */
export default async function SpiPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ y?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params; const sp = await searchParams;
  const db = supabaseAdmin();
  const { data: d0 } = await db.from("spi_defs").select("entity").eq("id", id).maybeSingle();
  const entity = (d0 as { entity: string } | null)?.entity; if (!entity || !s.entities.includes(entity)) notFound();
  const year = Number(sp.y) || new Date().getUTCFullYear();
  const board = await spiBoard(entity, year);
  const r = board.rows.find((x) => x.id === id); if (!r) notFound();
  const edit = mayEditSpi(s);
  const [{ data: ent }, { data: tg }, { data: acts }] = await Promise.all([
    db.from("spi_data").select("month,value,den,source,note,entered_at").eq("entity", entity).eq("key", `spi:${r.code}`).gte("month", `${year}-01-01`).lte("month", `${year}-12-31`),
    db.from("spi_targets").select("year,target,alert,note").eq("spi_id", id).order("year", { ascending: false }),
    db.from("safety_actions").select("id,number,title,status,due").eq("spi_id", id).order("created_at", { ascending: false }),
  ]);
  const E = new Map(((ent ?? []) as { month: string; value: number; den: number | null; source: string; note: string | null }[]).map((x) => [x.month.slice(0, 7), x]));
  const b = BASIS[r.basis]; const actKey = b.den; const act = actKey ? board.activity[actKey] : board.months.map(() => null);
  const monthly = board.months.map((_, i) => valueOver(r, [r.cells[i]], [act[i]]));
  const unit = r.basis === "percent" ? " %" : b.short ? " " + b.short : "";
  const m = r.metric ? METRICS[r.metric] : null; const done = Number(board.upTo.slice(5));
  return (
    <>
      <PageHeader eyebrow={`Safety · Overview · ${entity}`} title={`${r.code} — ${r.label}`} sub={r.objective ?? undefined}
        tag={<span className="flex gap-2 flex-wrap"><span className={"pill " + VERDICT[r.ytdVerdict][1]}>{VERDICT[r.ytdVerdict][0]} (YTD)</span>{r.status !== "active" && <span className="pill amber">{r.status}</span>}<span className="pill">{AREA[r.area] ?? r.area}</span>{r.ref && <span className="pill">{r.ref}</span>}</span>}
        right={<><div className="yseg">{[year - 1, year, year + 1].filter((y) => y <= new Date().getUTCFullYear()).map((y) => <Link key={y} href={`/safe/over/spi/${id}?y=${y}`} className={"btn" + (y === year ? " on" : "")}>{y}</Link>)}</div><Link className="btn" href={`/safe/over?y=${year}`}>← Overview</Link>{edit && <Link className="btn" href={`/safe/over/set?y=${year}#${r.code}`}>Edit</Link>}</>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label={`Target ${year}`} value={targetText(r, r.t)} hint={r.t?.alert != null ? `alert ${fmt(r.t.alert, r.basis)}` : PERIOD[r.period]} />
        <Metric label={`Q${board.quarter}`} value={fmt(r.quarter, r.basis)} tone={r.quarterVerdict === "far" ? "red" : r.quarterVerdict === "improve" ? "amber" : r.quarterVerdict === "ok" ? "green" : undefined} />
        <Metric label="Year to date" value={fmt(r.ytd, r.basis)} tone={r.ytdVerdict === "far" ? "red" : r.ytdVerdict === "improve" ? "amber" : r.ytdVerdict === "ok" ? "green" : undefined} hint={r.ytdTarget?.target != null && r.ytdTarget.target !== r.t?.target ? `expected at this date: ${fmt(r.ytdTarget.target, r.basis)}` : undefined} />
        <Metric label="How it is obtained" value={m ? "S.A.M." : "Entered"} hint={m ? m.how : "entered each month by the safety desk"} />
      </div>
      <section className="card mb-5">
        <div className="ch"><span className="eyebrow">{year} month by month</span><span className="mini">{b.den ? `rate ${b.label} — events ÷ ${ACTIVITY[b.den].toLowerCase()} entered for the month` : b.label} · months add up as {({ sum: "a sum", last: "the last value", avg: "the mean", pool: "a pooled percentage" } as Record<string, string>)[aggOf(r)]}</span></div>
        <div className="cb"><SpiLine months={board.months} values={monthly} target={r.t?.target ?? null} alert={r.t?.alert ?? null} unit={unit} /></div>
        <table className="tbl">
          <thead><tr><th style={{ width: 90 }}>Month</th><th style={{ width: 110 }}>{b.den ? "Events" : "Value"}</th>{b.den && <th style={{ width: 110 }}>{ACTIVITY[b.den]}</th>}<th style={{ width: 110 }}>{b.den ? "Rate" : "Result"}</th><th style={{ width: 120 }}>Status</th><th>Source{edit ? " · correct / enter" : ""}</th></tr></thead>
          <tbody>{board.months.map((mo, i) => {
            const c = r.cells[i]; const e = E.get(mo); const v = monthly[i]; const vd = r.monthVerdicts[i];
            return (
              <tr key={mo} className={i >= done ? "opacity-50" : ""}>
                <td className="mono">{monthShort(mo)}</td>
                <td className="mono">{c ? (r.basis === "percent" && c.den != null ? `${c.num} of ${c.den}` : fmt(c.num, r.basis === "score" ? "score" : r.basis === "percent" ? "percent" : "count")) : "—"}</td>
                {b.den && <td className="mono">{act[i] ?? <span className="mini">not entered</span>}</td>}
                <td className="mono">{fmt(v, r.basis)}</td>
                <td>{vd && <span className={"pill " + VERDICT[vd][1]}>{VERDICT[vd][0]}</span>}</td>
                <td>{c ? <span className="mini">{c.src === "entered" ? `entered${e?.source && e.source !== "manual" ? ` (${e.source})` : ""}${e?.note ? " — " + e.note : ""}` : "computed by S.A.M."}</span> : <span className="mini">{i < done ? "no data" : ""}</span>}
                  {edit && i < done && <form action={setMonth} className="inline-flex gap-1 ml-2 align-middle"><input type="hidden" name="entity" value={entity} /><input type="hidden" name="key" value={`spi:${r.code}`} /><input type="hidden" name="month" value={mo} />
                    <input name="value" className="inp mono" style={{ width: 70, marginTop: 0 }} defaultValue={e ? String(e.value) : ""} placeholder={r.metric ? "override" : "value"} />{r.basis === "percent" && <input name="den" className="inp mono" style={{ width: 60, marginTop: 0 }} defaultValue={e?.den != null ? String(e.den) : ""} placeholder="of" />}
                    <button className="btn">{e ? "Save" : "Set"}</button></form>}</td>
              </tr>);
          })}</tbody>
        </table>
        {r.metric && <div className="cb mini">A value entered for a month replaces the computed one (history from the ENR-CM-06 workbook, or a correction). Leave it empty and save to go back to the computed value.</div>}
      </section>
      <div className="grid grid-cols-2 gap-5">
        <section className="card">
          <div className="ch"><span className="eyebrow">Targets</span><span className="mini">set by the AM on proposal of the SM, reviewed yearly at the SRB</span></div>
          <table className="tbl"><tbody>{((tg ?? []) as { year: number; target: number | null; alert: number | null; note: string | null }[]).map((t) => <tr key={t.year}><td className="mono">{t.year}</td><td className="mono">{t.target == null ? "TBD" : `${DIR[r.direction]} ${fmt(t.target, r.basis)}`}</td><td className="mini">{t.alert != null ? `alert ${fmt(t.alert, r.basis)}` : ""}{t.note ? ` · ${t.note}` : ""}</td></tr>)}</tbody></table>
        </section>
        <section className="card" id="action">
          <div className="ch"><span className="eyebrow">Actions from this SPI</span>{r.offTwice && <span className="pill red">off target two months in a row</span>}</div>
          <div className="cb">
            {((acts ?? []) as { id: string; number: string; title: string; status: string; due: string | null }[]).map((a) => <div key={a.id}><Link className="underline mono" href={`/safe/actions/${a.id}`}>{a.number}</Link> {a.title} <span className="mini">· {a.status}{a.due ? ` · due ${a.due}` : ""}</span></div>)}
            {edit && <details className="mt-2" open={r.offTwice}><summary className="cursor-pointer mini">+ Raise an action (ENR-CM-06: off target two months in a row → action with owner and due date)</summary>
              <div className="mt-2"><NewActionForm entity={entity} source="spi" spi_id={r.id} title={`${r.code} off target — analyse and act`} description={`${r.label}: ${fmt(r.ytd, r.basis)} YTD against ${targetText(r, r.t)}.`} owner_role={r.owner_role} compact /></div></details>}
          </div>
        </section>
      </div>
    </>
  );
}
