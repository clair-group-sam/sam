import { supabaseAdmin } from "@/lib/supabase-admin";
/** Number of study hazards (MOC / RA) waiting for a decision against the hazard log: link, keep local or add to the log. */
export async function toMatchCount(scope: string[]): Promise<number> {
  const { count } = await supabaseAdmin().from("hazards").select("id,risk_assessments!inner(kind,status)", { count: "exact", head: true }).in("entity", scope).eq("proposed", false).eq("local_only", false).is("log_hazard_id", null).neq("status", "closed").in("risk_assessments.kind", ["moc", "ra"]).not("risk_assessments.status", "in", "(archived,cancelled)");
  return count ?? 0;
}
