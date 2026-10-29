// SAF-08 Internal safety investigation on a report (ORO.GEN.200(a)(3); 376/2014 art. 13(1)). Server-side helpers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSafetyDesk } from "@/lib/safety";
import type { Session } from "@/lib/session";
export * from "@/lib/investigations-shared";

/** The safety desk opens, runs and closes investigations; the lead (any person named) edits the content. */
export const mayOpen = (s: Session) => isSafetyDesk(s);
export const mayEdit = (s: Session, inv: { lead_person: string | null }) => isSafetyDesk(s) || (!!s.person && s.person.id === inv.lead_person);
/** Team members, the AM and the desk read it (confidential — just culture). */
export const mayRead = (s: Session, inv: { lead_person: string | null; team: { person_id?: string | null }[] }) =>
  mayEdit(s, inv) || s.role === "am" || s.role === "cmm" || (!!s.person && inv.team.some((t) => t.person_id === s.person!.id));

export async function nextInvNumber(db: SupabaseClient, entity: string, year = new Date().getUTCFullYear()): Promise<string> {
  const prefix = `INV-${entity}-${year}-`;
  const { data } = await db.from("investigations").select("number").eq("entity", entity).like("number", `${prefix}%`);
  const max = Math.max(0, ...((data ?? []) as { number: string }[]).map((x) => Number(x.number.slice(prefix.length)) || 0));
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}
