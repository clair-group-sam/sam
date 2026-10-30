import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPack, type Pack } from "@/lib/committees";
import { overdueByOwner, type OverdueGroup } from "@/lib/escalation";
import { loadTopics } from "@/lib/watch";
import { OPEN_STATUSES as FND_OPEN, CMM_TURN } from "@/lib/findings";
import { today } from "@/lib/authority";

/* DASH-CS · the one-click view of an entity's compliance & safety state (roadmap item 4, 30/10). Numbers only, each with its link. */
export type EntityDash = {
  entity: string; t0: string;
  docs: { manuals: number; drafts: number; byStep: Record<string, number>; atAuthority: number; unread: number };
  files: { open: number; byStage: Record<string, number>; late: number };
  findings: { open: number; late: number; npTurn: number; cmmTurn: number; inPlan: number; level1: number };
  watch: { streams: number; late: number; entries: number; toAnalyse: number; entriesLate: number };
  safety: Pack | null;
  overdue: { total: number; groups: OverdueGroup[]; escalated: number; am: number };
};

export async function entityDash(db: SupabaseClient, entity: string): Promise<EntityDash> {
  const t0 = today();
  const [{ data: mans }, { data: files }, { data: fnd }, topics, { data: wen }, groups, pack] = await Promise.all([
    db.from("manuals").select("id,internal").eq("entity", entity),
    db.from("authority_files").select("stage,target_date").eq("entity", entity).not("stage", "in", "(closed,standby)"),
    db.from("findings").select("status,due,level").eq("entity", entity).in("status", FND_OPEN),
    loadTopics(db, [entity]),
    db.from("watch_entries").select("applicability,due,status").eq("entity", entity).in("status", ["open", "in_progress", "done"]),
    overdueByOwner(db, [entity]),
    buildPack({ id: "00000000-0000-0000-0000-000000000000", entity, kind: "srb", planned_on: t0, starts_at: null }).catch(() => null),
  ]);
  const manualIds = ((mans ?? []) as { id: string }[]).map((m) => m.id);
  const { data: revs } = manualIds.length ? await db.from("revisions").select("step").in("manual_id", manualIds).not("step", "in", "(published,repository)") : { data: [] };
  const byStep: Record<string, number> = {};
  for (const r of (revs ?? []) as { step: string }[]) byStep[r.step] = (byStep[r.step] ?? 0) + 1;
  const byStage: Record<string, number> = {};
  const F = (files ?? []) as { stage: string; target_date: string | null }[];
  for (const f of F) byStage[f.stage] = (byStage[f.stage] ?? 0) + 1;
  const fn = (fnd ?? []) as { status: string; due: string | null; level: string }[];
  const we = (wen ?? []) as { applicability: string; due: string | null; status: string }[];
  return {
    entity, t0,
    docs: { manuals: manualIds.length, drafts: (revs ?? []).length, byStep, atAuthority: byStep.with_civil_aviation ?? 0, unread: 0 },
    files: { open: F.length, byStage, late: F.filter((f) => ["submitted", "remarks"].includes(f.stage) && f.target_date && f.target_date < t0).length },
    findings: { open: fn.length, late: fn.filter((f) => f.due && f.due < t0 && !["accepted", "closure_requested"].includes(f.status)).length, npTurn: fn.filter((f) => !CMM_TURN.includes(f.status) && f.status !== "accepted").length, cmmTurn: fn.filter((f) => CMM_TURN.includes(f.status)).length, inPlan: fn.filter((f) => f.status === "accepted").length, level1: fn.filter((f) => f.level === "1").length },
    watch: { streams: topics.length, late: topics.filter((t) => t.overdue >= 0).length, entries: we.length, toAnalyse: we.filter((x) => x.applicability === "to_analyse").length, entriesLate: we.filter((x) => x.due && x.due < t0).length },
    safety: pack,
    overdue: { total: groups.reduce((n, g) => n + g.count, 0), groups, escalated: groups.reduce((n, g) => n + g.escalated, 0), am: groups.reduce((n, g) => n + g.am, 0) },
  };
}
