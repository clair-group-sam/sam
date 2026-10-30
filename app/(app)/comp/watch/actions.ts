"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { analyseEntry, findCitations, loadEntry, nextEntryNumber, syncEntryTask, type Entry, type Topic } from "@/lib/watch";
import { openDraft } from "@/lib/revisions-server";
import { today } from "@/lib/authority";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SM", "SUPERADMIN"].includes(r));
const owns = (s: Session, o: { owner_role: string | null; owner_person: string | null; entity?: string; entities?: string[] }) =>
  (!!o.owner_person && o.owner_person === s.person?.id) || (!!o.owner_role && s.roles.map(basePost).includes(basePost(o.owner_role)) && (o.entity ? s.entities.includes(o.entity) : (o.entities ?? []).some((e) => s.entities.includes(e))));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
const touch = (paths: string[]) => { for (const p of ["/comp/watch", "/home/tasks", ...paths]) revalidatePath(p); };
async function topic(id: string): Promise<Topic> { const { data } = await db().from("watch_topics").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Topic not found"); return data as Topic; }
async function entry(id: string): Promise<Entry> { const e = await loadEntry(db(), id); if (!e) throw new Error("Entry not found"); return e; }

/* ---------- checks: the proof ---------- */
/** One source looked at: nothing new, or entries raised (the entry form follows), or not reachable. */
export async function checkSource(fd: FormData) {
  const s = await me(); const t = await topic(String(fd.get("topic")));
  if (!desk(s) && !owns(s, t)) throw new Error("Reserved to the owner of this watch.");
  const sourceId = str(fd, "source"); const result = str(fd, "result") ?? "nothing_new";
  const on = today();
  await db().from("watch_checks").insert({ topic_id: t.id, source_id: sourceId, checked_on: on, checked_by: s.person?.id ?? null, result, note: str(fd, "note") });
  if (sourceId) await db().from("watch_sources").update({ last_checked_on: on, last_checked_by: s.person?.id ?? null, last_result: result }).eq("id", sourceId);
  // the topic is "checked" when every active source has been looked at since the previous topic check
  const { data: srcs } = await db().from("watch_sources").select("id,last_checked_on").eq("topic_id", t.id).eq("active", true);
  const all = ((srcs ?? []) as { id: string; last_checked_on: string | null }[]).every((x) => x.last_checked_on && (!t.last_checked_on || x.last_checked_on > t.last_checked_on));
  if (all || !sourceId) await db().from("watch_topics").update({ last_checked_on: on, last_checked_by: s.person?.id ?? null }).eq("id", t.id);
  if (all || !sourceId) await db().from("tasks").update({ status: "done" }).eq("ref_id", t.id).eq("kind", "watch_check").eq("status", "open");
  touch([`/comp/watch/topic/${t.id}`]);
}

/* ---------- topics & sources (Compliance / Safety desk) ---------- */
export async function saveTopic(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance / Safety desk only.");
  const id = str(fd, "id");
  const row = { title: str(fd, "title") ?? "Watch", domain: str(fd, "domain") ?? "compliance", entities: fd.getAll("entities").map(String).filter(Boolean), owner_role: str(fd, "owner_role")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person"), every_days: Math.max(7, Number(fd.get("every_days") ?? 30) || 30) };
  if (!row.entities.length) throw new Error("Pick at least one entity.");
  if (id) await db().from("watch_topics").update(row).eq("id", id); else await db().from("watch_topics").insert(row);
  touch(id ? [`/comp/watch/topic/${id}`] : []);
}
export async function archiveTopic(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Not allowed");
  await db().from("watch_topics").update({ active: false }).eq("id", String(fd.get("id"))); touch([]); redirect("/comp/watch");
}
export async function saveSource(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance / Safety desk only.");
  const id = str(fd, "id"); const topicId = String(fd.get("topic"));
  const row = { topic_id: topicId, name: str(fd, "name") ?? "Source", kind: str(fd, "kind") ?? "misc", url: str(fd, "url"), domain: str(fd, "domain"), note: str(fd, "note") };
  if (id) await db().from("watch_sources").update(row).eq("id", id); else await db().from("watch_sources").insert(row);
  touch([`/comp/watch/topic/${topicId}`]);
}
export async function removeSource(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Not allowed");
  await db().from("watch_sources").update({ active: false }).eq("id", String(fd.get("id"))); touch([`/comp/watch/topic/${String(fd.get("topic"))}`]);
}

/* ---------- entries ---------- */
export async function createEntry(fd: FormData) {
  const s = await me();
  const topicId = str(fd, "topic"); const t = topicId ? await topic(topicId) : null;
  if (!desk(s) && !(t && owns(s, t))) throw new Error("Reserved to the owner of this watch.");
  const entity = str(fd, "entity") ?? ""; if (!entity) throw new Error("Choose the entity.");
  const title = str(fd, "title"); if (!title) throw new Error("Give the entry a title.");
  const sourceId = str(fd, "source");
  let checkId: string | null = null;
  if (t) { // the entry is itself the proof the source was looked at
    const { data: c } = await db().from("watch_checks").insert({ topic_id: t.id, source_id: sourceId, checked_on: today(), checked_by: s.person?.id ?? null, result: "entries", note: title.slice(0, 200) }).select("id").single();
    checkId = (c as { id: string } | null)?.id ?? null;
    if (sourceId) await db().from("watch_sources").update({ last_checked_on: today(), last_checked_by: s.person?.id ?? null, last_result: "entries" }).eq("id", sourceId);
  }
  const { data: src } = sourceId ? await db().from("watch_sources").select("kind,domain").eq("id", sourceId).maybeSingle() : { data: null };
  const row = { number: await nextEntryNumber(db(), entity), entity, topic_id: t?.id ?? null, source_id: sourceId, check_id: checkId, source_kind: str(fd, "source_kind") ?? (src as { kind: string } | null)?.kind ?? null, domain: str(fd, "domain") ?? (src as { domain: string | null } | null)?.domain ?? null,
    title: title.slice(0, 300), reference: str(fd, "reference"), url: str(fd, "url"), published_on: str(fd, "published_on"), applicable_on: str(fd, "applicable_on"), applicability: str(fd, "applicability") ?? "to_analyse", task: str(fd, "task"), impact: str(fd, "impact"),
    owner_role: str(fd, "owner_role")?.toUpperCase() ?? t?.owner_role ?? "CMM", owner_person: str(fd, "owner_person"), due: str(fd, "due"), status: "open", created_by: s.person?.id ?? null };
  const { data, error } = await db().from("watch_entries").insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Entry not created.");
  const e = data as Entry;
  // S.A.M. reads it at once when a reference is given
  if (e.reference) { const cit = await findCitations(db(), e.entity, e.reference); const a = await analyseEntry(e, cit); await db().from("watch_entries").update({ assistant: a }).eq("id", e.id); }
  await syncEntryTask(db(), e);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "watch_entry", object_id: e.id, action: "watch_entry_created", after: row });
  touch(t ? [`/comp/watch/topic/${t.id}`] : []);
  if (str(fd, "stay")) return;
  redirect(`/comp/watch/${e.id}`);
}

const EDIT = ["title", "reference", "url", "published_on", "applicable_on", "applicability", "task", "impact", "owner_role", "owner_person", "due", "domain", "source_kind"] as const;
export async function updateEntry(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  if (!desk(s) && !owns(s, e)) throw new Error("Reserved to the owner of the entry.");
  const patch: Record<string, unknown> = {}; for (const k of EDIT) if (fd.has(k)) patch[k] = str(fd, k);
  if (patch.owner_role) patch.owner_role = String(patch.owner_role).toUpperCase();
  if (fd.has("manual_ids")) patch.manual_ids = fd.getAll("manual_ids").map(String).filter(Boolean);
  if (patch.applicability === "not_applicable" && ["open", "in_progress"].includes(e.status)) { patch.status = "not_applicable"; patch.closed_at = new Date().toISOString(); patch.closed_by = s.person?.id ?? null; }
  await db().from("watch_entries").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", e.id);
  await syncEntryTask(db(), (await entry(e.id)));
  touch([`/comp/watch/${e.id}`]);
}
/** S.A.M. reads the entry again (citations + Claude). */
export async function analyse(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  if (!desk(s) && !owns(s, e)) throw new Error("Not allowed");
  const cit = e.reference ? await findCitations(db(), e.entity, e.reference) : [];
  const a = await analyseEntry(e, cit);
  await db().from("watch_entries").update({ assistant: a, updated_at: new Date().toISOString() }).eq("id", e.id);
  touch([`/comp/watch/${e.id}`]);
}
/** Opens (or resumes) the draft of a manual to address the entry; the revision is remembered on the entry. */
export async function draftFor(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  if (!desk(s) && !owns(s, e)) throw new Error("Not allowed");
  const manualId = String(fd.get("manual")); if (!manualId) return;
  const d = await openDraft(db(), manualId, { personId: s.person?.id ?? null, name: s.name }, `Regulatory watch ${e.number} — ${e.title}`.slice(0, 200));
  if (!d) throw new Error("Could not open the draft.");
  await db().from("watch_entries").update({ revision_ids: [...new Set([...e.revision_ids, d.id])], manual_ids: [...new Set([...e.manual_ids, manualId])], status: e.status === "open" ? "in_progress" : e.status, updated_at: new Date().toISOString() }).eq("id", e.id);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: e.entity, object_type: "watch_entry", object_id: e.id, action: "watch_draft_opened", after: { revision_id: d.id, created: d.created } });
  touch([`/comp/watch/${e.id}`]);
  redirect(`/docs/editor/${d.id}`);
}
/** Status: in progress → done (owner, with what was done) → closed (desk) ; or not applicable with the reason. */
export async function setEntryStatus(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  const what = str(fd, "what"); const note = str(fd, "note");
  const now = new Date().toISOString(); const patch: Record<string, unknown> = { updated_at: now };
  if (what === "start") { if (!desk(s) && !owns(s, e)) throw new Error("Not allowed"); patch.status = "in_progress"; }
  else if (what === "done") { if (!desk(s) && !owns(s, e)) throw new Error("Not allowed"); if (!note) throw new Error("Say what was done."); patch.status = "done"; patch.conclusion = note; }
  else if (what === "close") { if (!desk(s)) throw new Error("Compliance / Safety desk only."); patch.status = "closed"; patch.closed_at = now; patch.closed_by = s.person?.id ?? null; if (note) patch.conclusion = note; }
  else if (what === "na") { if (!desk(s) && !owns(s, e)) throw new Error("Not allowed"); if (!note) throw new Error("Say why it does not apply."); patch.status = "not_applicable"; patch.applicability = "not_applicable"; patch.conclusion = note; patch.closed_at = now; patch.closed_by = s.person?.id ?? null; }
  else if (what === "reopen") { if (!desk(s)) throw new Error("Not allowed"); patch.status = "open"; patch.closed_at = null; patch.closed_by = null; }
  await db().from("watch_entries").update(patch).eq("id", e.id);
  await syncEntryTask(db(), (await entry(e.id)));
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: e.entity, object_type: "watch_entry", object_id: e.id, action: `watch_${what}`, after: { note } });
  touch([`/comp/watch/${e.id}`]);
}
/** FND-02 style: the author of a draft says the entry is addressed in this revision. */
export async function addressedInDraft(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  const rev = String(fd.get("rev")); if (!rev) return;
  await db().from("watch_entries").update({ revision_ids: [...new Set([...e.revision_ids, rev])], status: e.status === "open" ? "in_progress" : e.status, updated_at: new Date().toISOString() }).eq("id", e.id);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: e.entity, object_type: "watch_entry", object_id: e.id, action: "watch_addressed_in_draft", after: { revision_id: rev } });
  revalidatePath(`/docs/editor/${rev}`); touch([`/comp/watch/${e.id}`]);
}
