import type { SupabaseClient } from "@supabase/supabase-js";
import { riskLabel, schemeOf, tolerability } from "@/lib/risk";

/* SAF · Top hazards (27/11, Guillaume): two kinds, shown together.
 *  - designated: the entries of the hazard log marked "Top risk" by the safety desk; they stay until unmarked;
 *  - live: the other hazards, ranked by exposure — the occurrences (safety reports) linked to the hazard over the last 12 months —
 *    then by current rating. A hazard without any occurrence enters only when its current risk is intolerable. The list moves by
 *    itself as reports are linked. */
export const TOP_LIVE = 10; export const EXPOSURE_MONTHS = 12;
export type TopHazard = { id: string; ref: string; title: string; entity: string; entry: string; entryId: string; designated: boolean; rank: number | null; exposure: number; label: string | null; tol: string | null; owner: string | null };

export async function topHazards(db: SupabaseClient, entities: string[], n = TOP_LIVE): Promise<TopHazard[]> {
  if (!entities.length) return [];
  const { data: ra } = await db.from("risk_assessments").select("id,entity,number,top_risk,status,owner_role").in("entity", entities).eq("kind", "hazard_log").limit(3000);
  const entries = new Map(((ra ?? []) as { id: string; entity: string; number: string; top_risk: boolean | null; status: string; owner_role: string | null }[]).filter((a) => !["archived", "cancelled"].includes(a.status)).map((a) => [a.id, a]));
  if (!entries.size) return [];
  const { data: hz } = await db.from("hazards").select("id,ref,title,entity,status,owner_role,lik_before,sev_before,lik_after,sev_after,assessment_id,hazard_reports(report_id)").in("assessment_id", [...entries.keys()]).eq("proposed", false).neq("status", "closed").limit(5000);
  type H = { id: string; ref: string; title: string; entity: string; owner_role: string | null; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; assessment_id: string; hazard_reports: { report_id: string }[] | null };
  const H = (hz ?? []) as unknown as H[];
  const ids = [...new Set(H.flatMap((h) => (h.hazard_reports ?? []).map((r) => r.report_id)))];
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - EXPOSURE_MONTHS);
  const { data: rp } = ids.length ? await db.from("reports").select("id").in("id", ids).gte("received_at", since.toISOString()) : { data: [] };
  const recent = new Set(((rp ?? []) as { id: string }[]).map((r) => r.id));
  const out: TopHazard[] = [];
  for (const e of entities) {
    const sch = schemeOf(e);
    const rows = H.filter((h) => h.entity === e).map((h) => { const l = h.lik_after ?? h.lik_before, s = h.sev_after ?? h.sev_before; const tol = tolerability(l, s, sch); const a = entries.get(h.assessment_id)!;
      return { h, a, tol, label: riskLabel(l, s, sch) ?? null, exposure: (h.hazard_reports ?? []).filter((r) => recent.has(r.report_id)).length,
        score: (tol === "intolerable" ? 3 : tol === "tolerable" ? 2 : tol ? 1 : 0) * 100 + (l ?? 0) * 10 + (6 - "ABCDE".indexOf(s ?? "E")) }; });
    const mk = (r: (typeof rows)[number], designated: boolean, rank: number | null): TopHazard => ({ id: r.h.id, ref: r.h.ref, title: r.h.title, entity: e, entry: r.a.number, entryId: r.a.id, designated, rank, exposure: r.exposure, label: r.label, tol: r.tol, owner: r.h.owner_role ?? r.a.owner_role });
    out.push(...rows.filter((r) => r.a.top_risk).sort((x, y) => y.score - x.score).map((r) => mk(r, true, null)));
    out.push(...rows.filter((r) => !r.a.top_risk && (r.exposure > 0 || r.tol === "intolerable")).sort((x, y) => y.exposure - x.exposure || y.score - x.score).slice(0, n).map((r, i) => mk(r, false, i + 1)));
  }
  return out;
}
