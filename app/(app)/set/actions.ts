"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* Settings: entities, parameters, Entra groups, people details. CMM and super admin only; every change goes to the audit log. */
const db = () => supabaseAdmin();
export async function isAdmin(s: Session): Promise<boolean> { return s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r)); }
async function admin(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); if (!(await isAdmin(s))) throw new Error("CMM or super admin only."); return s; }
const log = (s: Session, object_type: string, object_id: string, action: string, after: unknown, entity: string | null = null) =>
  db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type, object_id, action, after });

export async function saveEntity(fd: FormData) {
  const s = await admin(); const code = String(fd.get("code"));
  const row = { name: String(fd.get("name") ?? "").trim(), authority: String(fd.get("authority") ?? "").trim(), approvals: String(fd.get("approvals") ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean) };
  if (!row.name || !row.authority) throw new Error("Name and authority are required.");
  await db().from("entities").update(row).eq("code", code); await log(s, "entity", code, "entity_updated", row, code);
  revalidatePath("/set/ent");
}
export async function saveParam(fd: FormData) {
  const s = await admin(); const key = String(fd.get("key")); const value = String(fd.get("value") ?? "").trim();
  if (!value) throw new Error("A value is required.");
  await db().from("app_params").update({ value, updated_by: s.person?.id ?? null, updated_at: new Date().toISOString() }).eq("key", key);
  await log(s, "parameter", key, "parameter_updated", { value });
  revalidatePath("/set/param");
}
const ROLE_RE = /^[A-Z][A-Z0-9_-]{1,20}$/;
export async function saveGroup(fd: FormData) {
  const s = await admin(); const id = String(fd.get("group_id") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("The group id is the GUID shown in Entra (36 characters).");
  const role = String(fd.get("role") ?? "").trim().toUpperCase();
  const entity = String(fd.get("entity") ?? "") || null;
  const gf = fd.get("is_group_function") === "on";
  if (role && !ROLE_RE.test(role)) throw new Error("Role: a post code such as CMM, NPFO, USER.");
  const row = { group_id: id, name: String(fd.get("name") ?? "").trim() || null, entity: gf ? null : entity, role: role || null, is_group_function: gf, mapped_at: new Date().toISOString() };
  await db().from("entra_groups").upsert(row, { onConflict: "group_id" }); await log(s, "entra_group", id, "entra_group_mapped", row, row.entity);
  revalidatePath("/set/groups");
}
export async function removeGroup(fd: FormData) {
  const s = await admin(); const id = String(fd.get("group_id"));
  await db().from("entra_groups").update({ role: null, entity: null, is_group_function: false, mapped_at: null }).eq("group_id", id); await log(s, "entra_group", id, "entra_group_unmapped", null);
  revalidatePath("/set/groups");
}
export async function savePerson(fd: FormData) {
  const s = await admin(); const id = String(fd.get("id"));
  const row = { job_title: String(fd.get("job_title") ?? "").trim() || null, can_create_manuals: fd.get("can_create_manuals") === "on" };
  await db().from("people").update(row).eq("id", id); await log(s, "person", id, "person_updated", row);
  revalidatePath("/users/book"); redirect(`/users/book?p=${id}`);
}
