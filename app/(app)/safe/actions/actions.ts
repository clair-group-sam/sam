"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isOwner, mayManageActions, mayVerifyActions, nextActionNumber, type Action } from "@/lib/actions";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
const log = (action_id: string, kind: string, actor: string | null, note: string) => db().from("safety_action_events").insert({ action_id, kind, actor, note });
async function load(id: string): Promise<Action> { const { data } = await db().from("safety_actions").select("*").eq("id", id).single(); if (!data) throw new Error("Action not found."); return data as Action; }
async function me(entity?: string, check?: (s: Session) => boolean, msg = "Reserved to the safety desk, the nominated persons and the AM."): Promise<Session> {
  const s = await getSession(); if (!s) throw new Error("Sign in again.");
  if (check && !check(s)) throw new Error(msg);
  if (entity && !s.entities.includes(entity)) throw new Error("Entity outside your scope.");
  return s;
}
const touch = (a: Pick<Action, "id" | "report_id" | "hazard_id" | "assessment_id">) => {
  revalidatePath("/safe/actions"); revalidatePath(`/safe/actions/${a.id}`);
  if (a.report_id) revalidatePath(`/safe/reports/${a.report_id}`); if (a.hazard_id) revalidatePath(`/safe/risk/${a.hazard_id}`); if (a.assessment_id) revalidatePath(`/safe/risk/a/${a.assessment_id}`);
};
const closeTasks = (id: string, kinds: string[]) => db().from("tasks").update({ status: "done" }).in("kind", kinds).eq("ref_id", id).eq("status", "open");
const ownerTask = (a: Pick<Action, "id" | "entity" | "number" | "title" | "due" | "owner_role" | "owner_person">) =>
  db().from("tasks").insert({ entity: a.entity, kind: "action", title: `${a.number} — ${a.title}`.slice(0, 200), detail: "Safety action: do it, then mark it done with the evidence.", due: a.due, owner_role: a.owner_person ? null : a.owner_role, owner_person: a.owner_person, status: "open", link: `/safe/actions/${a.id}`, ref_id: a.id });

/** Raise an action — from a safety report (suggested by SAM or not), a hazard / planned mitigation, a risk assessment / MOC, a committee, or on its own. */
export async function createAction(fd: FormData) {
  const entity = str(fd, "entity") ?? ""; const s = await me(entity, mayManageActions);
  const title = str(fd, "title"); if (!title) throw new Error("Give the action a title.");
  if (!str(fd, "owner_role") && !str(fd, "owner_person")) throw new Error("Name the owner (a post or a person).");
  const number = await nextActionNumber(db(), entity);
  const mitigation = str(fd, "mitigation_id");
  const row = { entity, number, module: "safety", kind: str(fd, "kind") ?? "corrective", title: title.slice(0, 300), description: str(fd, "description"), owner_role: str(fd, "owner_role")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person"),
    due: str(fd, "due"), source_kind: str(fd, "source_kind") ?? "other", report_id: str(fd, "report_id"), hazard_id: str(fd, "hazard_id"), mitigation_id: mitigation, assessment_id: str(fd, "assessment_id"), spi_id: str(fd, "spi_id"), committee_id: str(fd, "committee_id"), created_by: s.person?.id ?? null };
  const { data, error } = await db().from("safety_actions").insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Action not created.");
  const a = data as Action;
  await ownerTask(a);
  if (mitigation) { // the planned mitigation is now followed as this action: its own Inbox task is replaced
    const { data: m } = await db().from("hazard_mitigations").update({ action_id: a.id }).eq("id", mitigation).select("text").single();
    const mt = (m as { text: string } | null)?.text; if (mt && a.hazard_id) await db().from("tasks").update({ status: "done" }).eq("kind", "mitigation").eq("ref_id", a.hazard_id).eq("title", `Mitigation — ${mt.slice(0, 120)}`).eq("status", "open");
  }
  if (a.report_id) await db().from("report_events").insert({ report_id: a.report_id, kind: "action", actor: s.person?.id ?? null, note: `Action ${a.number} raised — ${a.title}` });
  await log(a.id, "created", s.person?.id ?? null, `${a.number} raised by ${s.name}`);
  touch(a); if (row.spi_id) revalidatePath(`/safe/over/spi/${row.spi_id}`); if (row.committee_id) revalidatePath(`/safe/comm/${row.committee_id}`);
  if (str(fd, "stay")) return;
  redirect(`/safe/actions/${a.id}`);
}

const EDIT = ["title", "description", "kind", "due", "owner_role", "owner_person"] as const;
export async function updateAction(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity, mayManageActions);
  if (["verified", "cancelled"].includes(a.status)) throw new Error("A closed action is not changed — raise a new one.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }; const changes: string[] = [];
  for (const k of EDIT) if (fd.has(k)) { const v = k === "owner_role" ? str(fd, k)?.toUpperCase() ?? null : str(fd, k); if ((a as unknown as Record<string, unknown>)[k] !== v) { patch[k] = v; changes.push(k.replace("_", " ")); } }
  if (!changes.length) return;
  await db().from("safety_actions").update(patch).eq("id", a.id);
  if (patch.due !== undefined || patch.owner_role !== undefined || patch.owner_person !== undefined) {
    const n = { ...a, ...patch } as Action;
    await db().from("tasks").update({ due: n.due, owner_role: n.owner_person ? null : n.owner_role, owner_person: n.owner_person, title: `${n.number} — ${n.title}`.slice(0, 200) }).eq("kind", "action").eq("ref_id", a.id).eq("status", "open");
  }
  await log(a.id, "updated", s.person?.id ?? null, `Changed: ${changes.join(", ")}${patch.due ? ` (due ${patch.due})` : ""}`);
  touch(a);
}
export async function startAction(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity);
  if (!isOwner(s, a) && !mayManageActions(s)) throw new Error("Reserved to the owner.");
  if (a.status !== "open") return;
  await db().from("safety_actions").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", a.id);
  await log(a.id, "started", s.person?.id ?? null, `In progress (${s.name})`); touch(a);
}

async function storeEvidence(s: Session, a: Action, fd: FormData): Promise<string | null> {
  const file = fd.get("file"); const name = str(fd, "evidence_name"); const note = str(fd, "evidence_note");
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) throw new Error("File larger than 10 MB: keep it on the server and record its name.");
    const safe = file.name.replace(/[^\w.\-() ]+/g, "_"); const path = `${a.entity}/actions/${a.id}/${Date.now()}-${safe}`;
    const { error } = await db().storage.from("evidence").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw new Error(error.message);
    await db().from("safety_action_evidence").insert({ action_id: a.id, name: safe, path: `evidence/${path}`, size: file.size, note, added_by: s.person?.id ?? null });
    return safe;
  }
  if (name) { await db().from("safety_action_evidence").insert({ action_id: a.id, name, path: null, note, added_by: s.person?.id ?? null }); return name; }
  if (note) { await db().from("safety_action_evidence").insert({ action_id: a.id, name: "Note", path: null, note, added_by: s.person?.id ?? null }); return "note"; }
  return null;
}
export async function addEvidence(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity);
  if (!isOwner(s, a) && !mayManageActions(s)) throw new Error("Reserved to the owner and the safety desk.");
  const got = await storeEvidence(s, a, fd); if (!got) return;
  await log(a.id, "evidence", s.person?.id ?? null, `Evidence added: ${got}`); touch(a);
}
/** The owner says it is done (with what was done and, ideally, evidence) → the safety desk verifies. */
export async function markDone(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity);
  if (!isOwner(s, a) && !mayManageActions(s)) throw new Error("Reserved to the owner.");
  if (!["open", "in_progress"].includes(a.status)) return;
  const note = str(fd, "done_note"); if (!note) throw new Error("Say what was done.");
  const got = await storeEvidence(s, a, fd);
  const { count } = await db().from("safety_action_evidence").select("id", { count: "exact", head: true }).eq("action_id", a.id);
  if (!count) throw new Error("Add the evidence (a file, the name of a document kept on the server, or a note describing it).");
  await db().from("safety_actions").update({ status: "done", done_at: new Date().toISOString(), done_by: s.person?.id ?? null, done_note: note, updated_at: new Date().toISOString() }).eq("id", a.id);
  await closeTasks(a.id, ["action"]);
  await db().from("tasks").insert({ entity: a.entity, kind: "action_verify", title: `Verify ${a.number} — ${a.title}`.slice(0, 200), detail: `Done by ${s.name}: ${note}`.slice(0, 500), owner_role: "SM", status: "open", link: `/safe/actions/${a.id}`, ref_id: a.id });
  await log(a.id, "done", s.person?.id ?? null, `Done by ${s.name} — ${note}${got ? ` (evidence: ${got})` : ""}`); touch(a);
}
/** Safety desk: accept (closed, with a date to check effectiveness) or send back to the owner. */
export async function verifyAction(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity, mayVerifyActions, "Verification is made by the safety desk (SM / CMM).");
  if (a.status !== "done") return;
  const note = str(fd, "verified_note");
  if (fd.get("verdict") === "back") {
    if (!note) throw new Error("Say what is missing.");
    await db().from("safety_actions").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", a.id);
    await closeTasks(a.id, ["action_verify"]); await ownerTask({ ...a, title: `${a.title} — completion requested` });
    await log(a.id, "sent_back", s.person?.id ?? null, `Sent back to the owner by ${s.name} — ${note}`); return touch(a);
  }
  const eff = str(fd, "effectiveness_due");
  await db().from("safety_actions").update({ status: "verified", verified_at: new Date().toISOString(), verified_by: s.person?.id ?? null, verified_note: note, effectiveness_due: eff, updated_at: new Date().toISOString() }).eq("id", a.id);
  await closeTasks(a.id, ["action_verify"]);
  if (a.mitigation_id) await db().from("hazard_mitigations").update({ done_at: new Date().toISOString() }).eq("id", a.mitigation_id).is("done_at", null);
  if (a.report_id) await db().from("report_events").insert({ report_id: a.report_id, kind: "action", actor: s.person?.id ?? null, note: `Action ${a.number} verified and closed` });
  await log(a.id, "verified", s.person?.id ?? null, `Verified and closed by ${s.name}${note ? ` — ${note}` : ""}${eff ? `; effectiveness to check on ${eff}` : ""}`); touch(a);
}
/** Effectiveness check (on the date set at closure): effective, or not effective → a follow-up action is opened. */
export async function checkEffectiveness(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity, mayVerifyActions, "Reserved to the safety desk.");
  if (a.status !== "verified" || a.effectiveness) return;
  const verdict = str(fd, "effectiveness"); const note = str(fd, "effectiveness_note");
  if (!verdict || !["effective", "not_effective"].includes(verdict)) return;
  if (verdict === "not_effective" && !note) throw new Error("Say why it did not work — it becomes the follow-up action.");
  let follow: string | null = null;
  if (verdict === "not_effective") {
    const number = await nextActionNumber(db(), a.entity);
    const { data } = await db().from("safety_actions").insert({ entity: a.entity, number, module: a.module, kind: a.kind, title: `Follow-up of ${a.number} — ${a.title}`.slice(0, 300), description: note, owner_role: a.owner_role, owner_person: a.owner_person, due: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), source_kind: a.source_kind, report_id: a.report_id, hazard_id: a.hazard_id, assessment_id: a.assessment_id, created_by: s.person?.id ?? null }).select("*").single();
    const f = data as Action; follow = f.id; await ownerTask(f); await log(f.id, "created", s.person?.id ?? null, `Opened because ${a.number} was not effective — ${note}`);
    if (a.hazard_id) await db().from("hazards").update({ needs_review: true }).eq("id", a.hazard_id);
  }
  await db().from("safety_actions").update({ effectiveness: verdict, effectiveness_note: note, effectiveness_at: new Date().toISOString(), effectiveness_by: s.person?.id ?? null, follow_up_id: follow, updated_at: new Date().toISOString() }).eq("id", a.id);
  await closeTasks(a.id, ["action_effectiveness"]);
  await log(a.id, "effectiveness", s.person?.id ?? null, `${verdict === "effective" ? "Effective" : "Not effective"} (${s.name})${note ? ` — ${note}` : ""}`); touch(a);
  if (follow) redirect(`/safe/actions/${follow}`);
}
export async function cancelAction(fd: FormData) {
  const a = await load(String(fd.get("id"))); const s = await me(a.entity, mayVerifyActions, "Reserved to the safety desk.");
  const note = str(fd, "note"); if (!note) throw new Error("Say why the action is cancelled.");
  if (["verified", "cancelled"].includes(a.status)) return;
  await db().from("safety_actions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", a.id);
  await closeTasks(a.id, ["action", "action_verify"]);
  await log(a.id, "cancelled", s.person?.id ?? null, `Cancelled by ${s.name} — ${note}`); touch(a);
}
