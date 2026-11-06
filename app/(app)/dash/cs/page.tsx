import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { STEP_LABEL } from "@/lib/docs";
import { STAGE_LABEL, type Stage } from "@/lib/authority";
import { entityDash, type EntityDash } from "@/lib/dashboard";

/* DASH-CS · Compliance & Safety, one click: the working entity (or every entity in scope side by side in Group view).
 * Each tile is a number with its tone and a link to the list behind it. Updated live; the Teams digest and the SRB pack use the same figures. */
export default async function ComplianceSafetyDash() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!["cmm", "am"].includes(s.role)) redirect("/home/tasks");
  const db = supabaseAdmin();
  const ents = s.entity === "ALL" ? ENTS4.filter((e) => s.group || s.entities.includes(e)) : [s.entity];
  const dashes = await Promise.all(ents.map((e) => entityDash(db, e)));
  const multi = dashes.length > 1;
  return (
    <>
      <PageHeader eyebrow="Dashboards · Compliance & Safety" title="Compliance & Safety" sub={`${multi ? "All entities" : ENT[ents[0]]?.name ?? ents[0]} today: documents, authority files, findings, regulatory watch, safety. Click a line or a number to open the list.`} right={<Link className="btn" href="/dash/cs/overdue">Overdue by post</Link>} />
      <div className={multi ? "grid gap-4" : ""} style={multi ? { gridTemplateColumns: `repeat(${dashes.length}, minmax(0, 1fr))` } : undefined}>
        {dashes.map((d) => <EntityColumn key={d.entity} d={d} compact={multi} />)}
      </div>
    </>
  );
}

/* DA v3 (06/11) · no framed tiles inside cards (Hallmark gate 4): "Attention today" is a list sorted by severity with a tinted
 * background per line; the other areas share one sheet, each cell with the 3 px state rule used on every figure card. */
type Tone = "amber" | "red" | "green" | undefined;
type Fig = { label: string; value: string | number; tone?: Tone; href?: string; hint?: string };
const SEV: Record<string, string> = { red: "critical", amber: "late" };

function Attention({ rows, date }: { rows: Fig[]; date: string }) {
  const order = (t: Tone) => (t === "red" ? 0 : t === "amber" ? 1 : 2);
  const hot = rows.filter((r) => r.tone === "red" || r.tone === "amber").sort((a, b) => order(a.tone) - order(b.tone));
  const clear = rows.filter((r) => !(r.tone === "red" || r.tone === "amber"));
  return (
    <section className="card">
      <div className="ch"><span className="eyebrow">Attention today</span><span className="mini">{date}</span></div>
      <div className="attlist">
        {hot.map((r) => {
          const row = <><b className="attn">{r.value}</b><span className="attl">{r.label}{r.hint && <small>{r.hint}</small>}</span><span className="atts">{SEV[r.tone ?? ""] ?? ""}</span></>;
          return r.href ? <Link key={r.label} href={r.href} className={"attrow " + r.tone}>{row}</Link> : <div key={r.label} className={"attrow " + r.tone}>{row}</div>;
        })}
        {clear.length > 0 && <p className="attclear">{hot.length ? "Nothing pending for " : "Nothing needs you today: "}{clear.map((r) => r.label.toLowerCase()).join(", ")}.</p>}
      </div>
    </section>
  );
}

function areaTone(figs: Fig[]): string {
  if (figs.some((f) => f.tone === "red")) return "red";
  if (figs.some((f) => f.tone === "amber")) return "amber";
  if (figs.every((f) => f.value === 0 || f.value === "0")) return "none";
  if (figs.some((f) => f.tone === "green")) return "green";
  return "info";
}

function Area({ title, link, figs }: { title: string; link: { href: string; label: string }; figs: Fig[] }) {
  return (
    <div className={"area st-" + areaTone(figs)}>
      <div className="areah"><b>{title}</b><Link href={link.href}>{link.label}</Link></div>
      <div className="areafigs">
        {figs.map((f) => {
          const zero = f.value === 0 || f.value === "0";
          const inner = <><strong className={f.tone === "red" || f.tone === "amber" ? f.tone : zero ? "zero" : ""}>{f.value}</strong><span>{f.label}</span>{f.hint && <small>{f.hint}</small>}</>;
          return f.href ? <Link key={f.label} href={f.href} className="areafig">{inner}</Link> : <div key={f.label} className="areafig">{inner}</div>;
        })}
      </div>
    </div>
  );
}

function EntityColumn({ d, compact }: { d: EntityDash; compact: boolean }) {
  const p = d.safety;
  const steps = Object.entries(d.docs.byStep).sort((a, b) => b[1] - a[1]);
  const stages = Object.entries(d.files.byStage).sort((a, b) => b[1] - a[1]);
  const attention: Fig[] = [
    { label: "Overdue items", value: d.overdue.total, tone: d.overdue.total ? (d.overdue.am ? "red" : "amber") : "green", href: "/dash/cs/overdue", hint: d.overdue.escalated ? `${d.overdue.escalated} escalated, ${d.overdue.am} at the AM` : undefined },
    { label: "Findings past due", value: d.findings.late, tone: d.findings.late ? "red" : "green", href: "/comp/find?tab=open" },
    { label: "Files late at the authority", value: d.files.late, tone: d.files.late ? "amber" : "green", href: "/proj/auth" },
    { label: "Watch streams to check", value: d.watch.late, tone: d.watch.late ? "amber" : "green", href: "/comp/watch" },
    ...(p ? [
      { label: "Safety actions overdue", value: p.actions.late, tone: (p.actions.late ? "red" : "green") as Tone, href: "/safe/actions" },
      { label: "Reports open over 90 days", value: p.reports.openOld, tone: (p.reports.openOld ? "amber" : "green") as Tone, href: "/safe/reports" },
    ] : []),
  ];
  return (
    <div className="grid gap-3">
      {compact && <div className="entband" style={{ borderLeftColor: ENT_COLOR[d.entity] }}><b>{ENT[d.entity]?.name ?? d.entity}</b><span>{d.entity}, {ENT[d.entity]?.qual}, {ENT[d.entity]?.auth}</span></div>}
      <Attention rows={attention} date={d.t0} />
      <section className={"card areas" + (compact ? " one" : "")}>
        <Area title="Documents" link={{ href: "/docs/drafts", label: "Open drafts" }} figs={[
          { label: "manuals", value: d.docs.manuals, href: "/docs/lib" },
          { label: "in revision", value: d.docs.drafts, href: "/docs/drafts", hint: steps.map(([k, v]) => `${v} ${STEP_LABEL[k] ?? k}`).join(", ") || undefined },
          { label: "with civil aviation", value: d.docs.atAuthority, tone: d.docs.atAuthority ? "amber" : undefined, href: "/proj/auth" },
        ]} />
        <Area title="CAA applications" link={{ href: "/proj/auth", label: "Open all files" }} figs={[
          { label: "open", value: d.files.open, href: "/proj/auth", hint: stages.map(([k, v]) => `${v} ${STAGE_LABEL[k as Stage] ?? k}`).join(", ") || undefined },
          { label: "past target date", value: d.files.late, tone: d.files.late ? "amber" : undefined, href: "/proj/auth" },
        ]} />
        <Area title="Findings" link={{ href: "/comp/find", label: "Open all findings" }} figs={[
          { label: "open", value: d.findings.open, href: "/comp/find?tab=open", hint: d.findings.level1 ? `${d.findings.level1} level 1` : undefined, tone: d.findings.level1 ? "red" : undefined },
          { label: "with the NP", value: d.findings.npTurn, href: "/comp/find?tab=open" },
          { label: "to review", value: d.findings.cmmTurn, tone: d.findings.cmmTurn ? "amber" : undefined, href: "/comp/find?tab=review" },
          { label: "plan in progress", value: d.findings.inPlan, href: "/comp/find?tab=open" },
        ]} />
        <Area title="Regulatory watch" link={{ href: "/comp/watch", label: "Open streams and entries" }} figs={[
          { label: "streams", value: d.watch.streams, href: "/comp/watch", hint: d.watch.late ? `${d.watch.late} to check now` : "all checked on time", tone: d.watch.late ? "amber" : "green" },
          { label: "open entries", value: d.watch.entries, href: "/comp/watch?tab=open", tone: d.watch.entriesLate ? "amber" : undefined, hint: d.watch.entriesLate ? `${d.watch.entriesLate} past return date` : undefined },
          { label: "to analyse", value: d.watch.toAnalyse, href: "/comp/watch?tab=analyse" },
        ]} />
        {p && <Area title={`Safety since the last SRB${p.since ? `, ${p.since.slice(0, 10)}` : ""}`} link={{ href: "/safe/over", label: "Open the overview" }} figs={[
          { label: "reports", value: p.reports.total, href: "/safe/reports", hint: `${p.reports.mor} MOR, ${p.reports.significant} ERC ≥ 100, ${p.reports.open} open` },
          { label: "SPI on target", value: `${p.spiCounts.ok ?? 0} / ${p.spi.length}`, tone: (p.spiCounts.far ?? 0) ? "red" : (p.spiCounts.improve ?? 0) ? "amber" : "green", href: "/safe/over", hint: `${p.spiCounts.improve ?? 0} to improve, ${p.spiCounts.far ?? 0} far off` },
          { label: "hazards", value: p.hazards.log, href: "/safe/risk", hint: `${p.hazards.red.length} intolerable, ${p.hazards.reviewDue} reviews due`, tone: p.hazards.red.length ? "red" : p.hazards.reviewDue ? "amber" : undefined },
          { label: "safety actions", value: p.actions.open, href: "/safe/actions", hint: `${p.actions.late} overdue, ${p.actions.doneSince} done`, tone: p.actions.late ? "amber" : undefined },
          { label: "change files", value: p.changes.length, href: "/safe/moc" },
        ]} />}
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Overdue by post</span><Link className="mini" href="/dash/cs/overdue">Open the full table</Link></div>
        <div className="cb" style={{ padding: 0 }}>{d.overdue.groups.length ? <table className="tbl"><tbody>{d.overdue.groups.slice(0, 6).map((g) => <tr key={g.owner}><td>{g.owner}{g.isPerson ? "" : " (post)"}</td><td style={{ textAlign: "right" }}><span className={"pill " + (g.worst > 15 ? "red" : g.worst > 7 ? "amber" : "")}>{g.count} item{g.count === 1 ? "" : "s"}, worst {g.worst} d</span></td></tr>)}</tbody></table> : <p className="p-3 mini">Nothing overdue.</p>}</div>
      </section>
    </div>
  );
}
