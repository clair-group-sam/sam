import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { KPI_DEFS, KPI_STATUS_LABEL, KPI_STATUS_TONE } from "@/lib/compliance-kpi";
import { managementReview, type Review } from "@/lib/management-review";

/* DASH-MR · Dashboards › CODIR / SRB: the management review of the working entity, laid out as the board reads it —
 * what needs the AM, compliance (MSM §2.6), the audit programme, findings and the authority, safety since the last board,
 * the boards themselves. Group view: every entity side by side, headline figures only. Each figure is a link to its list. */
export default async function CodirDash({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  if (!["cmm", "am"].includes(s.role)) redirect("/home/tasks");
  const { view } = await searchParams;
  const db = supabaseAdmin();
  const ents = s.entity === "ALL" || view === "group" ? ENTS4.filter((e) => s.group || s.entities.includes(e)) : [s.entity];
  const group = ents.length > 1;
  const rs = await Promise.all(ents.map((e) => managementReview(db, e)));
  return (
    <>
      <PageHeader eyebrow="Dashboards, CODIR / SRB" title={group ? "Management review, group view" : `Management review, ${ENT[ents[0]]?.name ?? ents[0]}`}
        sub={group ? "Every entity side by side: what the boards look at, headline figures, today." : `What the ${rs[0].boards.kindLabel} looks at, today: decisions pending, compliance indicators, audit programme, findings, authority, safety since the last board. Same figures as the SRB pack.`}
        right={<div className="flex gap-2">{(s.group || s.entities.length > 1) && <Link className="btn" href={group ? "/dash/codir" : "/dash/codir?view=group"}>{group ? "One entity" : "Group view"}</Link>}<Link className="btn" href="/dash/cs">Compliance & Safety</Link></div>} />
      {group ? <GroupView rs={rs} /> : <OneEntity r={rs[0]} />}
    </>
  );
}

type Tone = "red" | "amber" | "green" | "info" | "none";
const tone = (bad: number, warn = 0): Tone => (bad ? "red" : warn ? "amber" : "green");
function Fig({ label, value, tone: t, href, hint }: { label: string; value: string | number; tone?: Tone; href?: string; hint?: string }) {
  const zero = value === 0 || value === "0";
  const inner = <><strong className={t === "red" || t === "amber" ? t : zero ? "zero" : ""}>{value}</strong><span>{label}</span>{hint && <small>{hint}</small>}</>;
  return href ? <Link href={href} className="areafig">{inner}</Link> : <div className="areafig">{inner}</div>;
}
function Area({ title, link, tone: t, children }: { title: string; link?: { href: string; label: string }; tone: Tone; children: React.ReactNode }) {
  return <div className={"area st-" + t}><div className="areah"><b>{title}</b>{link && <Link href={link.href}>{link.label}</Link>}</div><div className="areafigs">{children}</div></div>;
}
const d10 = (x: string | null | undefined) => (x ? x.slice(0, 10) : "");

function Headline({ r, compact }: { r: Review; compact?: boolean }) {
  const p = r.safety; const k = r.kpi;
  const figs = [
    { label: "for the AM to decide", value: r.decisions.am + r.overdue.am, tone: tone(r.decisions.am + r.overdue.am ? 1 : 0), href: "/home/tasks" },
    { label: "compliance indicators on target", value: `${k.on} / ${k.on + k.alert + k.off}`, tone: tone(k.off, k.alert), href: "/comp/kpi", hint: `${k.alert} alert, ${k.off} off target` },
    { label: "SPI on target", value: p ? `${p.spiCounts.ok ?? 0} / ${p.spi.length}` : "—", tone: p ? tone(p.spiCounts.far ?? 0, p.spiCounts.improve ?? 0) : "none", href: "/safe/over" },
    { label: `audits ${r.programme.year}`, value: `${r.programme.done} / ${r.programme.planned}`, tone: tone(r.programme.late, r.programme.running), href: "/comp/prog", hint: `${r.programme.running} running, ${r.programme.late} month passed` },
    { label: "findings open", value: r.findings.open, tone: tone(r.findings.late || r.findings.level1, r.findings.cmmTurn), href: "/comp/find?tab=open", hint: `${r.findings.late} past due, ${r.findings.level1} level 1` },
    { label: `MOR ${r.mor.year}`, value: r.mor.filed, tone: tone(r.mor.pending, r.mor.late), href: "/safe/mor", hint: `${r.mor.late} filed late, ${r.mor.pending} pending` },
    { label: "overdue items", value: r.overdue.total, tone: tone(r.overdue.am, r.overdue.total), href: "/dash/cs/overdue", hint: `${r.overdue.escalated} escalated` },
  ];
  return (
    <section className={"card areas" + (compact ? " one" : "")} style={compact ? undefined : { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {figs.map((f) => <div key={f.label} className={"area st-" + f.tone}><Fig {...f} /></div>)}
    </section>
  );
}

function OneEntity({ r }: { r: Review }) {
  const p = r.safety; const b = r.boards;
  return (
    <div className="grid gap-4">
      <Headline r={r} />
      <section className="card areas">
        <Area title={`Boards, ${b.kindLabel}`} link={{ href: "/safe/comm", label: "Open the committees" }} tone={b.next ? "green" : "amber"}>
          <Fig label={b.last ? `last ${b.kindLabel}, ${d10(b.last.starts_at ?? b.last.planned_on)}` : `no ${b.kindLabel} held yet`} value={b.last ? b.last.number : "—"} href={b.last ? `/safe/comm/${b.last.id}` : undefined} hint={b.last ? `${b.last.decided} decisions recorded` : undefined} />
          <Fig label="actions from it still open" value={b.openActions} tone={b.openActions ? "amber" : undefined} href="/safe/actions" />
          <Fig label={b.next ? `next, ${d10(b.next.planned_on)}` : "next board"} value={b.next ? b.next.number : "not planned"} tone={b.next ? undefined : "amber"} href={b.next ? `/safe/comm/${b.next.id}` : "/safe/comm"} />
          <Fig label="decisions pending, AM" value={r.decisions.am} tone={r.decisions.am ? "amber" : undefined} href="/home/tasks" />
          <Fig label="pending, CMM / SM" value={r.decisions.cmm} href="/home/tasks" />
        </Area>
        <Area title="Compliance indicators, MSM §2.6" link={{ href: "/comp/kpi", label: "Open the indicators" }} tone={tone(r.kpi.off, r.kpi.alert)}>
          {KPI_DEFS.map((d) => { const v = r.kpi.values.find((x) => x.code === d.code); const t = r.kpi.targets.find((x) => x.code === d.code);
            const val = v?.value == null ? "—" : d.unit === "%" ? `${v.value.toFixed(0)} %` : d.unit === "d" ? `${v.value.toFixed(0)} d` : String(v.value);
            return <Fig key={d.code} label={`${d.code}, ${KPI_STATUS_LABEL[v?.status ?? "n_a"]?.toLowerCase() ?? ""}`} value={val} tone={(KPI_STATUS_TONE[v?.status ?? "n_a"] || undefined) as Tone | undefined} href="/comp/kpi" hint={`${d.label.slice(0, 60)}${t ? `, target ${d.dir} ${t.target}${d.unit === "%" ? " %" : ""}` : ""}`} />; })}
        </Area>
        <Area title={`Audit programme ${r.programme.year}`} link={{ href: "/comp/prog", label: "Open the programme" }} tone={tone(r.programme.late, r.programme.running)}>
          <Fig label="planned this year" value={r.programme.planned} href="/comp/prog" hint={`${r.programme.authority} by the authority, ${r.programme.subcontractor} subcontractors`} />
          <Fig label="done" value={r.programme.done} href="/comp/audits" />
          <Fig label="in progress or report" value={r.programme.running} tone={r.programme.running ? "amber" : undefined} href="/comp/audits" />
          <Fig label="month passed, not started" value={r.programme.late} tone={r.programme.late ? "red" : undefined} href="/comp/prog" />
          <Fig label="cancelled" value={r.programme.cancelled} href="/comp/prog" />
        </Area>
        <Area title="Findings" link={{ href: "/comp/find", label: "Open the findings" }} tone={tone(r.findings.late || r.findings.level1, r.findings.cmmTurn)}>
          <Fig label="open" value={r.findings.open} href="/comp/find?tab=open" />
          <Fig label="level 1" value={r.findings.level1} tone={r.findings.level1 ? "red" : undefined} href="/comp/find?tab=open" />
          <Fig label="past due" value={r.findings.late} tone={r.findings.late ? "red" : undefined} href="/comp/find?tab=open" />
          <Fig label="with the NP" value={r.findings.npTurn} href="/comp/find?tab=open" />
          <Fig label="waiting for Compliance" value={r.findings.cmmTurn} tone={r.findings.cmmTurn ? "amber" : undefined} href="/comp/find?tab=review" />
        </Area>
        <Area title="Authority and documents" link={{ href: "/proj/auth", label: "Open the applications" }} tone={tone(0, r.files.late + r.docs.atAuthority)}>
          <Fig label="applications open" value={r.files.open} href="/proj/auth" />
          <Fig label="past target date" value={r.files.late} tone={r.files.late ? "amber" : undefined} href="/proj/auth" />
          <Fig label="manuals with civil aviation" value={r.docs.atAuthority} tone={r.docs.atAuthority ? "amber" : undefined} href="/proj/auth" />
          <Fig label="manuals in revision" value={r.docs.drafts} href="/docs/drafts" />
          <Fig label="watch streams to check" value={r.watch.late} tone={r.watch.late ? "amber" : undefined} href="/comp/watch" />
          <Fig label="watch entries to analyse" value={r.watch.toAnalyse} href="/comp/watch?tab=analyse" />
        </Area>
        {p && <Area title={`Safety since the last ${b.kindLabel}${p.since ? `, ${d10(p.since)}` : ""}`} link={{ href: "/safe/over", label: "Open the overview" }} tone={tone(p.hazards.red.length + p.actions.late, (p.spiCounts.improve ?? 0) + p.reports.openOld)}>
          <Fig label="reports" value={p.reports.total} href="/safe/reports" hint={`${p.reports.mor} MOR, ${p.reports.significant} ERC ≥ 100, ${p.reports.open} open`} />
          <Fig label="open over 90 days" value={p.reports.openOld} tone={p.reports.openOld ? "amber" : undefined} href="/safe/reports" />
          <Fig label="MOR filed this year" value={r.mor.filed} hint={`${r.mor.late} after the 72 h, ${r.mor.pending} pending`} tone={r.mor.pending ? "red" : r.mor.late ? "amber" : undefined} href="/safe/mor" />
          <Fig label="SPI to improve / far off" value={`${p.spiCounts.improve ?? 0} / ${p.spiCounts.far ?? 0}`} tone={(p.spiCounts.far ?? 0) ? "red" : (p.spiCounts.improve ?? 0) ? "amber" : undefined} href="/safe/over" />
          <Fig label="hazards intolerable" value={p.hazards.red.length} tone={p.hazards.red.length ? "red" : undefined} href="/safe/risk" hint={`${p.hazards.log} in the log, ${p.hazards.reviewDue} reviews due`} />
          <Fig label="safety actions overdue" value={p.actions.late} tone={p.actions.late ? "red" : undefined} href="/safe/actions" hint={`${p.actions.open} open, ${p.actions.doneSince} done since`} />
          <Fig label="change files" value={p.changes.length} href="/safe/moc" />
        </Area>}
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Overdue by post</span><Link className="mini" href="/dash/cs/overdue">Open the full table</Link></div>
        <div className="cb" style={{ padding: 0 }}>{r.overdue.groups.length ? <table className="tbl"><tbody>{r.overdue.groups.slice(0, 8).map((g) => <tr key={g.owner}><td>{g.owner}{g.isPerson ? "" : " (post)"}</td><td style={{ textAlign: "right" }}><span className={"pill " + (g.worst > 15 ? "red" : g.worst > 7 ? "amber" : "")}>{g.count} item{g.count === 1 ? "" : "s"}, worst {g.worst} d</span></td></tr>)}</tbody></table> : <p className="p-4 mini">Nothing overdue.</p>}</div>
      </section>
      {p && p.spi.some((x) => x.off) && <section className="card">
        <div className="ch"><span className="eyebrow">SPI off target, year to date</span><Link className="mini" href="/safe/over">Open the SPI board</Link></div>
        <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>SPI</th><th>Target</th><th>YTD</th><th>Verdict</th></tr></thead><tbody>{p.spi.filter((x) => x.off).map((x) => <tr key={x.code}><td><b>{x.code}</b> {x.label}</td><td>{x.target}</td><td>{x.ytd}</td><td><span className={"pill " + (x.verdict === "far off" ? "red" : "amber")}>{x.verdict}</span></td></tr>)}</tbody></table></div>
      </section>}
    </div>
  );
}

function GroupView({ rs }: { rs: Review[] }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${rs.length}, minmax(0, 1fr))` }}>
      {rs.map((r) => <div key={r.entity} className="grid gap-3">
        <div className={"entband " + r.entity} style={{ borderLeftColor: ENT_COLOR[r.entity] }}><b>{ENT[r.entity]?.name ?? r.entity}</b><span>{ENT[r.entity]?.qual}, {ENT[r.entity]?.auth}</span></div>
        <Headline r={r} compact />
        <p className="mini">{r.boards.last ? `Last ${r.boards.kindLabel} ${d10(r.boards.last.starts_at ?? r.boards.last.planned_on)}` : `No ${r.boards.kindLabel} held yet`}{r.boards.next ? `, next ${d10(r.boards.next.planned_on)}` : ", next not planned"}.</p>
      </div>)}
    </div>
  );
}
