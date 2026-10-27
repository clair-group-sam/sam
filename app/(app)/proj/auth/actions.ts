"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { addDays, movesFrom, recordRound, routeFor, syncTasks, today, type AuthorityFile, type FileType, type Stage } from "@/lib/authority";

type Db = ReturnType<typeof supabaseAdmin>;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;

async function guard(id: string): Promise<{ s: Session; db: Db; f: AuthorityFile; cmm: boolean; owner: boolean }> {
  const s = await getSession();
  if (!s) throw new Error("Not signed in");
  const db = supabaseAdmin();
  const { data } = await db.from("authority_files").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("File not found");
  const f = data as AuthorityFile;
  if (!s.group && !s.entities.includes(f.entity)) throw new Error("Out of scope");
  const cmm = isCmm(s);
  const owner = f.owner_person ? s.person?.id === f.owner_person : !!f.owner_role && s.roles.map(basePost).includes(basePost(f.owner_role));
  return { s, db, f, cmm, owner };
}
async function event(db: Db, s: Session, fileId: string, kind: string, note: string | null, meta?: Record<string, unknown>) {
  await db.from("authority_file_events").insert({ file_id: fileId, kind, who: s.name, actor: s.person?.id ?? null, note, meta: meta ?? null });
}
async function audit(db: Db, s: Session, f: AuthorityFile, action: string, after: unknown) {
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: f.entity, object_type: "authority_file", object_id: f.id, action, after });
}
function paths(id?: string) { revalidatePath("/proj/auth"); revalidatePath("/proj/boards"); revalidatePath("/proj/rex"); revalidatePath("/home/tasks"); if (id) revalidatePath(`/proj/auth/${id}`); }

/** New file from a type: route and checklist copied from the type at creation (the type can change later, the file keeps its own list). */
export async function createFile(formData: FormData) {
  const s = await getSession();
  if (!s) throw new Error("Not signed in");
  const entity = str(formData, "entity");
  if (!s.group && !s.entities.includes(entity)) throw new Error("Out of scope");
  const db = supabaseAdmin();
  const { data: t } = await db.from("authority_file_types").select("*").eq("code", str(formData, "type_code")).maybeSingle();
  if (!t) throw new Error("Unknown type");
  const type = t as FileType;
  const route = routeFor(type, entity);
  const triggered = opt(formData, "triggered_at") ?? today();
  const row = {
    entity, type_code: type.code, title: str(formData, "title") || type.name, stage: "draft",
    category: route.category, authority: route.authority, portal: route.portal,
    owner_role: opt(formData, "owner_role") ?? type.default_owner_role, owner_person: null,
    trigger_kind: opt(formData, "trigger_kind"), trigger_note: opt(formData, "trigger_note"),
    revision_id: opt(formData, "revision_id"), finding_ref: opt(formData, "finding_ref"), aircraft_reg: opt(formData, "aircraft_reg"), np_post_code: opt(formData, "np_post_code"), moc_ref: opt(formData, "moc_ref"),
    triggered_at: triggered, target_date: opt(formData, "target_date") ?? addDays(triggered, type.target_days + 14),
    created_by: s.person?.id ?? null,
  };
  const { data: created, error } = await db.from("authority_files").insert(row).select("*").single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the file");
  const f = created as AuthorityFile;
  if (type.checklist?.length) await db.from("authority_file_items").insert(type.checklist.map((c, i) => ({ file_id: f.id, ord: i + 1, key: c.key, label: c.label, role: c.role ?? null, required: c.required !== false })));
  await event(db, s, f.id, "created", `File opened from type ${type.code}`, { type: type.code, portal: route.portal });
  await audit(db, s, f, "authority_file_created", row);
  await syncTasks(db, f);
  paths(f.id);
  redirect(`/proj/auth/${f.id}`);
}

export async function saveFile(formData: FormData) {
  const id = str(formData, "id");
  const { s, db, f, cmm, owner } = await guard(id);
  if (!cmm && !owner) throw new Error("Not allowed");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields = ["title", "trigger_kind", "trigger_note", "finding_ref", "aircraft_reg", "np_post_code", "moc_ref", "portal_ref", "portal_url", "target_date", "lessons", "revision_id", "owner_role"];
  for (const k of fields) if (formData.has(k)) patch[k] = opt(formData, k);
  if (cmm) { if (formData.has("category")) patch.category = opt(formData, "category"); if (formData.has("portal")) patch.portal = opt(formData, "portal"); if (formData.has("fee")) patch.fee = str(formData, "fee") ? Number(str(formData, "fee")) : null; }
  await db.from("authority_files").update(patch).eq("id", id);
  // the manual revision carries the same reference (shown read-only in the editor's Authority return card)
  if ("portal_ref" in patch && f.revision_id) { await db.from("revisions").update({ authority_ref: patch.portal_ref }).eq("id", f.revision_id); revalidatePath(`/docs/editor/${f.revision_id}`); }
  await event(db, s, id, "note", "Details updated", patch);
  await audit(db, s, f, "authority_file_updated", patch);
  paths(id);
}

export async function toggleItem(formData: FormData) {
  const id = str(formData, "file_id"); const itemId = str(formData, "item_id");
  const { s, db, cmm, owner } = await guard(id);
  if (!cmm && !owner) throw new Error("Not allowed");
  const { data: it } = await db.from("authority_file_items").select("*").eq("id", itemId).eq("file_id", id).maybeSingle();
  if (!it) return;
  const done = !(it as { done: boolean }).done;
  const note = opt(formData, "note");
  await db.from("authority_file_items").update({ done, done_by: done ? s.person?.id ?? null : null, done_at: done ? new Date().toISOString() : null, ...(note !== null ? { note } : {}) }).eq("id", itemId);
  await event(db, s, id, "item", `${done ? "Done" : "Reopened"}: ${(it as { label: string }).label}`, { item: (it as { key: string }).key, done });
  paths(id);
}
export async function addItem(formData: FormData) {
  const id = str(formData, "file_id");
  const { s, db, cmm, owner } = await guard(id);
  if (!cmm && !owner) throw new Error("Not allowed");
  const label = str(formData, "label"); if (!label) return;
  const { count } = await db.from("authority_file_items").select("id", { count: "exact", head: true }).eq("file_id", id);
  await db.from("authority_file_items").insert({ file_id: id, ord: (count ?? 0) + 1, key: `x${Date.now().toString(36)}`, label, role: opt(formData, "role"), required: formData.get("required") === "on" });
  await event(db, s, id, "item", `Item added: ${label}`);
  paths(id);
}

/** Stage move (PRJ-01 lifecycle). "Ready" needs every required item done; "Submitted" needs the portal reference. */
export async function moveStage(formData: FormData) {
  const id = str(formData, "id"); const to = str(formData, "to") as Stage; const note = opt(formData, "note");
  const { s, db, f, cmm, owner } = await guard(id);
  const { data: t } = await db.from("authority_file_types").select("needs_signature").eq("code", f.type_code).maybeSingle();
  const move = movesFrom(f.stage, !!(t as { needs_signature?: boolean } | null)?.needs_signature).find((m) => m.to === to);
  if (!move) throw new Error("Move not allowed from this stage");
  if (!(move.by === "cmm" ? cmm : cmm || owner)) throw new Error("Not allowed for your role");
  if (move.needsNote && !note) throw new Error("A note is required for this move");
  if (move.needsAllRequired) {
    const { count } = await db.from("authority_file_items").select("id", { count: "exact", head: true }).eq("file_id", id).eq("required", true).eq("done", false);
    if (count) throw new Error(`${count} required item(s) of the checklist are not done.`);
  }
  const patch: Record<string, unknown> = { stage: to, updated_at: new Date().toISOString() };
  if (to === "submitted" && f.stage === "ready") {
    const ref = opt(formData, "portal_ref"); if (!ref) throw new Error("The portal reference is required (application / dossier number)");
    const at = opt(formData, "submitted_at") ?? today();
    patch.portal_ref = ref; patch.portal_url = opt(formData, "portal_url") ?? f.portal_url; patch.submitted_at = at;
    const { data: ty } = await db.from("authority_file_types").select("target_days").eq("code", f.type_code).maybeSingle();
    patch.target_date = opt(formData, "target_date") ?? addDays(at, (ty as { target_days?: number } | null)?.target_days ?? 20);
  }
  if (to === "remarks") patch.rounds = (f.rounds ?? 0) + 1;
  if (to === "approved") { patch.decision_at = opt(formData, "decision_at") ?? today(); patch.outcome = opt(formData, "outcome") ?? (f.category === "notification" || f.category === "communication" ? "acknowledged" : "approved"); if (str(formData, "fee")) patch.fee = Number(str(formData, "fee")); }
  if (to === "closed") patch.closed_at = today();
  if (to === "draft" && f.stage === "standby") patch.closed_at = null;
  await db.from("authority_files").update(patch).eq("id", id);
  const kind = to === "submitted" && f.stage === "ready" ? "submitted" : to === "remarks" ? "remarks" : to === "submitted" ? "reply" : to === "approved" ? "decision" : "stage";
  await event(db, s, id, kind, note ?? `${f.stage} → ${to}`, { from: f.stage, to, ...patch });
  await audit(db, s, f, `authority_file_${to}`, { from: f.stage, note });
  // every exchange is a round of the same application (DOC-09), on the file and on its manual revision when there is one
  if (kind === "submitted" || kind === "remarks" || kind === "reply" || kind === "decision") {
    const at = kind === "submitted" ? String(patch.submitted_at) : kind === "decision" ? String(patch.decision_at) : today();
    await recordRound(db, f, { at, direction: kind === "submitted" || kind === "reply" ? "sent" : "received", who: s.name, note: note ?? (kind === "submitted" ? `Application ${patch.portal_ref ?? f.portal_ref ?? ""} submitted` : kind === "decision" ? `Decision: ${patch.outcome}` : `Authority remarks (round ${patch.rounds ?? f.rounds})`) });
    if (kind === "submitted" && f.revision_id) await db.from("revisions").update({ authority_ref: patch.portal_ref }).eq("id", f.revision_id).is("authority_ref", null);
  }
  const { data: fresh } = await db.from("authority_files").select("*").eq("id", id).maybeSingle();
  await syncTasks(db, fresh as AuthorityFile);
  paths(id);
}

export async function addNote(formData: FormData) {
  const id = str(formData, "id");
  const { s, db, f } = await guard(id);
  const note = str(formData, "note"); if (!note) return;
  const kind = str(formData, "kind") || "note";
  await event(db, s, id, kind, note);
  // a remark received or a reply sent, noted in the journal, is an exchange round as well
  if (kind === "remarks" || kind === "reply") await recordRound(db, f, { direction: kind === "reply" ? "sent" : "received", who: s.name, note });
  paths(id);
}
/** One exchange with the authority recorded by hand (mail, call, portal comment): shown on the file and on the revision's Publish tab. */
export async function addRound(formData: FormData) {
  const id = str(formData, "id");
  const { s, db, f, cmm, owner } = await guard(id);
  if (!cmm && !owner) throw new Error("Not allowed");
  const note = str(formData, "note"); if (!note) return;
  const direction = str(formData, "direction") === "sent" ? "sent" : "received";
  const at = opt(formData, "at") ?? today();
  await recordRound(db, f, { direction, who: opt(formData, "who") ?? s.name, note, at });
  await event(db, s, id, direction === "sent" ? "reply" : "remarks", `${direction === "sent" ? "Sent to" : "Received from"} ${f.authority ?? "the authority"} (${at}): ${note}`);
  if (direction === "received" && (f.stage === "submitted" || f.stage === "remarks")) await audit(db, s, f, "authority_round_received", { at, note });
  paths(id);
  if (f.revision_id) revalidatePath(`/docs/editor/${f.revision_id}`);
}

/** Attachment: a file dropped on the page goes to the private bucket evidence/<ENT>/authority/<file id>/<name>. */
export async function addAttachment(formData: FormData) {
  const id = str(formData, "id");
  const { s, db, f, cmm, owner } = await guard(id);
  if (!cmm && !owner) throw new Error("Not allowed");
  const file = formData.get("file");
  const name = str(formData, "name");
  const kind = opt(formData, "kind");
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) throw new Error("File larger than 10 MB: keep it on the server (MOC folder) and record its name here.");
    const safe = file.name.replace(/[^\w.\-() ]+/g, "_");
    const path = `${f.entity}/authority/${f.id}/${safe}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await db.storage.from("evidence").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (error) throw new Error(error.message);
    await db.from("authority_file_attachments").insert({ file_id: id, name: safe, kind, path: `evidence/${path}`, size: file.size, uploaded_by: s.person?.id ?? null });
    await event(db, s, id, "attachment", `Attached: ${safe} (${Math.round(file.size / 1024)} KB)`);
  } else if (name) {
    // a document kept on the server (too large, or in the MOC folder): recorded by name only
    await db.from("authority_file_attachments").insert({ file_id: id, name, kind, path: null, size: null, uploaded_by: s.person?.id ?? null });
    await event(db, s, id, "attachment", `Recorded (on the server): ${name}`);
  }
  paths(id);
}
export async function removeAttachment(formData: FormData) {
  const id = str(formData, "id"); const aid = str(formData, "attachment_id");
  const { s, db, cmm } = await guard(id);
  if (!cmm) throw new Error("Not allowed");
  const { data: a } = await db.from("authority_file_attachments").select("*").eq("id", aid).eq("file_id", id).maybeSingle();
  if (!a) return;
  const att = a as { name: string; path: string | null };
  if (att.path?.startsWith("evidence/")) await db.storage.from("evidence").remove([att.path.slice(9)]);
  await db.from("authority_file_attachments").delete().eq("id", aid);
  await event(db, s, id, "attachment", `Removed: ${att.name}`);
  paths(id);
}

/** Super admin only: delete an authority file that never left the house (draft / compliance / ready, no portal reference). Attachments go with it. */
export async function deleteFile(formData: FormData) {
  const id = str(formData, "id");
  const { s, db, f } = await guard(id);
  if (!s.roles.includes("SUPERADMIN")) throw new Error("Super admin only");
  if (formData.get("confirm") !== "on") throw new Error("Tick the confirmation to delete");
  if (f.portal_ref || !["draft", "compliance", "signing", "ready", "standby"].includes(f.stage)) throw new Error("A file that reached the authority is never deleted — put it on standby or close it.");
  const { data: atts } = await db.from("authority_file_attachments").select("path").eq("file_id", id);
  const keys = ((atts ?? []) as { path: string | null }[]).map((a) => a.path).filter((x): x is string => !!x && x.startsWith("evidence/")).map((x) => x.slice(9));
  if (keys.length) await db.storage.from("evidence").remove(keys);
  await db.from("tasks").update({ status: "superseded" }).eq("ref_id", id).eq("status", "open");
  await db.from("project_tasks").update({ link_id: null, status: "todo", updated_at: new Date().toISOString() }).eq("link_kind", "authority_file").eq("link_id", id);
  await db.from("authority_rounds").delete().eq("file_id", id).is("revision_id", null);
  await audit(db, s, f, "authority_file_deleted", { title: f.title, type: f.type_code, stage: f.stage });
  await db.from("authority_files").delete().eq("id", id);   // items, events, attachments: on delete cascade
  paths();
  redirect("/proj/auth");
}
