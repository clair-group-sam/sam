// TMS-05 · a file sent to S.A.M. in the personal chat becomes the evidence of a task the person chooses (safety action or authority file).
import type { SupabaseClient } from "@supabase/supabase-js";
import { botToken, origin, type TaskRow } from "@/lib/teams";
import { basePost } from "@/lib/session";

export type TeamsFile = { id: string; person_id: string; name: string; content_type: string | null; size: number | null; path: string; note: string | null; status: string };
type Att = { contentType: string; contentUrl?: string; name?: string; content?: { downloadUrl?: string; fileType?: string; uniqueId?: string } };
const MAX = 10 * 1024 * 1024;
const safeName = (n: string) => n.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "file";
const ATTACHABLE = new Set(["action", "authority", "authority_followup"]);

/** Downloads the files of an incoming activity (Teams file cards, or inline images) and keeps them in the evidence bucket, pending. */
export async function saveIncomingFiles(db: SupabaseClient, personId: string, attachments: Att[], note: string): Promise<{ files: TeamsFile[]; errors: string[] }> {
  const files: TeamsFile[] = []; const errors: string[] = [];
  for (const a of attachments) {
    try {
      let url: string | null = null; let headers: Record<string, string> = {}; let name = a.name ?? "file"; let ct = a.contentType;
      if (a.contentType === "application/vnd.microsoft.teams.file.download.info" && a.content?.downloadUrl) { url = a.content.downloadUrl; ct = a.content.fileType ? `application/${a.content.fileType}` : "application/octet-stream"; }
      else if (/^image\//.test(a.contentType) && a.contentUrl) { url = a.contentUrl; headers = { authorization: `Bearer ${await botToken()}` }; name = a.name ?? `image-${Date.now()}.${a.contentType.split("/")[1] ?? "png"}`; }
      if (!url) continue; // text/html parts of the message, cards…
      const r = await fetch(url, { headers });
      if (!r.ok) { errors.push(`${name}: download failed (${r.status})`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX) { errors.push(`${name}: larger than 10 MB — keep it on the server and record its name in S.A.M.`); continue; }
      const safe = safeName(name); const path = `teams/${personId}/${Date.now()}-${safe}`;
      const up = await db.storage.from("evidence").upload(path, buf, { contentType: r.headers.get("content-type") ?? ct ?? "application/octet-stream", upsert: false });
      if (up.error) { errors.push(`${name}: ${up.error.message}`); continue; }
      const { data } = await db.from("teams_files").insert({ person_id: personId, name: safe, content_type: ct, size: buf.length, path, note: note || null }).select("*").maybeSingle();
      if (data) files.push(data as TeamsFile);
    } catch (e) { errors.push(`${a.name ?? "file"}: ${e instanceof Error ? e.message : "error"}`); }
  }
  return { files, errors };
}

/** The open tasks of a person a file can be the evidence of (safety actions, authority files). */
export async function attachableTasks(db: SupabaseClient, person: { id: string; roles: string[] }): Promise<TaskRow[]> {
  const { data } = await db.from("tasks").select("*").eq("status", "open").in("kind", [...ATTACHABLE]).order("due", { ascending: true, nullsFirst: false }).limit(300);
  const posts = new Set(person.roles.map(basePost));
  return ((data ?? []) as TaskRow[]).filter((t) => t.owner_person ? t.owner_person === person.id : t.owner_role ? posts.has(basePost(t.owner_role)) : false).slice(0, 15);
}

export function attachCard(f: TeamsFile, tasks: TaskRow[]): unknown {
  const kb = f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : "";
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [
    { type: "TextBlock", text: "S.A.M. · Evidence", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: `${f.name}${kb ? ` · ${kb}` : ""}`, size: "Medium", weight: "Bolder", wrap: true },
    { type: "TextBlock", text: "Which of your open items is this the evidence of? It is attached there and recorded in its journal.", wrap: true },
    { type: "Input.ChoiceSet", id: "taskId", label: "Attach to", style: "expanded", isRequired: true, errorMessage: "Pick one", choices: tasks.map((t) => ({ title: `${t.entity} · ${t.title.slice(0, 90)}`, value: t.id })) },
    { type: "Input.Text", id: "note", label: "Note (what it shows)", value: f.note ?? "", maxLength: 500 },
  ], actions: [
    { type: "Action.Execute", title: "Attach", verb: "file_attach", style: "positive", data: { fileId: f.id } },
    { type: "Action.Execute", title: "Discard", verb: "file_discard", data: { fileId: f.id } },
  ], msteams: { width: "Full" } };
}
export function attachedCard(f: TeamsFile, where: string, link: string | null): unknown {
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [
    { type: "TextBlock", text: "S.A.M. · Evidence", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: `✓ ${f.name} attached to ${where}`, wrap: true, weight: "Bolder", color: "Good" },
  ], actions: link ? [{ type: "Action.OpenUrl", title: "Open in S.A.M.", url: `${origin()}${link}` }] : [] };
}

/** Attaches a pending file to the object behind a task; the person must be a recipient of that task. */
export async function attachFile(db: SupabaseClient, person: { id: string; display_name: string; roles: string[] }, fileId: string, taskId: string, note: string): Promise<{ ok: true; file: TeamsFile; where: string; link: string | null } | { ok: false; error: string }> {
  const { data: fd } = await db.from("teams_files").select("*").eq("id", fileId).eq("person_id", person.id).maybeSingle();
  const f = fd as TeamsFile | null;
  if (!f) return { ok: false, error: "This file is no longer available." };
  if (f.status !== "pending") return { ok: false, error: `Already ${f.status}.` };
  const task = (await attachableTasks(db, person)).find((t) => t.id === taskId);
  if (!task || !task.ref_id) return { ok: false, error: "This item is not yours, or it cannot take a file." };
  const storagePath = `evidence/${f.path}`; const n = note.trim() || f.note || null;
  if (task.kind === "action") {
    await db.from("safety_action_evidence").insert({ action_id: task.ref_id, name: f.name, path: storagePath, size: f.size, note: n, added_by: person.id });
    await db.from("safety_action_events").insert({ action_id: task.ref_id, kind: "evidence", actor: person.id, note: `Evidence added via Teams by ${person.display_name}: ${f.name}${n ? ` — ${n}` : ""}` });
  } else {
    await db.from("authority_file_attachments").insert({ file_id: task.ref_id, name: f.name, kind: "other", path: storagePath, size: f.size, uploaded_by: person.id });
    await db.from("authority_file_events").insert({ file_id: task.ref_id, kind: "attachment", who: person.display_name, actor: person.id, note: `Attached via Teams: ${f.name}${n ? ` — ${n}` : ""}`, meta: { via: "teams" } });
  }
  await db.from("teams_files").update({ status: "attached", task_id: task.id, target_kind: task.kind === "action" ? "action" : "authority", target_id: task.ref_id, note: n, attached_at: new Date().toISOString() }).eq("id", f.id);
  await db.from("audit_log").insert({ actor: person.id, entity: task.entity, object_type: task.kind === "action" ? "safety_action" : "authority_file", object_id: task.ref_id, action: "evidence_via_teams", after: { file: f.name, task: task.id } });
  return { ok: true, file: f, where: task.title, link: task.link };
}
export async function discardFile(db: SupabaseClient, personId: string, fileId: string): Promise<void> {
  const { data } = await db.from("teams_files").select("*").eq("id", fileId).eq("person_id", personId).eq("status", "pending").maybeSingle();
  const f = data as TeamsFile | null; if (!f) return;
  await db.storage.from("evidence").remove([f.path]);
  await db.from("teams_files").update({ status: "discarded" }).eq("id", f.id);
}
