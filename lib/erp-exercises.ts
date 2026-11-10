import type { SupabaseClient } from "@supabase/supabase-js";

/** FB-074 · the last ERP exercise of each entity: the Exercises register, and the ERP drills held as a safety meeting in
 *  Safety › Committees (title naming an ERP drill / exercise), which is where they were recorded before the ERP module. */
export async function lastErpExercises(db: SupabaseClient, entities?: string[]): Promise<Map<string, { on: string; from: "register" | "committee"; ref?: string; title?: string }>> {
  let eq = db.from("erp_exercises").select("entity,held_on").eq("status", "done");
  let cq = db.from("committees").select("number,title,entities,entity,planned_on,starts_at,status").in("status", ["held", "closed"]).ilike("title", "%ERP%");
  if (entities) { eq = eq.in("entity", entities); cq = cq.overlaps("entities", entities); }
  const [{ data: ex }, { data: cm }] = await Promise.all([eq, cq]);
  const out = new Map<string, { on: string; from: "register" | "committee"; ref?: string; title?: string }>();
  for (const e of (ex ?? []) as { entity: string; held_on: string | null }[]) if (e.held_on && (out.get(e.entity)?.on ?? "") < e.held_on) out.set(e.entity, { on: e.held_on, from: "register" });
  for (const c of (cm ?? []) as { number: string; title: string; entities: string[] | null; entity: string; planned_on: string | null; starts_at: string | null }[]) {
    if (!/\b(drill|exercise|exercice|simulation)\b/i.test(c.title)) continue;
    const on = (c.starts_at ?? c.planned_on ?? "").slice(0, 10); if (!on) continue;
    for (const e of (c.entities?.length ? c.entities : [c.entity])) if ((!entities || entities.includes(e)) && (out.get(e)?.on ?? "") < on) out.set(e, { on, from: "committee", ref: c.number, title: c.title });
  }
  return out;
}
