// Safety actions (server side): who may do what, numbering.
import type { SupabaseClient } from "@supabase/supabase-js";
import { basePost, type Session } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
import type { Action } from "@/lib/actions-shared";
export * from "@/lib/actions-shared";

/** Raise and edit: the safety desk, the nominated persons and the AM. */
export const mayManageActions = (s: Session) => isSafetyDesk(s) || s.role === "np" || s.role === "am";
/** Verification of what was done, and of its effectiveness: the safety desk (SM / CMM / FSO). */
export const mayVerifyActions = (s: Session) => isSafetyDesk(s);
/** The owner: the person named, or anyone holding the post in the entity. */
export const isOwner = (s: Session, a: Pick<Action, "owner_person" | "owner_role" | "entity">) =>
  (!!a.owner_person && a.owner_person === s.person?.id) || (!!a.owner_role && s.entities.includes(a.entity) && s.roles.map(basePost).includes(basePost(a.owner_role)));

export async function nextActionNumber(db: SupabaseClient, entity: string): Promise<string> {
  const y = new Date().getFullYear();
  const { data } = await db.from("safety_actions").select("number").eq("entity", entity).like("number", `ACT-${entity}-${y}-%`);
  const n = ((data ?? []) as { number: string }[]).map((r) => Number(r.number.split("-").pop())).filter(Number.isFinite);
  return `ACT-${entity}-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0")}`;
}
