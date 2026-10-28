import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, movesFrom, recordRound, syncTasks, today, type AuthorityFile, type Stage } from "@/lib/authority";

export type Actor = { personId: string | null; name: string; cmm: boolean; owner: boolean };
export type MoveInput = { note?: string | null; portal_ref?: string | null; portal_url?: string | null; submitted_at?: string | null; target_date?: string | null; decision_at?: string | null; outcome?: string | null; fee?: number | null };

/** Moves an authority file to another stage — the one rule set for the app (Projects › Authority files) and the Teams card. Throws on a refused move. */
export async function applyMove(db: SupabaseClient, actor: Actor, f: AuthorityFile, to: Stage, input: MoveInput, via: "app" | "teams" = "app"): Promise<AuthorityFile> {
  const note = input.note?.trim() || null;
  const { data: t } = await db.from("authority_file_types").select("needs_signature,target_days").eq("code", f.type_code).maybeSingle();
  const ty = t as { needs_signature?: boolean; target_days?: number } | null;
  const move = movesFrom(f.stage, !!ty?.needs_signature).find((m) => m.to === to);
  if (!move) throw new Error("Move not allowed from this stage");
  if (!(move.by === "cmm" ? actor.cmm : actor.cmm || actor.owner)) throw new Error("Not allowed for your role");
  if (move.needsNote && !note) throw new Error("A note is required for this move");
  if (move.needsAllRequired) {
    const { count } = await db.from("authority_file_items").select("id", { count: "exact", head: true }).eq("file_id", f.id).eq("required", true).eq("done", false);
    if (count) throw new Error(`${count} required item(s) of the checklist are not done.`);
  }
  const patch: Record<string, unknown> = { stage: to, updated_at: new Date().toISOString() };
  if (to === "submitted" && f.stage === "ready") {
    const ref = input.portal_ref?.trim(); if (!ref) throw new Error("The portal reference is required (application / dossier number)");
    const at = input.submitted_at ?? today();
    patch.portal_ref = ref; patch.portal_url = input.portal_url ?? f.portal_url; patch.submitted_at = at;
    patch.target_date = input.target_date ?? addDays(at, ty?.target_days ?? 20);
  }
  if (to === "remarks") patch.rounds = (f.rounds ?? 0) + 1;
  if (to === "approved") { patch.decision_at = input.decision_at ?? today(); patch.outcome = input.outcome ?? (f.category === "notification" || f.category === "communication" ? "acknowledged" : "approved"); if (input.fee != null) patch.fee = input.fee; }
  if (to === "closed") patch.closed_at = today();
  if (to === "draft" && f.stage === "standby") patch.closed_at = null;
  await db.from("authority_files").update(patch).eq("id", f.id);
  const kind = to === "submitted" && f.stage === "ready" ? "submitted" : to === "remarks" ? "remarks" : to === "submitted" ? "reply" : to === "approved" ? "decision" : "stage";
  await db.from("authority_file_events").insert({ file_id: f.id, kind, who: actor.name, actor: actor.personId, note: (note ?? `${f.stage} → ${to}`) + (via === "teams" ? " (via Teams)" : ""), meta: { from: f.stage, to, via, ...patch } });
  await db.from("audit_log").insert({ actor: actor.personId, entity: f.entity, object_type: "authority_file", object_id: f.id, action: `authority_file_${to}`, after: { from: f.stage, note, via } });
  if (kind === "submitted" || kind === "remarks" || kind === "reply" || kind === "decision") {
    const at = kind === "submitted" ? String(patch.submitted_at) : kind === "decision" ? String(patch.decision_at) : today();
    await recordRound(db, f, { at, direction: kind === "submitted" || kind === "reply" ? "sent" : "received", who: actor.name, note: note ?? (kind === "submitted" ? `Application ${patch.portal_ref ?? f.portal_ref ?? ""} submitted` : kind === "decision" ? `Decision: ${patch.outcome}` : `Authority remarks (round ${patch.rounds ?? f.rounds})`) });
    if (kind === "submitted" && f.revision_id) await db.from("revisions").update({ authority_ref: patch.portal_ref }).eq("id", f.revision_id).is("authority_ref", null);
  }
  const { data: fresh } = await db.from("authority_files").select("*").eq("id", f.id).maybeSingle();
  await syncTasks(db, fresh as AuthorityFile);
  return fresh as AuthorityFile;
}
