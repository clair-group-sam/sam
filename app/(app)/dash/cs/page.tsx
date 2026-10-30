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
      <PageHeader eyebrow="Dashboards · Compliance & Safety" title={multi ? "Compliance & Safety — all entities" : `Compliance & Safety — ${ENT[ents[0]]?.name ?? ents[0]}`} sub="Where each entity stands today: documents, authority files, findings, regulatory watch, safety, overdue items. Click a number to open the list." right={<Link className="btn" href="/dash/cs/overdue">Overdue by post</Link>} />
      <div className={multi ? "grid gap-4" : ""} style={multi ? { gridTemplateColumns: `repeat(${dashes.length}, minmax(0, 1fr))` } : undefined}>
        {dashes.map((d) => <EntityColumn key={d.entity} d={d} compact={multi} />)}
      </div>
    </>
  );
}

function Tile({ label, value, tone, href, hint }: { label: string; value: string | number; tone?: "amber" | "red" | "green"; href?: string; hint?: string }) {
  const inner = <div className={"tile " + (tone ?? "")}><div className="tv">{value}</div><div className="tl">{label}</div>{hint && <div className="th">{hint}</div>}</div>;
  return href ? <Link href={href} className="tilelink">{inner}</Link> : inner;
}

function EntityColumn({ d, compact }: { d: EntityDash; compact: boolean }) {
  const p = d.safety;
  const steps = Object.entries(d.docs.byStep).sort((a, b) => b[1] - a[1]);
  const stages = Object.entries(d.files.byStage).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-3">
      {compact && <div className="entband" style={{ borderLeftColor: ENT_COLOR[d.entity] }}><b>{ENT[d.entity]?.name ?? d.entity}</b><span>{d.entity} · {ENT[d.entity]?.qual} · {ENT[d.entity]?.auth}</span></div>}
      <section className="card">
        <div className="ch"><span className="eyebrow">Attention today</span><span className="mini">{d.t0}</span></div>
        <div className="cb tiles">
          <Tile label="Overdue items" value={d.overdue.total} tone={d.overdue.total ? (d.overdue.am ? "red" : "amber") : "green"} href="/dash/cs/overdue" hint={d.overdue.escalated ? `${d.overdue.escalated} escalated · ${d.overdue.am} at the AM` : undefined} />
          <Tile label="Findings past due" value={d.findings.late} tone={d.findings.late ? "red" : "green"} href="/comp/find?tab=open" />
          <Tile label="Files late at the authority" value={d.files.late} tone={d.files.late ? "amber" : "green"} href="/proj/auth" />
          <Tile label="Watch streams to check" value={d.watch.late} tone={d.watch.late ? "amber" : "green"} href="/comp/watch" />
          {p && <Tile label="Safety actions overdue" value={p.actions.late} tone={p.actions.late ? "red" : "green"} href="/safe/actions" />}
          {p && <Tile label="Reports open > 90 d" value={p.reports.openOld} tone={p.reports.openOld ? "amber" : "green"} href="/safe/reports" />}
        </div>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Documents</span><Link className="mini" href="/docs/drafts">Drafts in progress →</Link></div>
        <div className="cb tiles">
          <Tile label="Manuals" value={d.docs.manuals} href="/docs/lib" />
          <Tile label="Revisions in progress" value={d.docs.drafts} href="/docs/drafts" hint={steps.map(([k, v]) => `${v} ${STEP_LABEL[k] ?? k}`).join(" · ") || undefined} />
          <Tile label="With civil aviation" value={d.docs.atAuthority} tone={d.docs.atAuthority ? "amber" : undefined} href="/proj/auth" />
        </div>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">CAA applications</span><Link className="mini" href="/proj/auth">All files →</Link></div>
        <div className="cb tiles">
          <Tile label="Open files" value={d.files.open} href="/proj/auth" hint={stages.map(([k, v]) => `${v} ${STAGE_LABEL[k as Stage] ?? k}`).join(" · ") || undefined} />
          <Tile label="Past target date" value={d.files.late} tone={d.files.late ? "amber" : undefined} href="/proj/auth" />
        </div>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Findings</span><Link className="mini" href="/comp/find">All findings →</Link></div>
        <div className="cb tiles">
          <Tile label="Open" value={d.findings.open} href="/comp/find?tab=open" hint={d.findings.level1 ? `${d.findings.level1} level 1` : undefined} tone={d.findings.level1 ? "red" : undefined} />
          <Tile label="With the NP" value={d.findings.npTurn} href="/comp/find?tab=open" />
          <Tile label="To review (Compliance)" value={d.findings.cmmTurn} tone={d.findings.cmmTurn ? "amber" : undefined} href="/comp/find?tab=review" />
          <Tile label="Plan in progress" value={d.findings.inPlan} href="/comp/find?tab=open" />
        </div>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Regulatory watch</span><Link className="mini" href="/comp/watch">Streams & entries →</Link></div>
        <div className="cb tiles">
          <Tile label="Streams" value={d.watch.streams} href="/comp/watch" hint={d.watch.late ? `${d.watch.late} to check now` : "all checked on time"} tone={d.watch.late ? "amber" : "green"} />
          <Tile label="Open entries" value={d.watch.entries} href="/comp/watch?tab=open" tone={d.watch.entriesLate ? "amber" : undefined} hint={d.watch.entriesLate ? `${d.watch.entriesLate} past return date` : undefined} />
          <Tile label="To analyse" value={d.watch.toAnalyse} href="/comp/watch?tab=analyse" />
        </div>
      </section>
      {p && (
        <section className="card">
          <div className="ch"><span className="eyebrow">Safety — since the last SRB{p.since ? ` (${p.since.slice(0, 10)})` : ""}</span><Link className="mini" href="/safe/over">Overview →</Link></div>
          <div className="cb tiles">
            <Tile label="Reports" value={p.reports.total} href="/safe/reports" hint={`${p.reports.mor} MOR · ${p.reports.significant} ERC ≥ 100 · ${p.reports.open} open`} />
            <Tile label="SPI on target" value={`${p.spiCounts.ok ?? 0} / ${p.spi.length}`} tone={(p.spiCounts.far ?? 0) ? "red" : (p.spiCounts.improve ?? 0) ? "amber" : "green"} href="/safe/over" hint={`${p.spiCounts.improve ?? 0} to improve · ${p.spiCounts.far ?? 0} far off`} />
            <Tile label="Hazards" value={p.hazards.log} href="/safe/risk" hint={`${p.hazards.red.length} intolerable · ${p.hazards.reviewDue} reviews due`} tone={p.hazards.red.length ? "red" : p.hazards.reviewDue ? "amber" : undefined} />
            <Tile label="Safety actions" value={p.actions.open} href="/safe/actions" hint={`${p.actions.late} overdue · ${p.actions.doneSince} done`} tone={p.actions.late ? "amber" : undefined} />
            <Tile label="Change files" value={p.changes.length} href="/safe/moc" />
          </div>
        </section>
      )}
      <section className="card">
        <div className="ch"><span className="eyebrow">Overdue by post</span><Link className="mini" href="/dash/cs/overdue">Full table →</Link></div>
        <div className="cb" style={{ padding: 0 }}>{d.overdue.groups.length ? <table className="tbl"><tbody>{d.overdue.groups.slice(0, 6).map((g) => <tr key={g.owner}><td>{g.owner}{g.isPerson ? "" : " (post)"}</td><td style={{ textAlign: "right" }}><span className={"pill " + (g.worst > 15 ? "red" : g.worst > 7 ? "amber" : "")}>{g.count} · worst {g.worst} d</span></td></tr>)}</tbody></table> : <p className="p-3 mini">Nothing overdue.</p>}</div>
      </section>
    </div>
  );
}
