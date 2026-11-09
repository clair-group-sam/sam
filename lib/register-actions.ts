"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { REGS, type Reg } from "@/lib/registers";

/** May this person write in the register? CMM / SUPERADMIN always, plus the posts the register names (deputies included). */
export async function mayWrite(s: Session, reg: Reg): Promise<boolean> {
  const posts = s.roles.map(basePost);
  return s.role === "cmm" || posts.some((p) => p === "CMM" || p === "SUPERADMIN" || reg.posts.includes(p));
}

function valueOf(reg: Reg, fd: FormData, k: string): unknown {
  const f = reg.fields.find((x) => x.k === k)!;
  const raw = String(fd.get(k) ?? "").trim();
  if (f.type === "bool") return raw === "yes" ? true : raw === "no" ? false : null;
  if (f.type === "number") { if (!raw) return null; const n = Number(raw); return Number.isFinite(n) ? n : null; }
  if (f.type === "ref") return /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  if (f.type === "select") return raw && f.options?.some(([v]) => v === raw) ? raw : null;
  return raw || null;
}

/** Create or update one row of a register (whitelisted table and fields). */
export async function saveRegisterRow(fd: FormData) {
  const s = await getSession(); if (!s) redirect("/login");
  const reg = REGS[String(fd.get("__reg") ?? "")];
  if (!reg) throw new Error("Unknown register.");
  if (!(await mayWrite(s, reg))) throw new Error("Your post cannot change this register.");
  const db = supabaseAdmin();
  const row: Record<string, unknown> = {};
  for (const f of reg.fields) { const v = valueOf(reg, fd, f.k); if (v !== null || fd.has(f.k)) row[f.k] = v; }
  for (const f of reg.fields) if (f.required && (row[f.k] === null || row[f.k] === undefined)) throw new Error(`${f.label} is required.`);
  const id = String(fd.get("id") ?? "");
  if (id) {
    const { data: cur } = await db.from(reg.table).select("entity").eq("id", id).maybeSingle();
    const ent = (cur as { entity?: string } | null)?.entity;
    if (!ent || (!s.group && !s.entities.includes(ent))) throw new Error("Out of your scope.");
    const { error } = await db.from(reg.table).update(row).eq("id", id); if (error) throw new Error(error.message);
    await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: ent, object_type: reg.table, object_id: id, action: "updated", after: row });
  } else {
    const entity = String(fd.get("entity") ?? "");
    if (!entity || (!s.group && !s.entities.includes(entity))) throw new Error("Pick an entity in your scope.");
    const { data, error } = await db.from(reg.table).insert({ entity, ...row }).select("id").single(); if (error) throw new Error(error.message);
    await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: reg.table, object_id: String((data as { id: string }).id), action: "created", after: row });
  }
  revalidatePath(reg.path);
  redirect(reg.path);
}

/** Archive (never delete): rows with an `active` column are hidden; others keep their history and are closed by status. */
export async function archiveRegisterRow(fd: FormData) {
  const s = await getSession(); if (!s) redirect("/login");
  const reg = REGS[String(fd.get("__reg") ?? "")];
  if (!reg || !(await mayWrite(s, reg))) throw new Error("Not allowed.");
  const id = String(fd.get("id") ?? "");
  const db = supabaseAdmin();
  const { data: cur } = await db.from(reg.table).select("entity").eq("id", id).maybeSingle();
  const ent = (cur as { entity?: string } | null)?.entity;
  if (!ent || (!s.group && !s.entities.includes(ent))) throw new Error("Out of your scope.");
  const { error } = await db.from(reg.table).update({ active: false }).eq("id", id);
  if (error) throw new Error("This register keeps every row: change its status instead.");
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: ent, object_type: reg.table, object_id: id, action: "archived", after: null });
  revalidatePath(reg.path);
  redirect(reg.path);
}
