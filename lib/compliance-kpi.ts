import type { SupabaseClient } from "@supabase/supabase-js";
import { today } from "@/lib/authority";
import { addMonths, current, DONE, type Audit, type Programme } from "@/lib/audit-programme";
import { controlOf, nextDueOf, type CCheck, type Subcontractor } from "@/lib/compliance-registers";
import { OPEN_STATUSES } from "@/lib/findings";

/* KPI-01 · ENR-CM-06 compliance indicators (C1…C11), computed from what S.A.M. holds — nothing typed by hand. Each one keeps
 * its definition, its direction (≥ or ≤), the target and the alert threshold (kpi_targets, set by the AM on the CMM's proposal),
 * and a monthly snapshot (kpi_snapshots) so the SRB / CODIR reads the same figures month after month. */

export type KpiDef = { code: string; label: string; how: string; unit: "%" | "n" | "d"; dir: "≥" | "≤"; ref: string };
export const KPI_DEFS: KpiDef[] = [
  { code: "C1", label: "Internal audit programme carried out (cycle to date)", how: "Audits done ÷ audits planned up to this month in the programme in force (authority audits and recurring checks excluded).", unit: "%", dir: "≥", ref: "MSM §2.2.3 · ENR-ATO-01 / ENR-OPS-01" },
  { code: "C2", label: "Compliance checks carried out on time", how: "Recurring checks with a due date that are not past due ÷ recurring checks with a due date.", unit: "%", dir: "≥", ref: "MSM §2.1" },
  { code: "C3", label: "Open internal findings (level 1 + 2)", how: "Findings from internal audits, inspections and subcontractor audits, level 1 or 2, not closed, at the date.", unit: "n", dir: "≤", ref: "MSM §2.3 · PRO-CM-03" },
  { code: "C4", label: "Internal findings past due", how: "Open internal findings whose due date is passed (an extension granted by Compliance moves the due date).", unit: "n", dir: "≤", ref: "MSM §2.3.1 (E2: 3 months; R: 6 months)" },
  { code: "C5", label: "Authority findings past due", how: "Open authority findings (DSAC, TM-CAD, OSAC, EASA) whose due date is passed.", unit: "n", dir: "≤", ref: "MSM §2.4 · ARA.GEN.350" },
  { code: "C6", label: "Mean closure time of findings (days)", how: "Mean of (effective closure − notification) over the findings closed in the last 12 months.", unit: "d", dir: "≤", ref: "MSM §2.3.1" },
  { code: "C7", label: "Corrective action plans accepted at first submission", how: "Findings whose first analysis round was accepted ÷ findings with a decided round, last 12 months.", unit: "%", dir: "≥", ref: "MSM §2.3.2" },
  { code: "C8", label: "Regulatory watch: impact analyses traced within 30 days", how: "Watch entries created in the last 12 months analysed (not left 'open') within 30 days ÷ entries.", unit: "%", dir: "≥", ref: "MSM §1.5.2 · ORA.GEN.155" },
  { code: "C9", label: "Changes submitted / notified within the MSM §1.6 deadlines", how: "Authority applications submitted in the last 12 months within 30 days of their trigger ÷ applications submitted.", unit: "%", dir: "≥", ref: "MSM §1.6 · ORA.GEN.130" },
  { code: "C10", label: "Documents published without a traced approval / notification", how: "Revisions published in the last 12 months with an approval or notification route and no authority decision recorded (CC-07).", unit: "n", dir: "≤", ref: "ORA.GEN.115 · ORA.ATO.130" },
  { code: "C11", label: "Subcontractors under control", how: "Subcontractors with a valid contract and a control done within their cycle ÷ active subcontractors.", unit: "%", dir: "≥", ref: "MSM §3.5 · ORA.GEN.205" },
];
export type KpiTarget = { entity: string; code: string; target: number; alert: number | null; owner_role: string | null; origin: string | null; active: boolean };
export type KpiValue = { code: string; value: number | null; numerator: number | null; denominator: number | null; status: "on_target" | "alert" | "off_target" | "n_a"; note: string | null; target: number | null; alert: number | null };
export const KPI_STATUS_LABEL: Record<string, string> = { on_target: "On target", alert: "Alert", off_target: "Off target", n_a: "Not measurable yet" };
export const KPI_STATUS_TONE: Record<string, string> = { on_target: "green", alert: "amber", off_target: "red", n_a: "" };

export function statusOf(def: KpiDef, value: number | null, t: KpiTarget | undefined): KpiValue["status"] {
  if (value === null || !t) return "n_a";
  const ok = def.dir === "≥" ? value >= t.target : value <= t.target;
  if (ok) return "on_target";
  if (t.alert !== null && (def.dir === "≥" ? value >= t.alert : value <= t.alert)) return "alert";
  return "off_target";
}
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const monthsAgo = (t0: string, n: number) => addMonths(t0.slice(0, 7) + "-01", -n);

/** Computes the eleven indicators for one entity at a date (default today). Pure reads. */
export async function computeKpis(db: SupabaseClient, entity: string, asOf = today()): Promise<{ values: KpiValue[]; targets: KpiTarget[] }> {
  const since = monthsAgo(asOf, 12);
  const [{ data: tg }, { data: pd }, { data: ad }, { data: cd }, { data: fd }, { data: rd }, { data: wd }, { data: af }, { data: rv }, { data: sd }] = await Promise.all([
    db.from("kpi_targets").select("*").eq("entity", entity).eq("active", true),
    db.from("audit_programmes").select("*").eq("entity", entity),
    db.from("audits").select("id,entity,number,programme_id,module_id,kind,status,planned_month,done_on,subcontractor_id").eq("entity", entity).limit(5000),
    db.from("compliance_checks").select("*").eq("entity", entity).eq("active", true),
    db.from("findings").select("id,source,level,status,due,notified,closed_at,effective_closed_on,current_round").eq("entity", entity).limit(5000),
    db.from("finding_rounds").select("finding_id,n,stage,decision,decided_at,findings!inner(entity)").eq("findings.entity", entity).not("decision", "is", null).limit(5000),
    db.from("watch_entries").select("id,status,created_at,updated_at").eq("entity", entity).gte("created_at", since).limit(5000),
    db.from("authority_files").select("id,category,triggered_at,submitted_at,stage,outcome,revision_id").eq("entity", entity).limit(5000),
    db.from("revisions").select("id,step,authority_route,published_at,manuals!inner(entity)").eq("manuals.entity", entity).in("step", ["published", "repository"]).gte("published_at", since).limit(5000),
    db.from("subcontractors").select("*").eq("entity", entity).eq("active", true),
  ]);
  const targets = (tg ?? []) as KpiTarget[];
  const T = (c: string) => targets.find((t) => t.code === c);
  const progs = (pd ?? []) as Programme[], audits = (ad ?? []) as (Audit & { subcontractor_id: string | null })[];
  const findings = (fd ?? []) as { id: string; source: string; level: string; status: string; due: string | null; notified: string | null; closed_at: string | null; effective_closed_on: string | null; current_round: number }[];
  const out: KpiValue[] = [];
  const push = (code: string, value: number | null, numerator: number | null, denominator: number | null, note: string | null = null) => { const def = KPI_DEFS.find((d) => d.code === code)!; const t = T(code); out.push({ code, value, numerator, denominator, status: statusOf(def, value, t), note, target: t?.target ?? null, alert: t?.alert ?? null }); };

  // C1 · programme carried out to date
  const p = current(progs, asOf).find((x) => x.status !== "draft") ?? null;
  if (p) {
    const thisMonth = asOf.slice(0, 7) + "-01";
    const inScope = audits.filter((a) => a.programme_id === p.id && a.kind !== "authority" && a.kind !== "checks" && a.status !== "cancelled" && a.planned_month <= thisMonth);
    const done = inScope.filter((a) => DONE.includes(a.status)).length;
    push("C1", pct(done, inScope.length), done, inScope.length, `${p.title}`);
  } else push("C1", null, null, null, "no programme in force");
  // C2 · recurring checks on time
  const checks = (cd ?? []) as CCheck[]; const withDue = checks.map((c) => nextDueOf(c)).filter((d): d is string => !!d); const onTime = withDue.filter((d) => d >= asOf).length;
  push("C2", pct(onTime, withDue.length), onTime, withDue.length, withDue.length ? null : "no check with a due date");
  // C3 · C4 · C5
  const internal = findings.filter((f) => f.source !== "authority"), authority = findings.filter((f) => f.source === "authority");
  const openInt = internal.filter((f) => OPEN_STATUSES.includes(f.status) && ["1", "2"].includes(f.level));
  push("C3", openInt.length, openInt.length, null);
  const lateInt = internal.filter((f) => OPEN_STATUSES.includes(f.status) && f.due && f.due < asOf);
  push("C4", lateInt.length, lateInt.length, null);
  const lateAut = authority.filter((f) => OPEN_STATUSES.includes(f.status) && f.due && f.due < asOf);
  push("C5", lateAut.length, lateAut.length, null);
  // C6 · mean closure time over the last 12 months
  const closed = findings.filter((f) => f.status === "closed" && f.notified && (f.effective_closed_on ?? f.closed_at?.slice(0, 10)) && (f.effective_closed_on ?? f.closed_at!.slice(0, 10)) >= since);
  const days = closed.map((f) => daysBetween(f.notified!, f.effective_closed_on ?? f.closed_at!.slice(0, 10))).filter((d) => d >= 0);
  push("C6", days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null, days.length ? days.reduce((a, b) => a + b, 0) : null, days.length || null, days.length ? `${days.length} finding${days.length > 1 ? "s" : ""} closed` : "no finding closed in the last 12 months");
  // C7 · first-round acceptance
  const rounds = (rd ?? []) as unknown as { finding_id: string; n: number; stage: string; decision: string; decided_at: string | null }[];
  const firstByFinding = new Map<string, string>();
  for (const r of rounds.filter((r) => r.decided_at && r.decided_at.slice(0, 10) >= since).sort((a, b) => a.n - b.n)) if (!firstByFinding.has(r.finding_id)) firstByFinding.set(r.finding_id, r.decision);
  const accepted1 = [...firstByFinding.values()].filter((d) => d === "accepted").length;
  push("C7", pct(accepted1, firstByFinding.size), accepted1, firstByFinding.size, firstByFinding.size ? null : "no analysis decided in the last 12 months");
  // C8 · watch analyses within 30 days
  const we = (wd ?? []) as { id: string; status: string; created_at: string; updated_at: string | null }[];
  const traced = we.filter((w) => w.status !== "open" ? daysBetween(w.created_at.slice(0, 10), (w.updated_at ?? w.created_at).slice(0, 10)) <= 30 : daysBetween(w.created_at.slice(0, 10), asOf) <= 30).length;
  push("C8", pct(traced, we.length), traced, we.length, we.length ? null : "no watch entry in the last 12 months");
  // C9 · submissions within 30 days of the trigger
  const files = (af ?? []) as { id: string; category: string | null; triggered_at: string; submitted_at: string | null; stage: string; outcome: string | null; revision_id: string | null }[];
  const submitted = files.filter((f) => f.submitted_at && f.submitted_at >= since && ["approval", "notification", "declaration"].includes(f.category ?? ""));
  const inTime = submitted.filter((f) => daysBetween(f.triggered_at, f.submitted_at!) <= 30).length;
  push("C9", pct(inTime, submitted.length), inTime, submitted.length, submitted.length ? "30 days from the trigger to the submission" : "no application submitted in the last 12 months");
  // C10 · published without a traced decision
  const revs = (rv ?? []) as unknown as { id: string; step: string; authority_route: string | null; published_at: string | null }[];
  const decided = new Set(files.filter((f) => f.revision_id && f.outcome && ["approved", "acknowledged"].includes(f.outcome)).map((f) => f.revision_id));
  const untraced = revs.filter((r) => ["approval", "notification"].includes(r.authority_route ?? "") && !decided.has(r.id)).length;
  push("C10", untraced, untraced, revs.length, revs.length ? `${revs.length} revision${revs.length > 1 ? "s" : ""} published in 12 months` : "no revision published in S.A.M. in the last 12 months");
  // C11 · subcontractors under control
  const subs = (sd ?? []) as Subcontractor[]; const st = subs.map((x) => controlOf(x, audits, asOf).status); const ok = st.filter((x) => x === "under_control").length;
  push("C11", pct(ok, subs.length), ok, subs.length, subs.length ? null : "no subcontractor listed");
  return { values: out, targets };
}

/** Writes this month's snapshot for one entity (idempotent: one row per entity × code × month, overwritten). */
export async function snapshotKpis(db: SupabaseClient, entity: string, asOf = today()): Promise<number> {
  const { values } = await computeKpis(db, entity, asOf);
  const month = asOf.slice(0, 7) + "-01";
  for (const v of values) await db.from("kpi_snapshots").upsert({ entity, code: v.code, month, value: v.value, numerator: v.numerator, denominator: v.denominator, status: v.status, note: v.note, computed_at: new Date().toISOString() }, { onConflict: "entity,code,month" });
  return values.length;
}

/** Monthly job (first days of the month): snapshot the previous month for every entity; the desk gets one task to present it. */
export async function sweepKpis(db: SupabaseClient, entities: string[]): Promise<number> {
  const t0 = today(); if (Number(t0.slice(8, 10)) > 3) return 0;
  const lastDay = new Date(Date.parse(t0.slice(0, 7) + "-01") - 86400000).toISOString().slice(0, 10);
  let n = 0;
  for (const e of entities) {
    const { data: ex } = await db.from("kpi_snapshots").select("id").eq("entity", e).eq("month", lastDay.slice(0, 7) + "-01").limit(1);
    if (ex?.length) continue;
    n += await snapshotKpis(db, e, lastDay);
    await db.from("tasks").insert({ entity: e, kind: "kpi_month", title: `Indicators of ${lastDay.slice(0, 7)} to present (ENR-CM-06)`, detail: "The compliance indicators C1…C11 are computed; read them, add the safety indicators, present them to the CODIR / SRB.", due: t0, owner_role: "CMM", status: "open", link: "/comp/kpi", ref_id: null });
  }
  return n;
}

/** Annual review of the programme (DSAC #1416100): one task to the desk 30 days before next_review_on; closed when the review is recorded. */
export async function sweepProgrammeReviews(db: SupabaseClient): Promise<number> {
  const t0 = today(); let n = 0;
  const { data } = await db.from("audit_programmes").select("id,entity,title,next_review_on").eq("status", "approved").not("next_review_on", "is", null);
  for (const p of (data ?? []) as { id: string; entity: string; title: string; next_review_on: string }[]) {
    if (daysBetween(t0, p.next_review_on) > 30) continue;
    const { data: ex } = await db.from("tasks").select("id").eq("ref_id", p.id).eq("kind", "programme_review").eq("status", "open").limit(1);
    if (ex?.length) continue;
    await db.from("tasks").insert({ entity: p.entity, kind: "programme_review", title: `Annual review of the audit programme · ${p.title}`.slice(0, 200), detail: "Review the programme against the year: audits done and moved, findings, changes in the organisation, new rules; record the review on the programme and present it to the CODIR.", due: p.next_review_on, owner_role: "CMM", status: "open", link: `/comp/prog/${p.id}`, ref_id: p.id });
    n++;
  }
  return n;
}
