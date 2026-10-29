import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { morClock } from "@/lib/safety";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { MonthBars, MonthCells, monthShort } from "@/components/SpiCharts";
import { AREA, BASIS, METRICS, VERDICT, computedMetrics, fmt, mayEditSpi, spiBoard, targetText, type SpiRow } from "@/lib/spi";
import { draftCommentary, saveCommentary } from "./actions";

type Sp = { y?: string; all?: string };
const yearsBack = (n: number) => { const y = new Date().getUTCFullYear(); return Array.from({ length: n }, (_, i) => y - i); };
const last24 = () => { const out: string[] = []; const d = new Date(); d.setUTCDate(1); for (let i = 23; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); } return out; };

/** Safety › Overview: where the safety system stands today (reports, MOR clocks, actions, hazard log) and the safety performance indicators (ENR-CM-06) against their targets. */
export default async function SafetyOverview({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const year = Number(sp.y) || new Date().getUTCFullYear();
  const edit = mayEditSpi(s);
  const yearLinks = <div className="yseg">{yearsBack(3).map((y) => <Link key={y} href={`/safe/over?y=${y}`} className={"btn" + (y === year ? " on" : "")}>{y}</Link>)}</div>;

  if (s.entity === "ALL") return <GroupView ents={s.entities} year={year} yearLinks={yearLinks} />;

  const db = supabaseAdmin(); const e = s.entity; const now = Date.now(); const today = new Date().toISOString().slice(0, 10);
  const [board, { data: open }, { data: acts }, { data: hz }, { data: notes }] = await Promise.all([
    spiBoard(e, year),
    db.from("reports").select("id,received_at,status,mor_filed_at,source,headline,report_analysis(mor_status,confirmed_at)").eq("entity", e).neq("status", "closed").limit(1000),
    db.from("safety_actions").select("status,due").eq("entity", e).eq("module", "safety").in("status", ["open", "in_progress", "done"]).limit(2000),
    db.from("hazards").select("needs_review,review_date,status,assessment_id,risk_assessments!inner(kind,status)").eq("entity", e).eq("risk_assessments.kind", "hazard_log").neq("status", "closed").limit(3000),
    db.from("spi_notes").select("id,year,quarter,text,model,created_at,created_by").eq("entity", e).eq("year", year).order("created_at", { ascending: false }).limit(1),
  ]);
  type R = { id: string; received_at: string; status: string; mor_filed_at: string | null; source: string | null; headline: string; report_analysis: { mor_status: string | null; confirmed_at: string | null } | { mor_status: string | null; confirmed_at: string | null }[] | null };
  const reps = ((open ?? []) as unknown as R[]).filter((r) => !/^\s*test\b/i.test(r.headline)).map((r) => ({ ...r, a: Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis }));
  const toAck = reps.filter((r) => r.status === "received").length;
  // FB-041 · same clock as the Reports page: a proposed (unconfirmed) "voluntary" does not stop the 72 h
  const withClock = reps.map((r) => ({ ...r, clock: morClock(r.received_at, r.mor_filed_at, r.a?.confirmed_at ? r.a.mor_status : null, now, (r.source ?? "sam") !== "sam") }));
  const clocks = withClock.filter((r) => r.clock.state === "running" || r.clock.state === "late");
  const late = clocks.filter((r) => r.clock.state === "late").length;
  const old = reps.filter((r) => now - new Date(r.received_at).getTime() > 90 * 864e5).length;
  const A = (acts ?? []) as { status: string; due: string | null }[];
  const actLate = A.filter((a) => a.status !== "done" && a.due && a.due < today).length;
  const H = (hz ?? []) as { needs_review: boolean; review_date: string | null }[];
  const reassess = H.filter((h) => h.needs_review).length; const reviewDue = H.filter((h) => h.review_date && h.review_date < today).length;

  const m24 = last24(); const c24 = await computedMetrics(e, m24);
  const { data: act24 } = await db.from("spi_data").select("key,month,value").eq("entity", e).in("key", ["bh", "fh"]).gte("month", `${m24[0]}-01`);
  const hours = (k: string) => m24.map((m) => ((act24 ?? []) as { key: string; month: string; value: number }[]).find((x) => x.key === k && x.month.startsWith(m))?.value ?? null);
  const rateBasis = board.rows.find((r) => r.metric === "reports")?.basis ?? "per_1000_bh"; const rb = BASIS[rateBasis];
  const hrs = hours(rb.den === "fh" ? "fh" : "bh");
  const repN = c24.reports.map((c) => c?.num ?? 0); const morN = c24.mor.map((c) => c?.num ?? 0);
  const rate = m24.map((_, i) => (hrs[i] ? (repN[i] * rb.per) / hrs[i]! : null));
  const reportT = board.rows.find((r) => r.metric === "reports")?.t?.target ?? null;

  const rows = board.rows; const active = rows.filter((r) => r.status === "active"); const proposed = rows.filter((r) => r.status === "proposed");
  const count = (v: string) => rows.filter((r) => r.ytdVerdict === v).length; // FB-042 · proposed SPIs count too (the banner says they are not confirmed)
  void active;
  const needsHours = rows.some((r) => BASIS[r.basis].den) && !board.activity[rows.some((r) => BASIS[r.basis].den === "fh") && !rows.some((r) => BASIS[r.basis].den === "bh") ? "fh" : "bh"].some((v) => v != null);
  const groups = [...new Set(rows.map((r) => r.objective ?? "Other"))];
  const note = ((notes ?? []) as { id: string; quarter: number | null; text: string; model: string | null; created_at: string }[])[0];
  const labels = board.months.map((m) => `${monthShort(m)} ${year}`);

  return (
    <>
      <PageHeader eyebrow="Safety · Safety assurance" title="Overview" sub={`${ENT[e]?.name ?? e} — where the safety system stands today, and the safety performance indicators (ENR-CM-06) against their targets.`}
        right={<>{yearLinks}{edit && <><Link href={`/safe/over/data?y=${year}`} className="btn">Monthly data</Link><Link href={`/safe/over/set?y=${year}`} className="btn">SPI set &amp; targets</Link></>}</>} />

      <div className="grid grid-cols-6 gap-4 mb-5 ov-today">
        <Link href="/safe/reports"><Metric label="To acknowledge" value={toAck} tone={toAck ? "amber" : undefined} hint="reports received" /></Link>
        <Link href="/safe/reports"><Metric label="MOR clocks" value={clocks.length} tone={late ? "red" : clocks.length ? "amber" : undefined} hint={late ? `${late} past 72 h` : "running"} /></Link>
        <Link href="/safe/reports"><Metric label="Open > 90 days" value={old} tone={old ? "amber" : undefined} hint={`${reps.length} open reports`} /></Link>
        <Link href="/safe/actions?st=late"><Metric label="Actions overdue" value={actLate} tone={actLate ? "red" : undefined} hint={`${A.length} open`} /></Link>
        <Link href="/safe/risk"><Metric label="Hazards to reassess" value={reassess} tone={reassess ? "amber" : undefined} hint="new occurrence linked" /></Link>
        <Link href="/safe/risk"><Metric label="Reviews overdue" value={reviewDue} tone={reviewDue ? "amber" : undefined} hint="hazard log" /></Link>
      </div>

      <section className="card mb-5">
        <div className="ch"><span className="eyebrow">Safety reports — last 24 months</span>
          <span className="mini ml-auto flex gap-3 items-center"><i className="lg" style={{ background: "var(--navy7)" }} />MOR<i className="lg" style={{ background: "var(--blue2)" }} />voluntary{rate.some((v) => v != null) && <><i className="lg ln" />rate {rb.short}{reportT != null ? ` (target ${reportT})` : ""}</>}</span></div>
        <div className="cb"><MonthBars months={m24} stacks={[{ label: "MOR", values: morN, color: "var(--navy7)" }, { label: "voluntary", values: repN.map((n, i) => n - morN[i]), color: "var(--blue2)" }]} line={rate.some((v) => v != null) ? { label: rb.short.replace("/", "per "), values: rate, color: "var(--cyan6)", target: reportT } : undefined} /></div>
      </section>

      <section className="card mb-5">
        <div className="ch"><span className="eyebrow">Safety performance indicators {year}</span>
          <span className="mini">data up to {monthShort(board.upTo)} · Q{board.quarter}</span>
          <span className="ml-auto flex gap-2"><span className="pill green">{count("ok")} on target</span><span className="pill amber">{count("improve")} to improve</span><span className="pill red">{count("far")} far off</span><span className="pill">{count("nodata") + count("none")} no data / target</span></span></div>
        {proposed.length > 0 && <div className="cb banner">{proposed.length} SPIs are <b>proposed</b> (taken from the ASJ set, same MSM family) and counted above as such — {edit ? <Link className="underline" href={`/safe/over/set?y=${year}`}>review and confirm the set</Link> : "the safety desk confirms them at the SRB"}.</div>}
        {needsHours && <div className="cb banner">No activity hours entered for {year} — the rates per 1000 BH / 100 FH stay empty.{edit && <> <Link className="underline" href={`/safe/over/data?y=${year}`}>Enter the hours</Link>.</>}</div>}
        {!rows.length && <div className="cb mini">No SPI defined for this entity yet.{edit && <> <Link className="underline" href={`/safe/over/set?y=${year}`}>Define the SPI set</Link>.</>}</div>}
        {rows.length > 0 && <table className="tbl spitbl">
          <thead><tr><th>Indicator</th><th style={{ width: 130 }}>Target {year}</th><th style={{ width: 290 }}>{board.months.map((m) => monthShort(m)[0]).join("  ")}</th><th style={{ width: 80 }}>Q{board.quarter}</th><th style={{ width: 80 }}>YTD</th><th style={{ width: 130 }}>Status</th></tr></thead>
          {groups.map((g) => (
            <tbody key={g}>
              <tr className="grp"><td colSpan={6}>{g}</td></tr>
              {rows.filter((r) => (r.objective ?? "Other") === g).map((r) => <SpiLineRow key={r.id} r={r} labels={labels} />)}
            </tbody>))}
        </table>}
      </section>

      {(edit || note) && <section className="card mb-5">
        <div className="ch"><span className="eyebrow">Safety performance — commentary for the SRB</span>{note && <span className="mini">Q{note.quarter} · {note.created_at.slice(0, 10)}{note.model ? " · draft prepared by SAM" : ""}</span>}
          {edit && <form action={draftCommentary} className="ml-auto"><input type="hidden" name="entity" value={e} /><input type="hidden" name="year" value={year} /><button className="btn">{note ? "Draft again" : "Draft the commentary"}</button></form>}</div>
        <div className="cb">
          {edit ? <form action={saveCommentary} className="grid gap-2"><input type="hidden" name="entity" value={e} /><input type="hidden" name="year" value={year} /><input type="hidden" name="quarter" value={board.quarter} />
            <textarea name="text" className="inp" rows={note ? 12 : 4} defaultValue={note?.text ?? ""} placeholder="SAM drafts a reading of the SPIs (off target, trends, data gaps, proposed decisions) — edit it and keep it for the SRB." />
            <div className="flex justify-end"><button className="btn primary">Keep this text</button></div></form>
            : <p style={{ whiteSpace: "pre-wrap" }}>{note?.text}</p>}
        </div>
      </section>}
    </>
  );
}

function SpiLineRow({ r, labels }: { r: SpiRow; labels: string[] }) {
  const vals = r.cells.map((c) => !c ? null : r.basis === "percent" ? (c.den != null ? (c.den ? String(Math.round((c.num / c.den) * 100)) : null) : String(Math.round(c.num))) : fmt(c.num, r.basis === "score" ? "score" : "count"));
  const v = VERDICT[r.ytdVerdict]; const src = r.metric ? `S.A.M. · ${METRICS[r.metric]?.label ?? r.metric}` : "entered monthly";
  return (
    <tr className={r.status === "proposed" ? "proposed" : ""}>
      <td><Link href={`/safe/over/spi/${r.id}`} className="hover:underline"><span className="mono">{r.code}</span> <b>{r.label}</b></Link><div className="mini">{AREA[r.area] ?? r.area} · {src}{r.status === "proposed" ? " · proposed" : ""}</div></td>
      <td className="mono">{targetText(r, r.t)}{r.t?.alert != null && <div className="mini">alert {fmt(r.t.alert, r.basis)}</div>}</td>
      <td><MonthCells values={vals} verdicts={r.monthVerdicts} labels={labels} />{BASIS[r.basis].den && <div className="mini">events per month — rate in Q / YTD</div>}</td>
      <td className="mono"><span className={"pill " + VERDICT[r.quarterVerdict][1]}>{fmt(r.quarter, r.basis)}</span></td>
      <td className="mono"><b>{fmt(r.ytd, r.basis)}</b>{r.ytdTarget?.target != null && r.ytdTarget.target !== r.t?.target && <div className="mini">expected {fmt(r.ytdTarget.target, r.basis)}</div>}</td>
      <td><span className={"pill " + v[1]}>{v[0]}</span>{r.offTwice && <div className="mini red">off target 2 months in a row → <Link className="underline" href={`/safe/over/spi/${r.id}#action`}>action</Link></div>}</td>
    </tr>
  );
}

async function GroupView({ ents, year, yearLinks }: { ents: string[]; year: number; yearLinks: React.ReactNode }) {
  const now = new Date(); const upTo = year < now.getUTCFullYear() ? `${year}-12` : now.toISOString().slice(0, 7);
  const months = Array.from({ length: Number(upTo.slice(5)) }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const data = await Promise.all(ents.map(async (e) => ({ e, b: await spiBoard(e, year), c: await computedMetrics(e, months) })));
  const sum = (c: Record<string, ({ num: number } | null)[]>, k: string) => c[k].reduce((t, x) => t + (x?.num ?? 0), 0);
  return (
    <>
      <PageHeader eyebrow="Safety · Safety assurance" title="Overview — Group view" sub={`Safety performance ${year} of every entity in your scope (to ${monthShort(upTo)}). Pick an entity in the top bar to work on its SPIs.`} right={yearLinks} />
      <section className="card">
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Reports</th><th>Reporting rate</th><th>MOR</th><th>ERC ≥ 100</th><th>Acc. + serious inc.</th><th>Open &gt; 90 d</th><th>Actions overdue</th><th>SPIs</th></tr></thead>
          <tbody>{data.map(({ e, b, c }) => {
            const rr = b.rows.find((r) => r.metric === "reports"); const act = b.rows.filter((r) => r.status === "active");
            return (
              <tr key={e}>
                <td><span className={"ent " + e}>{e}</span> <b>{ENT[e]?.name ?? e}</b></td>
                <td className="mono">{sum(c, "reports")}</td>
                <td className="mono">{rr && rr.ytd != null ? <>{fmt(rr.ytd, rr.basis)} {BASIS[rr.basis].short} <span className={"pill " + VERDICT[rr.ytdVerdict][1]}>{targetText(rr, rr.t)}</span></> : <span className="mini">{rr ? "hours not entered" : "—"}</span>}</td>
                <td className="mono">{sum(c, "mor")}</td><td className="mono">{sum(c, "significant")}</td><td className="mono">{sum(c, "acc_si")}</td>
                <td className="mono">{c.open90[c.open90.length - 1]?.num ?? 0}</td><td className="mono">{c.actions_late[c.actions_late.length - 1]?.num ?? 0}</td>
                <td>{act.length ? <span className="flex gap-1 flex-wrap"><span className="pill green">{act.filter((r) => r.ytdVerdict === "ok").length}</span><span className="pill amber">{act.filter((r) => r.ytdVerdict === "improve").length}</span><span className="pill red">{act.filter((r) => r.ytdVerdict === "far").length}</span></span> : <span className="mini">{b.rows.length ? `${b.rows.length} proposed` : "no SPI set"}</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </section>
    </>
  );
}
