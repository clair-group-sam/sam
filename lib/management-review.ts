import type { SupabaseClient } from "@supabase/supabase-js";
import { entityDash, type EntityDash } from "@/lib/dashboard";
import { computeKpis, KPI_DEFS, type KpiTarget, type KpiValue } from "@/lib/compliance-kpi";
import { today } from "@/lib/authority";

/* DASH-MR · Dashboards › CODIR / SRB — the management review of one entity, as the MSM asks the Accountable Manager to hold it
 * (SRB at least twice a year for AJD / ASJ, CODIR quarterly for ASF; the compliance review §2.6 sits in it): compliance indicators
 * C1…C11, the audit programme of the year, findings, the authority, safety since the last board, overdue items by post, the boards
 * themselves. Same figures as Compliance › Indicators, Safety › Overview and the SRB pack — one truth, several screens. */
export type Review = EntityDash & {
  kpi: { values: KpiValue[]; targets: KpiTarget[]; on: number; alert: number; off: number; na: number };
  programme: { year: number; planned: number; done: number; running: number; late: number; cancelled: number; authority: number; subcontractor: number };
  mor: { year: number; filed: number; late: number; pending: number };
  boards: { last: Board | null; next: Board | null; openActions: number; kindLabel: string };
  decisions: { am: number; cmm: number };
};
export type Board = { id: string; number: string; title: string; planned_on: string | null; starts_at: string | null; status: string; decided: number };

export async function managementReview(db: SupabaseClient, entity: string): Promise<Review> {
  const t0 = today(); const year = Number(t0.slice(0, 4)); const month0 = t0.slice(0, 7) + "-01";
  const boardKind = "srb"; // ASF holds it at the CODIR — same object, named CODIR on screen (kindShort)
  const [dash, kpi, { data: au }, { data: rp }, { data: cm }, { data: tk }] = await Promise.all([
    entityDash(db, entity),
    computeKpis(db, entity, t0),
    db.from("audits").select("status,kind,planned_month").eq("entity", entity).gte("planned_month", `${year}-01-01`).lte("planned_month", `${year}-12-31`).limit(2000),
    db.from("reports").select("received_at,mor_filed_at,e2_status,report_analysis(mor_status,confirmed_at)").eq("entity", entity).gte("received_at", `${year}-01-01`).limit(5000),
    db.from("committees").select("id,number,title,planned_on,starts_at,status,agenda,kind").contains("entities", [entity]).eq("kind", boardKind).neq("status", "cancelled").order("planned_on", { ascending: false }).limit(12),
    db.from("tasks").select("kind,owner_role").eq("entity", entity).eq("status", "open").in("owner_role", ["AM", "CMM", "SM"]).limit(2000),
  ]);
  const A = (au ?? []) as { status: string; kind: string; planned_month: string }[];
  const live = A.filter((a) => a.status !== "cancelled");
  const programme = {
    year, planned: live.length, done: live.filter((a) => a.status === "closed").length, running: live.filter((a) => a.status === "in_progress" || a.status === "report").length,
    late: live.filter((a) => a.status === "planned" && a.planned_month < month0).length, cancelled: A.length - live.length,
    authority: live.filter((a) => a.kind === "authority").length, subcontractor: live.filter((a) => a.kind === "subcontractor").length,
  };
  type R = { received_at: string; mor_filed_at: string | null; e2_status: string | null; report_analysis: { mor_status: string | null; confirmed_at: string | null } | { mor_status: string | null; confirmed_at: string | null }[] | null };
  const mandatory = ((rp ?? []) as R[]).filter((r) => { const a = Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis; return a?.confirmed_at && a.mor_status === "mandatory"; });
  const lateFiled = (r: R) => !!r.mor_filed_at && new Date(r.mor_filed_at).getTime() > new Date(r.received_at).getTime() + 72 * 3600e3;
  const mor = { year, filed: mandatory.filter((r) => r.mor_filed_at).length, late: mandatory.filter(lateFiled).length, pending: mandatory.filter((r) => !r.mor_filed_at).length };
  type C = { id: string; number: string; title: string; planned_on: string | null; starts_at: string | null; status: string; agenda: { decision?: string | null }[] | null };
  const boards = ((cm ?? []) as C[]).map((c) => ({ id: c.id, number: c.number, title: c.title, planned_on: c.planned_on, starts_at: c.starts_at, status: c.status, decided: (c.agenda ?? []).filter((i) => i.decision?.trim()).length }));
  const last = boards.find((b) => b.status === "held" || b.status === "closed") ?? null;
  const next = [...boards].reverse().find((b) => b.status === "planned" && (!b.planned_on || b.planned_on >= t0)) ?? null;
  const { count: openActions } = last ? await db.from("safety_actions").select("id", { count: "exact", head: true }).eq("entity", entity).eq("committee_id", last.id).in("status", ["open", "in_progress"]) : { count: 0 };
  const T = (tk ?? []) as { kind: string; owner_role: string | null }[];
  const am = T.filter((t) => t.owner_role === "AM").length; const cmm = T.filter((t) => t.owner_role === "CMM" || t.owner_role === "SM").length;
  const on = kpi.values.filter((v) => v.status === "on_target").length, alert = kpi.values.filter((v) => v.status === "alert").length, off = kpi.values.filter((v) => v.status === "off_target").length;
  return {
    ...dash,
    kpi: { ...kpi, on, alert, off, na: KPI_DEFS.length - on - alert - off },
    programme, mor,
    boards: { last, next, openActions: openActions ?? 0, kindLabel: entity === "ASFFR" ? "CODIR" : "SRB" },
    decisions: { am, cmm },
  };
}
