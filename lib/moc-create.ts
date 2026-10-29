import type { SupabaseClient } from "@supabase/supabase-js";
import { nextAssessmentNumber } from "@/lib/risk";

export type NewMoc = { entity: string; name: string; description?: string | null; domain?: string | null; category?: string | null; change_type?: string | null; start_date?: string | null; reason?: string | null; requestor?: string | null };
/** Opens a management-of-change assessment (kind "moc") — the same row the app's "New MOC" form creates (risk/actions › createAssessment), without its report / project branches. */
export async function createMoc(db: SupabaseClient, actor: { personId: string | null; name: string }, m: NewMoc, via: "app" | "teams" = "app"): Promise<{ id: string; number: string }> {
  if (!m.name?.trim()) throw new Error("A name is required.");
  const number = await nextAssessmentNumber(db, m.entity, "moc", m.domain ?? null);
  const row = { entity: m.entity, kind: "moc", number, name: m.name.trim().slice(0, 200), domain: m.domain ?? null, description: m.description ?? null, owner_role: "SM", next_due: null, conducted_on: new Date().toISOString().slice(0, 10),
    participants: [], moc_status: "assessment", category: m.category ?? null, change_type: m.change_type ?? null, start_date: m.start_date ?? null, reason: m.reason ?? null, requestor: m.requestor ?? null, created_by: actor.personId };
  const { data, error } = await db.from("risk_assessments").insert(row).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "not created");
  const id = (data as { id: string }).id;
  await db.from("risk_events").insert({ assessment_id: id, kind: "created", actor: actor.personId, note: `${number} opened (Management of change)${via === "teams" ? ` via Teams by ${actor.name}` : ""}` });
  return { id, number };
}
