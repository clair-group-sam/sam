import type { SupabaseClient } from "@supabase/supabase-js";

/* AUD-01 · Compliance › Audit programme (03/11). One programme per entity and cycle; modules (areas) with the requirements they cover;
 * audits planned month by month. Replanning keeps its reason. S.A.M. computes the coverage; it does not judge it. */

export type Programme = { id: string; entity: string; title: string; reference: string | null; domains: string[]; cycle_months: number; starts_on: string; ends_on: string; requirements: string[];
  status: string; approved_by: string | null; approved_at: string | null; approval_note: string | null; previous_id: string | null; note: string | null; created_at: string;
  reviewed_on: string | null; review_note: string | null; next_review_on: string | null };
export type AuditModule = { id: string; programme_id: string; code: string; title: string; domain: string | null; kind: string; requirements: string[]; sort: number; active: boolean; checklist_id?: string | null; subcontractor_id?: string | null; check_ids: string[] };
/** AUD-03 · a recurring check shown in the programme: its passages in the cycle and the next due date. */
export type ProgCheck = { id: string; code: string; title: string; every_months: number; last_done_on: string | null; next_due: string | null; owner_role: string | null; runs: { id: string; done_on: string; result: string }[] };
export type Audit = { id: string; entity: string; number: string; programme_id: string | null; module_id: string | null; kind: string; domain: string | null; title: string; planned_month: string; planned_on: string | null; planned_end: string | null;
  lead_auditor: string | null; auditors: string[]; external_auditor: string | null; authority: string | null; subcontractor: string | null; scope: string | null; status: string; replanned: number; done_on: string | null; note: string | null; created_at: string; checklist_id?: string | null };
export type AuditEvent = { id: number; audit_id: string; at: string; by: string | null; kind: string; from_month: string | null; to_month: string | null; status: string | null; reason: string | null };

/** MSM references of the programme, per entity (claude/msm-references.md). */
export const PROG_REF: Record<string, { reference: string; msm: string; domains: string[]; authority: string }> = {
  ASJMT: { reference: "ENR-OPS-01 (OPS) · ENR-M-01 (CAMO)", msm: "MSM §2.3.4", domains: ["OPS", "CAMO"], authority: "TM-CAD" },
  ASJFR: { reference: "ENR-OPS-01", msm: "MSM §2.3.4", domains: ["OPS"], authority: "DSAC" },
  ASFFR: { reference: "ENR-ATO-01", msm: "MSM §2.2.3", domains: ["ATO", "FSTD"], authority: "DSAC" },
  ASTFR: { reference: "Part-CAE internal audit programme", msm: "CAE", domains: ["CAE"], authority: "OSAC" },
};
export const KIND_LABEL: Record<string, string> = { internal: "Internal audit", subcontractor: "Subcontractor audit", checks: "Compliance checks", authority: "Authority audit" };
export const KIND_LETTER: Record<string, string> = { internal: "P", subcontractor: "S", checks: "C", authority: "A" };
export const STATUS_LABEL: Record<string, string> = { planned: "Planned", in_progress: "In progress", report: "Report", closed: "Done", cancelled: "Cancelled" };
export const PROG_STATUS: Record<string, string> = { draft: "Draft", approved: "Approved", closed: "Closed" };
export const DONE = ["closed"];
export const LIVE = ["planned", "in_progress", "report", "closed"];

const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthStart = (d: string) => d.slice(0, 7) + "-01";
export function addMonths(d: string, n: number): string { const [y, m] = d.slice(0, 7).split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`; }
export function monthsBetween(a: string, b: string): number { const [y1, m1] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); }
export const monthLabel = (d: string, withYear = false) => { const [y, m] = d.split("-").map(Number); return MN[m - 1] + (withYear || m === 1 ? " " + String(y).slice(2) : ""); };
export const monthLong = (d: string) => { const [y, m] = d.split("-").map(Number); return `${MN[m - 1]} ${y}`; };
/** The months of the cycle, first day of each. */
export function cycleMonths(p: Programme): string[] { const n = Math.max(1, monthsBetween(monthStart(p.starts_on), monthStart(p.ends_on)) + 1); return Array.from({ length: n }, (_, i) => addMonths(p.starts_on, i)); }
export function elapsedPct(p: Programme, t0: string): number { const a = Date.parse(p.starts_on), b = Date.parse(p.ends_on), t = Date.parse(t0); return Math.max(0, Math.min(100, Math.round((100 * (t - a)) / (b - a)))); }
export const lines = (v: string | null | undefined) => String(v ?? "").split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean);

export async function nextAuditNumber(db: SupabaseClient, entity: string, year: number): Promise<string> {
  const { data } = await db.from("audits").select("number").eq("entity", entity).like("number", `AUD-${entity}-${year}-%`);
  const n = ((data ?? []) as { number: string }[]).map((r) => Number(r.number.split("-").pop())).filter(Number.isFinite);
  return `AUD-${entity}-${year}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(2, "0")}`;
}

export type Coverage = { done: number; planned: number; replanned: number; cancelled: number; late: number; modulesWithout: AuditModule[]; reqs: { req: string; modules: string[] }[]; gaps: string[] };
/** What the cycle covers: modules without a live audit, requirements of the programme no audited module lists. */
export function coverage(p: Programme, mods: AuditModule[], audits: Audit[], t0: string): Coverage {
  const live = audits.filter((a) => LIVE.includes(a.status));
  const audited = new Set(live.map((a) => a.module_id).filter(Boolean) as string[]);
  for (const m of mods) if (m.kind === "checks" && m.check_ids?.length) audited.add(m.id); // a linked recurring check covers its module
  const active = mods.filter((m) => m.active);
  const reqs = p.requirements.map((req) => ({ req, modules: active.filter((m) => audited.has(m.id) && m.requirements.some((r) => r.toLowerCase() === req.toLowerCase())).map((m) => m.code) }));
  return {
    done: audits.filter((a) => DONE.includes(a.status)).length,
    planned: audits.filter((a) => ["planned", "in_progress", "report"].includes(a.status)).length,
    replanned: audits.filter((a) => a.replanned > 0 && a.status !== "cancelled").length,
    cancelled: audits.filter((a) => a.status === "cancelled").length,
    late: audits.filter((a) => a.status === "planned" && addMonths(a.planned_month, 1) <= t0).length,
    modulesWithout: active.filter((m) => m.kind !== "authority" && !audited.has(m.id)),
    reqs, gaps: reqs.filter((r) => !r.modules.length).map((r) => r.req),
  };
}

export async function loadProgramme(db: SupabaseClient, id: string) {
  const { data: p } = await db.from("audit_programmes").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  const [{ data: m }, { data: a }] = await Promise.all([
    db.from("audit_modules").select("*").eq("programme_id", id).order("sort").order("code"),
    db.from("audits").select("*").eq("programme_id", id).order("planned_month").order("number"),
  ]);
  const mods = (m ?? []) as AuditModule[];
  // AUD-03 · the recurring checks linked to the "checks" modules, with their passages inside the cycle
  const ids = [...new Set(mods.flatMap((x) => x.check_ids ?? []))];
  let checks: ProgCheck[] = [];
  if (ids.length) {
    const pr = p as Programme;
    const [{ data: cs }, { data: rs }] = await Promise.all([
      db.from("compliance_checks").select("id,code,title,every_months,last_done_on,next_due,owner_role").in("id", ids),
      db.from("compliance_check_runs").select("id,check_id,done_on,result").in("check_id", ids).gte("done_on", pr.starts_on).lte("done_on", pr.ends_on).order("done_on"),
    ]);
    checks = ((cs ?? []) as Omit<ProgCheck, "runs">[]).map((c) => ({ ...c, runs: ((rs ?? []) as { id: string; check_id: string; done_on: string; result: string }[]).filter((r) => r.check_id === c.id) }));
  }
  return { p: p as Programme, mods, audits: (a ?? []) as Audit[], checks };
}

/** The programme in force per entity: the one whose cycle contains today, else the latest. */
export function current(progs: Programme[], t0: string): Programme[] {
  const by = new Map<string, Programme>();
  for (const p of [...progs].sort((a, b) => b.starts_on.localeCompare(a.starts_on))) {
    const cur = by.get(p.entity);
    const inForce = p.starts_on <= t0 && t0 <= p.ends_on && p.status !== "closed";
    if (!cur || (inForce && !(cur.starts_on <= t0 && t0 <= cur.ends_on && cur.status !== "closed"))) by.set(p.entity, p);
  }
  return [...by.values()];
}
