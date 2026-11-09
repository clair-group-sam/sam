import { redirect } from "next/navigation";
import { getSession, basePost, type Session } from "@/lib/session";

/** Registers are for the office of record: CMM, SM, AM and the super admin (deputies included). */
export async function registersSession(): Promise<Session> {
  const s = await getSession(); if (!s) redirect("/login");
  const ok = s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SM", "AM", "SUPERADMIN"].includes(r));
  if (!ok) redirect(s.home);
  return s;
}
export const scopeOf = (s: Session): string[] | null => (s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity]);
export const fr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
export const hm = (d: string | null | undefined) => (d ? d.slice(11, 16) : "");
