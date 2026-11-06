"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* COMP-06 · Subcontractors (ENR-CM-11): the register; controls are audits of kind 'subcontractor' linked to the row. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); if (!desk(s)) throw new Error("Compliance desk only."); return s; }
const touch = () => { revalidatePath("/comp/subs"); revalidatePath("/comp/over"); revalidatePath("/comp/prog"); };
const bool = (fd: FormData, k: string) => { const v = str(fd, k); return v === "yes" ? true : v === "no" ? false : null; };

export async function saveSub(fd: FormData) {
  const s = await me(); const id = str(fd, "id");
  const row = { code: str(fd, "code"), name: str(fd, "name") ?? "Subcontractor", service: str(fd, "service"), domain: str(fd, "domain"), approval_ref: str(fd, "approval_ref"), contract_ref: str(fd, "contract_ref"), contract_from: str(fd, "contract_from"), contract_until: str(fd, "contract_until"), access_clause: bool(fd, "access_clause"), is_clause: bool(fd, "is_clause"), every_months: Math.max(1, Number(fd.get("every_months") ?? 12) || 12), contact: str(fd, "contact"), status_note: str(fd, "status_note") };
  if (id) await db().from("subcontractors").update(row).eq("id", id);
  else { const entity = str(fd, "entity"); if (!entity || (!s.group && !s.entities.includes(entity))) throw new Error("Entity."); const { error } = await db().from("subcontractors").insert({ entity, ...row }); if (error) throw new Error(error.message); }
  touch();
}
export async function archiveSub(fd: FormData) { await me(); await db().from("subcontractors").update({ active: false }).eq("id", String(fd.get("id"))); touch(); }
/** Attach an existing audit (kind subcontractor) to the row, or detach. */
export async function linkAudit(fd: FormData) {
  await me(); const audit = String(fd.get("audit")); const sub = str(fd, "sub");
  await db().from("audits").update({ subcontractor_id: sub, kind: sub ? "subcontractor" : undefined }).eq("id", audit); touch(); revalidatePath(`/comp/audits/${audit}`);
}
