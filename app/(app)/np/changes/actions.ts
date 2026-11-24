"use server";
import { leadOf, noticeFor } from "@/lib/np-notice";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { createAuthorityFile } from "@/lib/authority-create";

const v = (fd: FormData, k: string) => { const x = String(fd.get(k) ?? "").trim(); return x || null; };
type Change = { id: string; entity: string; post_code: string; post_title: string | null; seat: "holder" | "deputy"; from_name: string | null; to_name: string | null; to_person: string | null; effective_on: string | null;
  reason: string | null; acceptance: "required" | "not_required"; authority_file_id: string | null; status: string };
const paths = () => { revalidatePath("/np/changes"); revalidatePath("/np/over"); };

async function guard(id: string) {
  const s = await getSession(); if (!s || !isCmm(s)) return null;
  const db = supabaseAdmin(); const { data } = await db.from("np_changes").select("*").eq("id", id).maybeSingle();
  const c = data as Change | null;
  if (!c || (!s.group && !s.entities.includes(c.entity))) return null;
  return { s, db, c };
}

/** NP-02 · a change of holder or deputy is prepared: nothing moves on the post until it is applied. */
export async function createChange(fd: FormData) {
  const s = await getSession(); if (!s || !isCmm(s)) return;
  const entity = String(fd.get("entity") ?? ""); if (!s.group && !s.entities.includes(entity)) return;
  const code = String(fd.get("post_code") ?? ""); const seat = fd.get("seat") === "deputy" ? "deputy" : "holder";
  const db = supabaseAdmin();
  const { data: p } = await db.from("np_posts").select("code,title,holder_name,deputy_name,status").eq("entity", entity).eq("code", code).maybeSingle();
  const post = p as { code: string; title: string; holder_name: string | null; deputy_name: string | null; status: string } | null;
  if (!post) return;
  const personId = v(fd, "to_person");
  const { data: pp } = personId ? await db.from("people").select("id,display_name").eq("id", personId).maybeSingle() : { data: null };
  const person = pp as { id: string; display_name: string } | null;
  const row = { entity, post_code: post.code, post_title: post.title, seat, from_name: seat === "holder" ? post.holder_name : post.deputy_name, to_name: person?.display_name ?? v(fd, "to_name"), to_person: person?.id ?? null,
    effective_on: v(fd, "effective_on"), authority_notice_days: Number(v(fd, "authority_notice_days") ?? 0) > 0 ? Math.min(365, Math.round(Number(v(fd, "authority_notice_days")))) : null, reason: v(fd, "reason"), acceptance: fd.get("acceptance") === "not_required" ? "not_required" : "required", created_by: s.person?.id ?? null };
  if ((row.from_name ?? "") === (row.to_name ?? "")) redirect(`/np/changes?entity=${entity}&err=same`);
  // 24/11 (Guillaume) · a notice shorter than the regulation can be asked, once the desk has been told the legal notice and has written why
  const nt = row.acceptance === "required" && row.effective_on ? noticeFor(entity, post.code, row.authority_notice_days) : null;
  const left = nt && nt.days ? leadOf(nt, new Date().toISOString().slice(0, 10), row.effective_on!) : null;
  const why = v(fd, "short_notice_reason");
  if (nt && left !== null && left < nt.days && !why) redirect(`/np/changes?entity=${entity}&new=1&post=${encodeURIComponent(post.code)}&err=notice&legal=${encodeURIComponent(`${nt.ref} asks for at least ${nt.text}`)}&left=${encodeURIComponent(`${Math.max(left, 0)} ${nt.working ? "working days" : "days"}`)}`);
  Object.assign(row, { short_notice_reason: nt && left !== null && left < nt.days ? why : null });
  const { data: ins } = await db.from("np_changes").insert(row).select("id").single();
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "np_change", object_id: (ins as { id: string } | null)?.id ?? code, action: "np_change_prepared", after: row });
  paths(); redirect(`/np/changes?entity=${entity}`);
}

/** Opens the CAA application of the change (type NP) and ties it to the change. */
export async function openApplication(fd: FormData) {
  const g = await guard(String(fd.get("id") ?? "")); if (!g) return; const { s, db, c } = g;
  if (c.authority_file_id || c.status !== "open") return;
  let fileId: string | null = null;
  try {
    const f = await createAuthorityFile(db, { personId: s.person?.id ?? null, name: s.name }, { entity: c.entity, type_code: "NP", np_post_code: c.post_code, trigger_kind: "np", target_date: c.effective_on,
      title: `${c.post_code}${c.seat === "deputy" ? " deputy" : ""}: ${c.to_name ?? "vacant"}${c.from_name ? ` (replaces ${c.from_name})` : ""}`, trigger_note: c.reason });
    fileId = f.id;
  } catch { redirect(`/np/changes?entity=${c.entity}&err=file`); }
  await db.from("np_changes").update({ authority_file_id: fileId }).eq("id", c.id);
  paths(); revalidatePath("/proj/auth"); redirect(`/proj/auth/${fileId}`);
}

/** Ties the change to a CAA application that already exists. */
export async function linkApplication(fd: FormData) {
  const g = await guard(String(fd.get("id") ?? "")); if (!g) return; const { db, c } = g;
  const fid = v(fd, "file_id"); if (!fid || c.status !== "open") return;
  const { data: f } = await db.from("authority_files").select("id,entity").eq("id", fid).maybeSingle();
  if (!f || (f as { entity: string }).entity !== c.entity) return;
  await db.from("np_changes").update({ authority_file_id: fid }).eq("id", c.id);
  paths();
}

/** Compliance applies the change: the post takes the new name, the date and the acceptance status. The organisation charts of the
 *  manuals are then shown "out of date" on Posts & org chart until their revision. */
export async function applyChange(fd: FormData) {
  const g = await guard(String(fd.get("id") ?? "")); if (!g) return; const { s, db, c } = g;
  if (c.status !== "open") return;
  const as = c.acceptance === "not_required" ? "not_required" : fd.get("as") === "accepted" ? "accepted" : "pending";
  const { data: before } = await db.from("np_posts").select("*").eq("entity", c.entity).eq("code", c.post_code).maybeSingle();
  if (!before) return;
  const now = new Date().toISOString();
  const upd = c.seat === "holder"
    ? { holder_name: c.to_name, holder_person: c.to_person, since: c.effective_on ?? now.slice(0, 10), status: as, updated_at: now, updated_by: s.person?.id ?? null }
    : { deputy_name: c.to_name, deputy_person: c.to_person, updated_at: now, updated_by: s.person?.id ?? null };
  await db.from("np_posts").update(upd).eq("entity", c.entity).eq("code", c.post_code);
  await db.from("np_changes").update({ status: "applied", applied_as: as, applied_at: now, applied_by: s.person?.id ?? null }).eq("id", c.id);
  // 24/11 (Guillaume) · the rights in S.A.M. follow the post: the person who takes the seat receives the post (and the entity), the
  // person who leaves it loses the post unless another seat of the same post is still theirs. Written in the audit log.
  const role = c.seat === "deputy" ? `${c.post_code}_DEP` : c.post_code;
  const b = before as { id: string; holder_person: string | null; deputy_person: string | null };
  const outId = c.seat === "holder" ? b.holder_person : b.deputy_person;
  const rights: Record<string, unknown> = { role };
  type Pp = { id: string; display_name: string; roles: string[] | null; entities: string[] | null };
  if (c.to_person) {
    const { data: inP } = await db.from("people").select("id,display_name,roles,entities").eq("id", c.to_person).maybeSingle(); const p = inP as Pp | null;
    if (p) { const roles = [...new Set([...(p.roles ?? []), role])]; const entities = [...new Set([...(p.entities ?? []), c.entity])];
      await db.from("people").update({ roles, entities }).eq("id", p.id); rights.given_to = p.display_name;
      await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: c.entity, object_type: "person", object_id: p.id, action: "roles_changed_by_np_change", before: { roles: p.roles, entities: p.entities }, after: { roles, entities, change: c.id } }); }
  } else if (c.to_name) rights.not_given = `${c.to_name} has no account in S.A.M. yet`;
  if (outId && outId !== c.to_person) {
    const col = c.seat === "holder" ? "holder_person" : "deputy_person";
    const { data: still } = await db.from("np_posts").select("id").eq("code", c.post_code).eq(col, outId).limit(1);
    const { data: outP } = await db.from("people").select("id,display_name,roles,entities").eq("id", outId).maybeSingle(); const p = outP as Pp | null;
    if (p && !(still ?? []).length && (p.roles ?? []).includes(role)) { const roles = (p.roles ?? []).filter((r) => r !== role);
      await db.from("people").update({ roles: roles.length ? roles : ["USER"] }).eq("id", p.id); rights.removed_from = p.display_name;
      await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: c.entity, object_type: "person", object_id: p.id, action: "roles_changed_by_np_change", before: { roles: p.roles }, after: { roles: roles.length ? roles : ["USER"], change: c.id } }); }
  }
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: c.entity, object_type: "np_post", object_id: b.id, action: "np_change_applied", before, after: { ...upd, change: c.id, seat: c.seat, acceptance: as, rights } });
  paths();
}

export async function cancelChange(fd: FormData) {
  const g = await guard(String(fd.get("id") ?? "")); if (!g) return; const { s, db, c } = g;
  if (c.status !== "open") return;
  await db.from("np_changes").update({ status: "cancelled", cancel_note: v(fd, "note") }).eq("id", c.id);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: c.entity, object_type: "np_change", object_id: c.id, action: "np_change_cancelled", after: { note: v(fd, "note") } });
  paths();
}

/** The authority has accepted a holder applied as "pending": the post is set to accepted. */
export async function markAccepted(fd: FormData) {
  const g = await guard(String(fd.get("id") ?? "")); if (!g) return; const { s, db, c } = g;
  if (c.status !== "applied" || c.seat !== "holder") return;
  await db.from("np_posts").update({ status: "accepted", updated_at: new Date().toISOString(), updated_by: s.person?.id ?? null }).eq("entity", c.entity).eq("code", c.post_code);
  await db.from("np_changes").update({ applied_as: "accepted" }).eq("id", c.id);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: c.entity, object_type: "np_change", object_id: c.id, action: "np_change_accepted", after: { post: c.post_code } });
  paths();
}
