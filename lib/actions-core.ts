import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action } from "@/lib/actions";

type Actor = { personId: string | null; name: string };
const log = (db: SupabaseClient, action_id: string, kind: string, actor: string | null, note: string) => db.from("safety_action_events").insert({ action_id, kind, actor, note });
const closeTasks = (db: SupabaseClient, id: string, kinds: string[]) => db.from("tasks").update({ status: "done" }).in("kind", kinds).eq("ref_id", id).eq("status", "open");
export const ownerTaskRow = (a: Pick<Action, "id" | "entity" | "number" | "title" | "due" | "owner_role" | "owner_person">) =>
  ({ entity: a.entity, kind: "action", title: `${a.number} — ${a.title}`.slice(0, 200), detail: "Safety action: do it, then mark it done with the evidence.", due: a.due, owner_role: a.owner_person ? null : a.owner_role, owner_person: a.owner_person, status: "open", link: `/safe/actions/${a.id}`, ref_id: a.id });

/** The owner reports the action done. At least one piece of evidence must exist (a file or a name recorded in the app, or the note given here). Opens the SM verification. */
export async function completeAction(db: SupabaseClient, actor: Actor, a: Action, note: string, evidenceNote: string | null, via: "app" | "teams" = "app"): Promise<void> {
  if (!["open", "in_progress"].includes(a.status)) return;
  if (!note) throw new Error("Say what was done.");
  if (evidenceNote) await db.from("safety_action_evidence").insert({ action_id: a.id, name: via === "teams" ? "Note (via Teams)" : "Note", path: null, note: evidenceNote, added_by: actor.personId });
  const { count } = await db.from("safety_action_evidence").select("id", { count: "exact", head: true }).eq("action_id", a.id);
  if (!count) throw new Error("Add the evidence (a file, the name of a document kept on the server, or a note describing it).");
  await db.from("safety_actions").update({ status: "done", done_at: new Date().toISOString(), done_by: actor.personId, done_note: note, updated_at: new Date().toISOString() }).eq("id", a.id);
  await closeTasks(db, a.id, ["action"]);
  await db.from("tasks").insert({ entity: a.entity, kind: "action_verify", title: `Verify ${a.number} — ${a.title}`.slice(0, 200), detail: `Done by ${actor.name}: ${note}`.slice(0, 500), owner_role: "SM", status: "open", link: `/safe/actions/${a.id}`, ref_id: a.id });
  await log(db, a.id, "done", actor.personId, `Done by ${actor.name}${via === "teams" ? " (via Teams)" : ""} — ${note}`);
}
/** Safety desk: accept (closed, with a date to check effectiveness) or send back to the owner. */
export async function verifyActionCore(db: SupabaseClient, actor: Actor, a: Action, verdict: "accept" | "back", note: string | null, effectivenessDue: string | null, via: "app" | "teams" = "app"): Promise<void> {
  if (a.status !== "done") return;
  const tag = via === "teams" ? " (via Teams)" : "";
  if (verdict === "back") {
    if (!note) throw new Error("Say what is missing.");
    await db.from("safety_actions").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", a.id);
    await closeTasks(db, a.id, ["action_verify"]); await db.from("tasks").insert(ownerTaskRow({ ...a, title: `${a.title} — completion requested` }));
    await log(db, a.id, "sent_back", actor.personId, `Sent back to the owner by ${actor.name}${tag} — ${note}`); return;
  }
  await db.from("safety_actions").update({ status: "verified", verified_at: new Date().toISOString(), verified_by: actor.personId, verified_note: note, effectiveness_due: effectivenessDue, updated_at: new Date().toISOString() }).eq("id", a.id);
  await closeTasks(db, a.id, ["action_verify"]);
  if (a.mitigation_id) await db.from("hazard_mitigations").update({ done_at: new Date().toISOString() }).eq("id", a.mitigation_id).is("done_at", null);
  if (a.report_id) await db.from("report_events").insert({ report_id: a.report_id, kind: "action", actor: actor.personId, note: `Action ${a.number} verified and closed` });
  await log(db, a.id, "verified", actor.personId, `Verified and closed by ${actor.name}${tag}${note ? ` — ${note}` : ""}${effectivenessDue ? `; effectiveness to check on ${effectivenessDue}` : ""}`);
}
