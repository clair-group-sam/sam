import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { addMonths, coverage, current, type Audit, type AuditModule, type Programme } from "@/lib/audit-programme";
import { auditorRoster, controlOf, daysTo, nextDueOf, type Auditor, type CCheck, type Subcontractor, withProgrammeHistory } from "@/lib/compliance-registers";
import { CMM_TURN, NP_TURN, OPEN_STATUSES as FND_OPEN } from "@/lib/findings";
import { Icon } from "@/lib/icons";
import { OPEN_STATUSES as WATCH_OPEN } from "@/lib/watch";
import { today } from "@/lib/authority";
import { computeKpis } from "@/lib/compliance-kpi";

/* COMP-00 · Compliance overview, redone 10/11 (Guillaume: « trop d'informations, pas classé, pas visuel »). Per entity: what needs attention first,
 * then three families — Surveillance (are we checking?), Findings (what is open?), Means (people, indicators, texts) — each a bar or a count you
 * read at a glance, each a link to its list. Every number computed live. */
type Tone = "red" | "amber" | "green" | "";
type Part = { n: number; tone: Tone | "blue" | "grey"; label: string };
type Alert = { tone: "red" | "amber"; text: string; href: string };
const Bar = ({ parts }: { parts: Part[] }) => { const t = parts.reduce((a, p) => a + p.n, 0); return <div className="ovbar" aria-hidden="true">{t ? parts.filter((p) => p.n).map((p, i) => <i key={i} className={p.tone} style={{ flex: p.n }} title={`${p.n} ${p.label}`} />) : <i className="grey" style={{ flex: 1 }} />}</div>; };
const Legend = ({ parts }: { parts: Part[] }) => <div className="ovleg">{parts.filter((p) => p.n).map((p, i) => <span key={i}><b className={p.tone} />{p.n} {p.label}</span>)}</div>;
function Row({ href, label, value, sub, parts, tone }: { href: string; label: string; value: string | number; sub?: string; parts?: Part[]; tone?: Tone }) {
  return <Link href={href} className={"ovrow " + (tone ?? "")}><div className="ovtop"><span className="ovl">{label}</span><span className="ovv">{value}</span></div>{parts && <><Bar parts={parts} /><Legend parts={parts} /></>}{sub && <div className="ovs">{sub}</div>}</Link>;
}
export default async function ComplianceOverview() {
  const s = await getSession(); if (!s) redirect("/login");
  const scope = s.entity === "ALL" ? (s.group ? ENTS4 : s.entities) : [s.entity];
  const db = supabaseAdmin(); const t0 = today();
  const [{ data: pd }, { data: ad }, { data: cd }, { data: fd }, { data: wd }, { data: rd }, { data: aud }, { data: sd }, { data: md }, { data: ppl }, { data: its }, { data: dcs }] = await Promise.all([
    db.from("audit_programmes").select("*").in("entity", scope),
    db.from("audits").select("*").in("entity", scope).limit(5000),
    db.from("compliance_checks").select("*").in("entity", scope).eq("active", true),
    db.from("findings").select("id,entity,status,due,level,source").in("entity", scope).limit(5000),
    db.from("watch_entries").select("id,entity,status,applicability,due").in("entity", scope).limit(5000),
    db.from("regulations").select("id,entities,check_result,items_count").eq("active", true),
    db.from("auditors").select("*"),
    db.from("subcontractors").select("*").in("entity", scope).eq("active", true),
    db.from("audit_modules").select("*"),
    db.from("people").select("id,display_name").limit(800),
    db.from("auditor_items").select("auditor_id,done").limit(5000),
    db.from("auditor_docs").select("auditor_id").limit(5000),
  ]);
  const progs = (pd ?? []) as Programme[], audits = (ad ?? []) as (Audit & { subcontractor_id: string | null })[], checks = await withProgrammeHistory(db, (cd ?? []) as CCheck[]);
  const findings = (fd ?? []) as { id: string; entity: string; status: string; due: string | null; level: string; source: string }[];
  const watch = (wd ?? []) as { id: string; entity: string; status: string; applicability: string; due: string | null }[];
  const regs = (rd ?? []) as { id: string; entities: string[]; check_result: string | null; items_count: number | null }[];
  const auditors = (aud ?? []) as Auditor[], subs = (sd ?? []) as Subcontractor[], mods = (md ?? []) as AuditModule[];
  const cur = current(progs, t0);
  const kpis = Object.fromEntries(await Promise.all(scope.map(async (e) => [e, (await computeKpis(db, e, t0)).values] as const)));
  const cards = scope.map((e) => {
    const alerts: Alert[] = [];
    // — Surveillance
    const p = cur.find((x) => x.entity === e) ?? null;
    const pa = p ? audits.filter((a) => a.programme_id === p.id) : [];
    const cov = p ? coverage(p, mods.filter((m) => m.programme_id === p.id), pa, t0) : null;
    const elapsed = p ? Math.max(0, Math.min(100, Math.round((100 * (Date.parse(t0) - Date.parse(p.starts_on))) / (Date.parse(p.ends_on) - Date.parse(p.starts_on))))) : 0;
    const ea = audits.filter((a) => a.entity === e && a.kind !== "authority");
    const late = ea.filter((a) => a.status === "planned" && addMonths(a.planned_month, 1) <= t0);
    if (!p) alerts.push({ tone: "amber", text: "No audit programme in force", href: "/comp/prog" });
    if (late.length) alerts.push({ tone: "red", text: `${late.length} audit${late.length > 1 ? "s" : ""} not started, month passed`, href: "/comp/audits" });
    if (cov && cov.modulesWithout.length + cov.gaps.length) alerts.push({ tone: "amber", text: `${cov.modulesWithout.length + cov.gaps.length} area${cov.modulesWithout.length + cov.gaps.length > 1 ? "s" : ""} of the programme without an audit`, href: p ? `/comp/prog/${p.id}` : "/comp/prog" });
    const reports = ea.filter((a) => a.status === "report").length;
    if (reports) alerts.push({ tone: "amber", text: `${reports} audit report${reports > 1 ? "s" : ""} to close`, href: "/comp/audits" });
    const ch = checks.filter((c) => c.entity === e).map((c) => daysTo(nextDueOf(c), t0));
    const chPast = ch.filter((d) => d !== null && d < 0).length, chSoon = ch.filter((d) => d !== null && d >= 0 && d <= 30).length, chNone = ch.filter((d) => d === null).length, chOk = ch.length - chPast - chSoon - chNone;
    if (chPast) alerts.push({ tone: "red", text: `${chPast} compliance check${chPast > 1 ? "s" : ""} past due`, href: "/comp/checks" });
    const sc = subs.filter((x) => x.entity === e).map((x) => controlOf(x, audits, t0).status);
    const scOk = sc.filter((x) => x === "under_control" || x === "control_planned").length, scDue = sc.filter((x) => x === "control_due").length, scBad = sc.filter((x) => x === "control_overdue" || x === "contract_expired").length, scNever = sc.filter((x) => x === "not_controlled").length;
    if (scBad) alerts.push({ tone: "red", text: `${scBad} subcontractor${scBad > 1 ? "s" : ""}: control overdue or contract expired`, href: "/comp/subs" });
    // — Findings
    const fo = findings.filter((f) => f.entity === e && FND_OPEN.includes(f.status));
    const fLate = fo.filter((f) => f.due && f.due < t0 && NP_TURN.includes(f.status)).length;
    if (fLate) alerts.push({ tone: "red", text: `${fLate} finding${fLate > 1 ? "s" : ""}: answer past due`, href: "/comp/find?tab=open" });
    const fL1 = fo.filter((f) => f.level === "1").length; if (fL1) alerts.push({ tone: "red", text: `${fL1} level 1 finding${fL1 > 1 ? "s" : ""} open`, href: "/comp/find?tab=open" });
    const fRev = fo.filter((f) => CMM_TURN.includes(f.status)).length; if (fRev) alerts.push({ tone: "amber", text: `${fRev} finding${fRev > 1 ? "s" : ""} for Compliance to review`, href: "/comp/find?tab=review" });
    const wo = watch.filter((w) => w.entity === e && WATCH_OPEN.includes(w.status));
    const wAn = wo.filter((w) => w.applicability === "to_analyse").length, wLate = wo.filter((w) => w.due && w.due < t0).length;
    if (wLate) alerts.push({ tone: "red", text: `${wLate} regulatory change${wLate > 1 ? "s" : ""} past due`, href: "/comp/watch" });
    // — Means
    const kv = kpis[e] ?? []; const kOff = kv.filter((v) => v.status === "off_target").length;
    if (kOff) alerts.push({ tone: "red", text: `${kOff} indicator${kOff > 1 ? "s" : ""} off target`, href: `/comp/kpi?ent=${e}` });
    if (p && p.next_review_on && p.next_review_on < t0) alerts.push({ tone: "red", text: "Annual review of the programme past due", href: `/comp/prog/${p.id}` });
    const roster = auditorRoster(auditors.filter((a) => a.entities.includes(e)), (ppl ?? []) as { id: string; display_name: string }[], audits.filter((a) => a.entity === e) as never, (its ?? []) as { auditor_id: string; done: boolean }[], (dcs ?? []) as { auditor_id: string }[], t0);
    const auOk = roster.filter((r) => !r.missing.length).length, auBad = roster.length - auOk;
    if (auBad) alerts.push({ tone: "amber", text: `${auBad} auditor file${auBad > 1 ? "s" : ""} incomplete`, href: "/comp/auditors" });
    const re = regs.filter((r) => r.entities.includes(e));
    alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : 1));
    return { e, p, cov, elapsed, ea, alerts, ch: { ok: chOk, soon: chSoon, past: chPast, none: chNone, n: ch.length }, sc: { ok: scOk, due: scDue, bad: scBad, never: scNever, n: sc.length }, fo, wo: { n: wo.length, an: wAn, late: wLate }, kv, roster: { ok: auOk, bad: auBad }, re };
  });
  return (
    <>
      <PageHeader eyebrow="Compliance, Overview" title="Compliance overview" sub="What needs attention first, then three families: surveillance (are we checking?), findings (what is open?), means (people, indicators, texts). Click any line to open its list." />
      {cards.map((c) => {
        const { e, p, cov } = c; const reds = c.alerts.filter((a) => a.tone === "red").length;
        const done = cov?.done ?? 0, todo = cov?.planned ?? 0, tot = done + todo;
        const fNp = c.fo.filter((f) => NP_TURN.includes(f.status)).length, fCmm = c.fo.filter((f) => CMM_TURN.includes(f.status)).length, fPlan = c.fo.filter((f) => f.status === "accepted").length;
        const fAuth = c.fo.filter((f) => f.source === "authority").length;
        return (
          <section key={e} className="card mb-4 ovcard">
            <div className="ch"><span><span className="entdot" style={{ background: ENT_COLOR[e] ?? "var(--field)" }} /><b>{ENT[e]?.name ?? e}</b> <span className="mini">· {ENT[e]?.qual}, {ENT[e]?.auth}</span></span>
              <span className={"pill " + (reds ? "red" : c.alerts.length ? "amber" : "green")}>{reds ? `${reds} urgent` : c.alerts.length ? `${c.alerts.length} to watch` : "All clear"}</span></div>
            <div className="cb">
              <div className="ovattn">
                <div className="eyebrow"><Icon name="warn" size={14} /> Needs attention</div>
                {c.alerts.length ? <div className="ovchips">{c.alerts.map((a, i) => <Link key={i} href={a.href} className={"ovchip " + a.tone}>{a.text}</Link>)}</div> : <p className="mini" style={{ color: "var(--green-ink)" }}><Icon name="check" size={13} /> Nothing pressing.</p>}
              </div>
              <div className="ovcols">
                <div className="ovcol"><div className="ovh"><Icon name="search" size={16} /> Surveillance <span className="mini">are we checking?</span></div>
                  <Link href={p ? `/comp/prog/${p.id}` : "/comp/prog"} className="ovrow"><div className="ovtop"><span className="ovl">Audit programme</span><span className="ovv">{p ? `${done} / ${tot}` : "—"}</span></div>
                    {p ? <><div className="ovprog"><i style={{ width: `${tot ? Math.round((100 * done) / tot) : 0}%` }} /><b style={{ left: `${c.elapsed}%` }} title={`${c.elapsed} % of the cycle elapsed`} /></div><div className="ovs">{done} audit{done === 1 ? "" : "s"} done, {todo} to do · the mark = {c.elapsed} % of the cycle elapsed{cov && cov.outside ? ` · ${cov.outside} outside the cycle` : ""}</div></> : <div className="ovs">no programme in force</div>}</Link>
                  <Row href="/comp/checks" label="Compliance checks" value={c.ch.n} parts={[{ n: c.ch.ok, tone: "green", label: "up to date" }, { n: c.ch.soon, tone: "amber", label: "due ≤ 30 d" }, { n: c.ch.past, tone: "red", label: "past due" }, { n: c.ch.none, tone: "grey", label: "never done" }]} />
                  <Row href="/comp/subs" label="Subcontractors" value={c.sc.n} parts={[{ n: c.sc.ok, tone: "green", label: "under control" }, { n: c.sc.due, tone: "amber", label: "control due" }, { n: c.sc.bad, tone: "red", label: "overdue / expired" }, { n: c.sc.never, tone: "grey", label: "never controlled" }]} />
                </div>
                <div className="ovcol"><div className="ovh"><Icon name="clip" size={16} /> Findings <span className="mini">what is open?</span></div>
                  <Row href="/comp/find?tab=open" label="Open findings" value={c.fo.length} sub={`${fAuth} from the authority, ${c.fo.length - fAuth} internal`} parts={[{ n: fNp, tone: "amber", label: "waiting for the analysis" }, { n: fCmm, tone: "blue", label: "with Compliance" }, { n: fPlan, tone: "green", label: "plan in progress" }]} />
                  <Row href="/comp/watch" label="Regulatory watch" value={c.wo.n} sub="open regulatory changes" parts={[{ n: c.wo.an, tone: "amber", label: "to analyse" }, { n: c.wo.late, tone: "red", label: "past due" }, { n: Math.max(0, c.wo.n - c.wo.an - c.wo.late), tone: "blue", label: "in progress" }]} />
                </div>
                <div className="ovcol"><div className="ovh"><Icon name="users" size={16} /> Means <span className="mini">people, indicators, texts</span></div>
                  <Link href={`/comp/kpi?ent=${e}`} className="ovrow"><div className="ovtop"><span className="ovl">Indicators ENR-CM-06</span><span className="ovv">{c.kv.filter((v) => v.status === "on_target").length} / {c.kv.filter((v) => v.status !== "n_a").length}</span></div>
                    <div className="ovdots">{c.kv.map((v) => <span key={v.code} className={"ovdot " + (v.status === "on_target" ? "green" : v.status === "alert" ? "amber" : v.status === "off_target" ? "red" : "grey")} title={`${v.code} · ${v.status.replace("_", " ")}`}>{v.code}</span>)}</div><div className="ovs">on target, of the measurable ones</div></Link>
                  <Row href="/comp/auditors" label="Auditors" value={c.roster.ok + c.roster.bad} parts={[{ n: c.roster.ok, tone: "green", label: "file complete" }, { n: c.roster.bad, tone: "red", label: "file incomplete" }]} />
                  <Row href="/reg/ear" label="Easy Access Rules" value={c.re.length} parts={[{ n: c.re.filter((r) => r.items_count).length, tone: "green", label: "readable in S.A.M." }, { n: c.re.filter((r) => !r.items_count).length, tone: "grey", label: "link only" }]} />
                </div>
              </div>
            </div>
          </section>);
      })}
    </>
  );
}
