"use server";
import { fail } from "@/lib/fail";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { analyseEntry, FAMILIES, findCitations, loadEntry, nextEntryNumber, syncEntryTask, type Entry, type Source, type Topic } from "@/lib/watch";
import { newSince, readSource, type Item } from "@/lib/watch-read";
import { openDraft } from "@/lib/revisions-server";
import { today } from "@/lib/authority";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SM", "SUPERADMIN"].includes(r));
const owns = (s: Session, o: { owner_role: string | null; owner_person: string | null; entity?: string; entities?: string[] }) =>
  (!!o.owner_person && o.owner_person === s.person?.id) || (!!o.owner_role && s.roles.map(basePost).includes(basePost(o.owner_role)) && (o.entity ? s.entities.includes(o.entity) : (o.entities ?? []).some((e) => s.entities.includes(e))));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
const touch = (paths: string[]) => { for (const p of ["/reg/watch", "/home/tasks", ...paths]) revalidatePath(p); };
async function topic(id: string): Promise<Topic> { const { data } = await db().from("watch_topics").select("*").eq("id", id).maybeSingle(); if (!data) fail("Topic not found"); return data as Topic; }
async function entry(id: string): Promise<Entry> { const e = await loadEntry(db(), id); if (!e) fail("Entry not found"); return e; }

/* ---------- checks: the proof ---------- */
/** One source looked at: nothing new, or entries raised (the entry form follows), or not reachable. */
export async function checkSource(fd: FormData) {
  const s = await me(); const t = await topic(String(fd.get("topic")));
  if (!desk(s) && !owns(s, t)) fail("Reserved to the owner of this watch.");
  const sourceId = str(fd, "source"); const result = str(fd, "result") ?? "nothing_new";
  const on = today();
  await db().from("watch_checks").insert({ topic_id: t.id, source_id: sourceId, checked_on: on, checked_by: s.person?.id ?? null, result, note: str(fd, "note") });
  if (sourceId) await db().from("watch_sources").update({ last_checked_on: on, last_checked_by: s.person?.id ?? null, last_result: result, last_new: null }).eq("id", sourceId);
  await settle(t, s.person?.id ?? null, on, !sourceId);
  touch([`/reg/watch/topic/${t.id}`]);
}
/** The stream is "checked" when every active source has been looked at since the previous check of the stream. */
async function settle(t: Topic, who: string | null, on: string, force = false) {
  const { data: srcs } = await db().from("watch_sources").select("id,last_checked_on").eq("topic_id", t.id).eq("active", true);
  const all = ((srcs ?? []) as { id: string; last_checked_on: string | null }[]).every((x) => x.last_checked_on && (!t.last_checked_on || x.last_checked_on > t.last_checked_on || x.last_checked_on === on));
  if (!all && !force) return false;
  await db().from("watch_topics").update({ last_checked_on: on, last_checked_by: who }).eq("id", t.id);
  await db().from("tasks").update({ status: "done" }).eq("ref_id", t.id).eq("kind", "watch_check").eq("status", "open");
  return true;
}

/* ---------- REG-07 · a watch round launched by Compliance (never on its own) ---------- */
/** Reads the public sources of the chosen families (one reading per address, shared by the entities), keeps what is new since the
 * previous round for review, records "nothing new" where nothing changed. Sources to open or behind a login stay to tick. */
export async function launchRound(fd: FormData) {
  const s = await me(); if (!desk(s)) fail("Compliance department only.");
  const fams = fd.getAll("family").map(String).filter(Boolean);
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const { data: td } = await db().from("watch_topics").select("*").eq("active", true).in("domain", fams.length ? fams : FAMILIES.map((f) => f[0]));
  const topics = ((td ?? []) as Topic[]).filter((t) => !scope || t.entities.some((e) => scope.includes(e)));
  if (!topics.length) fail("No watch stream in your scope for this family.");
  const { data: sd } = await db().from("watch_sources").select("*").in("topic_id", topics.map((t) => t.id)).eq("active", true);
  const sources = (sd ?? []) as Source[];
  const urls = [...new Set(sources.filter((x) => x.access === "read" && x.url).map((x) => x.url!))];
  const readings = new Map(await Promise.all(urls.map(async (u) => [u, await readSource(u)] as const)));
  const on = today(), now = new Date().toISOString(), who = s.person?.id ?? null;
  for (const x of sources) {
    if (x.access === "regulation") {
      await db().from("watch_sources").update({ last_checked_on: on, last_checked_by: who, last_result: "nothing_new", read_at: now, read_note: "followed in Regulation, EASA rules" }).eq("id", x.id);
      continue;
    }
    if (x.access !== "read" || !x.url) continue;
    const r = readings.get(x.url)!;
    if (!r.ok) { await db().from("watch_sources").update({ read_at: now, read_note: `not read (${r.note ?? `HTTP ${r.status}`}), open it` }).eq("id", x.id); continue; }
    const first = !x.snapshot?.length;
    const pending: Item[] = x.last_result === "new" ? (x.last_new ?? []) : [];
    const fresh = newSince(x.snapshot ?? null, r.items).filter((i) => !pending.some((p) => p.url === i.url));
    const waiting = [...fresh, ...pending].slice(0, 40);
    const note = first ? `first reading: ${r.items.length} entries kept as the reference` : fresh.length ? `${fresh.length} new since the previous round` : pending.length ? "nothing more, earlier news still to review" : "nothing new";
    if (waiting.length) await db().from("watch_sources").update({ snapshot: r.items, read_at: now, read_note: note, last_new: waiting, last_result: "new" }).eq("id", x.id);
    else {
      await db().from("watch_sources").update({ snapshot: r.items, read_at: now, read_note: note, last_new: null, last_checked_on: on, last_checked_by: who, last_result: "nothing_new" }).eq("id", x.id);
      await db().from("watch_checks").insert({ topic_id: x.topic_id, source_id: x.id, checked_on: on, checked_by: who, result: "nothing_new", note: `read by S.A.M., ${note}` });
    }
  }
  for (const t of topics) await settle(t, who, on);
  touch(topics.map((t) => `/reg/watch/topic/${t.id}`));
}

/* ---------- topics & sources (Compliance / Safety desk) ---------- */
export async function saveTopic(fd: FormData) {
  const s = await me(); if (!desk(s)) fail("Compliance / Safety desk only.");
  const id = str(fd, "id");
  const row = { title: str(fd, "title") ?? "Watch", domain: str(fd, "domain") ?? "compliance", entities: fd.getAll("entities").map(String).filter(Boolean), owner_role: str(fd, "owner_role")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person"), every_days: Math.max(7, Number(fd.get("every_days") ?? 30) || 30) };
  if (!row.entities.length) fail("Pick at least one entity.");
  if (id) await db().from("watch_topics").update(row).eq("id", id); else await db().from("watch_topics").insert(row);
  touch(id ? [`/reg/watch/topic/${id}`] : []);
}
export async function archiveTopic(fd: FormData) {
  const s = await me(); if (!desk(s)) fail("Not allowed");
  await db().from("watch_topics").update({ active: false }).eq("id", String(fd.get("id"))); touch([]); redirect("/reg/watch");
}
export async function saveSource(fd: FormData) {
  const s = await me(); if (!desk(s)) fail("Compliance / Safety desk only.");
  const id = str(fd, "id"); const topicId = String(fd.get("topic"));
  const row = { topic_id: topicId, name: str(fd, "name") ?? "Source", kind: str(fd, "kind") ?? "misc", url: str(fd, "url"), domain: str(fd, "domain"), note: str(fd, "note") };
  if (id) await db().from("watch_sources").update(row).eq("id", id); else await db().from("watch_sources").insert(row);
  touch([`/reg/watch/topic/${topicId}`]);
}
export async function removeSource(fd: FormData) {
  const s = await me(); if (!desk(s)) fail("Not allowed");
  await db().from("watch_sources").update({ active: false }).eq("id", String(fd.get("id"))); touch([`/reg/watch/topic/${String(fd.get("topic"))}`]);
}

/* ---------- entries ---------- */
export async function createEntry(fd: FormData) {
  const s = await me();
  const topicId = str(fd, "topic"); const t = topicId ? await topic(topicId) : null;
  if (!desk(s) && !(t && owns(s, t))) fail("Reserved to the owner of this watch.");
  const entity = str(fd, "entity") ?? ""; if (!entity) fail("Choose the entity.");
  const title = str(fd, "title"); if (!title) fail("Give the entry a title.");
  const sourceId = str(fd, "source");
  let checkId: string | null = null;
  if (t) { // the entry is itself the proof the source was looked at
    const { data: c } = await db().from("watch_checks").insert({ topic_id: t.id, source_id: sourceId, checked_on: today(), checked_by: s.person?.id ?? null, result: "entries", note: title.slice(0, 200) }).select("id").single();
    checkId = (c as { id: string } | null)?.id ?? null;
    if (sourceId) {
      const { data: cur } = await db().from("watch_sources").select("last_new").eq("id", sourceId).maybeSingle();
      const item = str(fd, "item_url"); const left = ((cur as { last_new: Item[] | null } | null)?.last_new ?? []).filter((i) => !item || i.url !== item);
      const more = !!item && left.length > 0; // other news of the reading still to review: the source is not done yet
      await db().from("watch_sources").update(more ? { last_new: left } : { last_checked_on: today(), last_checked_by: s.person?.id ?? null, last_result: "entries", last_new: null }).eq("id", sourceId);
    }
  }
  const { data: src } = sourceId ? await db().from("watch_sources").select("kind,domain").eq("id", sourceId).maybeSingle() : { data: null };
  const row = { number: await nextEntryNumber(db(), entity), entity, topic_id: t?.id ?? null, source_id: sourceId, check_id: checkId, source_kind: str(fd, "source_kind") ?? (src as { kind: string } | null)?.kind ?? null, domain: str(fd, "domain") ?? (src as { domain: string | null } | null)?.domain ?? null,
    title: title.slice(0, 300), reference: str(fd, "reference"), url: str(fd, "url"), published_on: str(fd, "published_on"), applicable_on: str(fd, "applicable_on"), applicability: str(fd, "applicability") ?? "to_analyse", task: str(fd, "task"), impact: str(fd, "impact"),
    owner_role: str(fd, "owner_role")?.toUpperCase() ?? t?.owner_role ?? "CMM", owner_person: str(fd, "owner_person"), due: str(fd, "due"), status: "open", created_by: s.person?.id ?? null };
  const { data, error } = await db().from("watch_entries").insert(row).select("*").single();
  if (error || !data) fail(error?.message ?? "Entry not created.");
  const e = data as Entry;
  // S.A.M. reads it at once when a reference is given
  if (e.reference) { const cit = await findCitations(db(), e.entity, e.reference); const a = await analyseEntry(e, cit); await db().from("watch_entries").update({ assistant: a }).eq("id", e.id); }
  await syncEntryTask(db(), e);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "watch_entry", object_id: e.id, action: "watch_entry_created", after: row });
  touch(t ? [`/reg/watch/topic/${t.id}`] : []);
  if (str(fd, "stay")) return;
  redirect(`/reg/watch/${e.id}`);
}

const EDIT = ["title", "reference", "url", "published_on", "applicable_on", "applicability", "task", "impact", "owner_role", "owner_person", "due", "domain", "source_kind"] as const;
export async function updateEntry(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  if (!desk(s) && !owns(s, e)) fail("Reserved to the owner of the entry.");
  const patch: Record<string, unknown> = {}; for (const k of EDIT) if (fd.has(k)) patch[k] = str(fd, k);
  if (patch.owner_role) patch.owner_role = String(patch.owner_role).toUpperCase();
  if (fd.has("manual_ids")) patch.manual_ids = fd.getAll("manual_ids").map(String).filter(Boolean);
  if (patch.applicability === "not_applicable" && ["open", "in_progress"].includes(e.status)) { patch.status = "not_applicable"; patch.closed_at = new Date().toISOString(); patch.closed_by = s.person?.id ?? null; }
  await db().from("watch_entries").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", e.id);
  await syncEntryTask(db(), (await entry(e.id)));
  touch([`/reg/watch/${e.id}`]);
}
/** S.A.M. reads the entry again (citations + Claude). */
export async function analyse(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  if (!desk(s) && !owns(s, e)) fail("Not allowed");
  const cit = e.reference ? await findCitations(db(), e.entity, e.reference) : [];
  const a = await analyseEntry(e, cit);
  await db().from("watch_entries").update({ assistant: a, updated_at: new Date().toISOString() }).eq("id", e.id);
  touch([`/reg/watch/${e.id}`]);
}
/** Opens (or resumes) the draft of a manual to address the entry; the revision is remembered on the entry. */
export async function draftFor(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  if (!desk(s) && !owns(s, e)) fail("Not allowed");
  const manualId = String(fd.get("manual")); if (!manualId) return;
  const d = await openDraft(db(), manualId, { personId: s.person?.id ?? null, name: s.name }, `Regulatory watch ${e.number} — ${e.title}`.slice(0, 200));
  if (!d) fail("Could not open the draft.");
  await db().from("watch_entries").update({ revision_ids: [...new Set([...e.revision_ids, d.id])], manual_ids: [...new Set([...e.manual_ids, manualId])], status: e.status === "open" ? "in_progress" : e.status, updated_at: new Date().toISOString() }).eq("id", e.id);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: e.entity, object_type: "watch_entry", object_id: e.id, action: "watch_draft_opened", after: { revision_id: d.id, created: d.created } });
  touch([`/reg/watch/${e.id}`]);
  redirect(`/docs/editor/${d.id}`);
}
/** Status: in progress → done (owner, with what was done) → closed (desk) ; or not applicable with the reason. */
export async function setEntryStatus(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  const what = str(fd, "what"); const note = str(fd, "note");
  const now = new Date().toISOString(); const patch: Record<string, unknown> = { updated_at: now };
  if (what === "start") { if (!desk(s) && !owns(s, e)) fail("Not allowed"); patch.status = "in_progress"; }
  else if (what === "done") { if (!desk(s) && !owns(s, e)) fail("Not allowed"); if (!note) fail("Say what was done."); patch.status = "done"; patch.conclusion = note; }
  else if (what === "close") { if (!desk(s)) fail("Compliance / Safety desk only."); patch.status = "closed"; patch.closed_at = now; patch.closed_by = s.person?.id ?? null; if (note) patch.conclusion = note; }
  else if (what === "na") { if (!desk(s) && !owns(s, e)) fail("Not allowed"); if (!note) fail("Say why it does not apply."); patch.status = "not_applicable"; patch.applicability = "not_applicable"; patch.conclusion = note; patch.closed_at = now; patch.closed_by = s.person?.id ?? null; }
  else if (what === "reopen") { if (!desk(s)) fail("Not allowed"); patch.status = "open"; patch.closed_at = null; patch.closed_by = null; }
  await db().from("watch_entries").update(patch).eq("id", e.id);
  await syncEntryTask(db(), (await entry(e.id)));
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: e.entity, object_type: "watch_entry", object_id: e.id, action: `watch_${what}`, after: { note } });
  touch([`/reg/watch/${e.id}`]);
}
/** FND-02 style: the author of a draft says the entry is addressed in this revision. */
export async function addressedInDraft(fd: FormData) {
  const s = await me(); const e = await entry(String(fd.get("id")));
  const rev = String(fd.get("rev")); if (!rev) return;
  await db().from("watch_entries").update({ revision_ids: [...new Set([...e.revision_ids, rev])], status: e.status === "open" ? "in_progress" : e.status, updated_at: new Date().toISOString() }).eq("id", e.id);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: e.entity, object_type: "watch_entry", object_id: e.id, action: "watch_addressed_in_draft", after: { revision_id: rev } });
  revalidatePath(`/docs/editor/${rev}`); touch([`/reg/watch/${e.id}`]);
}
