import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { addMonths, coverage, current, type Audit, type AuditModule, type Programme } from "@/lib/audit-programme";
import { controlOf, daysTo, nextDueOf, type Auditor, type CCheck, type Subcontractor } from "@/lib/compliance-registers";
import { OPEN_STATUSES as FND_OPEN } from "@/lib/findings";
import { OPEN_STATUSES as WATCH_OPEN } from "@/lib/watch";
import { today } from "@/lib/authority";

/* COMP-00 · Compliance overview: one card per entity of the scope, every number computed live and clickable — programme, audits, checks, findings, watch, regulation, auditors, subcontractors. */
type Tile = { label: string; value: string | number; hint?: string; tone?: "red" | "amber" | "green"; href: string };
export default async function ComplianceOverview() {
  const s = await getSession(); if (!s) redirect("/login");
  const scope = s.entity === "ALL" ? (s.group ? ENTS4 : s.entities) : [s.entity];
  const db = supabaseAdmin(); const t0 = today();
  const [{ data: pd }, { data: ad }, { data: cd }, { data: fd }, { data: wd }, { data: rd }, { data: aud }, { data: sd }, { data: md }] = await Promise.all([
    db.from("audit_programmes").select("*").in("entity", scope),
    db.from("audits").select("*").in("entity", scope).limit(5000),
    db.from("compliance_checks").select("*").in("entity", scope).eq("active", true),
    db.from("findings").select("id,entity,status,due,level,source").in("entity", scope).limit(5000),
    db.from("watch_entries").select("id,entity,status,applicability,due").in("entity", scope).limit(5000),
    db.from("regulations").select("id,entities,check_result,items_count").eq("active", true),
    db.from("auditors").select("*"),
    db.from("subcontractors").select("*").in("entity", scope).eq("active", true),
    db.from("audit_modules").select("*"),
  ]);
  const progs = (pd ?? []) as Programme[], audits = (ad ?? []) as (Audit & { subcontractor_id: string | null })[], checks = (cd ?? []) as CCheck[];
  const findings = (fd ?? []) as { id: string; entity: string; status: string; due: string | null; level: string; source: string }[];
  const watch = (wd ?? []) as { id: string; entity: string; status: string; applicability: string; due: string | null }[];
  const regs = (rd ?? []) as { id: string; entities: string[]; check_result: string | null; items_count: number | null }[];
  const auditors = (aud ?? []) as Auditor[], subs = (sd ?? []) as Subcontractor[], mods = (md ?? []) as AuditModule[];
  const cur = current(progs, t0);
  const cards = scope.map((e) => {
    const p = cur.find((x) => x.entity === e) ?? null;
    const pa = p ? audits.filter((a) => a.programme_id === p.id) : [];
    const cov = p ? coverage(p, mods.filter((m) => m.programme_id === p.id), pa, t0) : null;
    const ea = audits.filter((a) => a.entity === e);
    const late = ea.filter((a) => a.status === "planned" && addMonths(a.planned_month, 1) <= t0).length;
    const ch = checks.filter((c) => c.entity === e).map((c) => daysTo(nextDueOf(c), t0));
    const fo = findings.filter((f) => f.entity === e && FND_OPEN.includes(f.status));
    const wo = watch.filter((w) => w.entity === e && WATCH_OPEN.includes(w.status));
    const re = regs.filter((r) => r.entities.includes(e));
    const au = auditors.filter((a) => a.entities.includes(e));
    const sc = subs.filter((x) => x.entity === e).map((x) => controlOf(x, audits, t0).status);
    const tiles: Tile[] = [
      { label: "Audit programme", value: p ? `${cov!.done} / ${cov!.done + cov!.planned}` : "—", hint: p ? `${p.title} · ${cov!.late ? `${cov!.late} month passed · ` : ""}${cov!.modulesWithout.length + cov!.gaps.length} coverage gap${cov!.modulesWithout.length + cov!.gaps.length === 1 ? "" : "s"}` : "no programme in force", tone: !p ? "amber" : cov!.late ? "red" : cov!.modulesWithout.length + cov!.gaps.length ? "amber" : "green", href: p ? `/comp/prog/${p.id}` : "/comp/prog" },
      { label: "Audits", value: `${ea.filter((a) => a.status === "in_progress").length} · ${ea.filter((a) => a.status === "report").length}`, hint: `in progress · reports to close${late ? ` · ${late} to start, month passed` : ""}`, tone: late ? "red" : ea.some((a) => a.status === "report") ? "amber" : undefined, href: "/comp/audits" },
      { label: "Compliance checks", value: `${ch.filter((d) => d !== null && d <= 30).length} / ${ch.length}`, hint: `due ≤ 30 d${ch.some((d) => d !== null && d < 0) ? ` · ${ch.filter((d) => d !== null && d < 0).length} past due` : ""}`, tone: ch.some((d) => d !== null && d < 0) ? "red" : ch.some((d) => d !== null && d <= 30) ? "amber" : "green", href: "/comp/checks" },
      { label: "Open findings", value: fo.length, hint: `${fo.filter((f) => f.due && f.due < t0).length} past due · ${fo.filter((f) => f.source === "authority").length} authority · ${fo.filter((f) => f.level === "1").length} level 1`, tone: fo.some((f) => f.due && f.due < t0) || fo.some((f) => f.level === "1") ? "red" : fo.length ? "amber" : "green", href: "/comp/find" },
      { label: "Regulatory watch", value: wo.length, hint: `${wo.filter((w) => w.applicability === "to_analyse").length} to analyse · ${wo.filter((w) => w.due && w.due < t0).length} past due`, tone: wo.some((w) => w.due && w.due < t0) ? "red" : wo.some((w) => w.applicability === "to_analyse") ? "amber" : "green", href: "/comp/watch" },
      { label: "Easy Access Rules", value: re.length, hint: `${re.filter((r) => r.items_count).length} with articles in S.A.M.${re.some((r) => r.check_result === "unreachable") ? " · a page not read" : ""}`, tone: re.some((r) => r.check_result === "unreachable") ? "amber" : "green", href: "/reg/ear" },
      { label: "Internal auditors", value: au.filter((a) => a.status === "approved").length, hint: `approved · ${au.filter((a) => a.status === "approved" && (daysTo(a.valid_until, t0) ?? 999) <= 90).length} ending ≤ 90 d · ${au.filter((a) => a.status === "in_qualification").length} in qualification`, tone: !au.some((a) => a.status === "approved") ? "amber" : au.some((a) => a.status === "approved" && (daysTo(a.valid_until, t0) ?? 999) <= 90) ? "amber" : "green", href: "/comp/auditors" },
      { label: "Subcontractors", value: `${sc.filter((x) => x === "under_control").length} / ${sc.length}`, hint: `under control · ${sc.filter((x) => x === "control_due" || x === "control_overdue").length} control due · ${sc.filter((x) => x === "not_controlled").length} never`, tone: sc.some((x) => x === "control_overdue" || x === "contract_expired") ? "red" : sc.some((x) => x !== "under_control") ? "amber" : "green", href: "/comp/subs" },
    ];
    return { e, tiles };
  });
  return (
    <>
      <PageHeader eyebrow="Compliance · Overview" title="Compliance overview" sub="Programme, audits, checks, findings, watch, rules, auditors, subcontractors — computed live for the entity in work. Each tile opens its list." />
      {cards.map(({ e, tiles }) => (
        <section key={e} className="card mb-4"><div className="ch"><span><span className="entdot" style={{ background: ENT_COLOR[e] ?? "#888" }} /><b>{ENT[e]?.name ?? e}</b> <span className="mini">· {ENT[e]?.qual} · {ENT[e]?.auth}</span></span></div>
          <div className="cb tiles">{tiles.map((t) => <Link key={t.label} href={t.href} className="tilelink"><div className={"tile " + (t.tone ?? "")}><div className="tv">{t.value}</div><div className="tl">{t.label}</div>{t.hint && <div className="th">{t.hint}</div>}</div></Link>)}</div>
        </section>))}
    </>
  );
}
