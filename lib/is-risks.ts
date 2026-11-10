import { supabaseAdmin } from "@/lib/supabase-admin";

export const SEV: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
export type Hz = { id: string; ref: string; title: string; consequence: string | null; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; risk_assessments: { number: string } };

/** The information-security hazards of the Safety hazard log ("HZ IS-…") of an entity, not yet in the IS risk register. */
export async function isHazardsToTake(entity: string): Promise<Hz[]> {
  const db = supabaseAdmin();
  const [{ data: hz }, { data: rk }] = await Promise.all([
    db.from("hazards").select("id,ref,title,consequence,lik_before,sev_before,lik_after,sev_after,risk_assessments!inner(number,kind)").eq("entity", entity).eq("proposed", false).neq("status", "closed").eq("risk_assessments.kind", "hazard_log").ilike("risk_assessments.number", "HZ IS%").limit(300),
    db.from("is_risks").select("threat").eq("entity", entity),
  ]);
  const have = new Set(((rk ?? []) as { threat: string }[]).map((r) => r.threat.trim().toLowerCase()));
  return ((hz ?? []) as unknown as Hz[]).filter((h) => !have.has(h.title.trim().toLowerCase()));
}

