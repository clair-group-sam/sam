// Safety › Risk register and MOC (server side): who may do what, references.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
export * from "@/lib/risk-shared";

/** Hazards and MOCs are written by the safety desk and by the nominated persons; approving a MOC is the SM's (safety desk). */
export const mayEditRisk = (s: Session) => isSafetyDesk(s) || s.role === "np" || s.role === "am";
export const mayApproveMoc = (s: Session) => isSafetyDesk(s);

export async function nextHazardRef(db: SupabaseClient, entity: string): Promise<string> {
  const { data } = await db.from("hazards").select("ref").like("ref", `HZ-${entity}-%`);
  const n = ((data ?? []) as { ref: string }[]).map((r) => Number(r.ref.split("-").pop())).filter(Number.isFinite);
  return `HZ-${entity}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, "0")}`;
}
export async function nextMocRef(db: SupabaseClient, entity: string): Promise<string> {
  const y = new Date().getUTCFullYear();
  const { data } = await db.from("mocs").select("ref").like("ref", `MOC-${entity}-${y}-%`);
  const n = ((data ?? []) as { ref: string }[]).map((r) => Number(r.ref.split("-").pop())).filter(Number.isFinite);
  return `MOC-${entity}-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(2, "0")}`;
}
export const addMonths = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
