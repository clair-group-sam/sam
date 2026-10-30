import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, today } from "@/lib/authority";

/* REG-01 · Regulatory watch (30/10). Topics → sources → checks (the proof we looked) → entries (what concerns us, who does what, done).
 * S.A.M. helps on an entry: finds the chapters citing the reference, suggests applicability / impact / task. It signals, never edits. */

export type Topic = { id: string; key: string | null; title: string; domain: string; entities: string[]; owner_role: string | null; owner_person: string | null; every_days: number; last_checked_on: string | null; last_checked_by: string | null; active: boolean };
export type Source = { id: string; topic_id: string; name: string; kind: string; url: string | null; domain: string | null; note: string | null; active: boolean; last_checked_on: string | null; last_checked_by: string | null; last_result: string | null };
export type Check = { id: string; topic_id: string; source_id: string | null; checked_on: string; checked_by: string | null; result: string; note: string | null; created_at: string };
export type Citation = { manual_id: string; code: string; title: string; ref: string; section_title: string | null; snippet: string };
export type EntryAssistant = { applicability: string; summary: string; chapters: { manual: string; ref: string; why: string }[]; task: string | null; model: string; at: string };
export type Entry = { id: string; key: string | null; number: string; entity: string; topic_id: string | null; source_id: string | null; check_id: string | null; source_kind: string | null; domain: string | null; title: string; reference: string | null; url: string | null;
  published_on: string | null; applicable_on: string | null; applicability: string; task: string | null; impact: string | null; manual_ids: string[]; revision_ids: string[]; owner_role: string | null; owner_person: string | null; due: string | null; status: string; conclusion: string | null;
  assistant: EntryAssistant | null; closed_at: string | null; closed_by: string | null; imported_from: string | null; created_by: string | null; created_at: string; updated_at: string };

export const DOMAIN_LABEL: Record<string, string> = { compliance: "Compliance", safety: "Safety", ato_fstd: "ATO & FSTD", manufacturer: "Manufacturer documentation" };
export const KIND_LABEL: Record<string, string> = { easa: "EASA", dsac: "DSAC / METEOR", osac: "OSAC", tmcad: "TM-CAD", jorf: "JORF / Légifrance", bea: "BEA", manufacturer: "Manufacturer", icao: "ICAO / FSF", misc: "Other" };
export const APPL_LABEL: Record<string, string> = { to_analyse: "To analyse", applicable: "Applicable", for_information: "For information", not_applicable: "Not applicable" };
export const APPL_TONE: Record<string, string> = { to_analyse: "amber", applicable: "red", for_information: "", not_applicable: "" };
export const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Done — to close", closed: "Closed", not_applicable: "Not applicable" };
export const TASK_LABEL: Record<string, string> = { study: "Study", apply: "Apply / create" };
export const OPEN_STATUSES = ["open", "in_progress", "done"];

export async function nextEntryNumber(db: SupabaseClient, entity: string): Promise<string> {
  const y = new Date().getFullYear();
  const { data } = await db.from("watch_entries").select("number").eq("entity", entity).like("number", `REG-${entity}-${y}-%`);
  const n = ((data ?? []) as { number: string }[]).map((r) => Number(r.number.split("-").pop())).filter(Number.isFinite);
  return `REG-${entity}-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0")}`;
}

/** Topics in scope with their sources and where they stand against their cadence. */
export async function loadTopics(db: SupabaseClient, entities: string[] | null): Promise<(Topic & { sources: Source[]; nextDue: string | null; overdue: number })[]> {
  const { data: t } = await db.from("watch_topics").select("*").eq("active", true).order("domain").order("title");
  const topics = ((t ?? []) as Topic[]).filter((x) => !entities || x.entities.some((e) => entities.includes(e)));
  const ids = topics.map((x) => x.id);
  const { data: s } = ids.length ? await db.from("watch_sources").select("*").in("topic_id", ids).eq("active", true).order("name") : { data: [] };
  const t0 = today();
  return topics.map((x) => {
    const nextDue = x.last_checked_on ? addDays(x.last_checked_on, x.every_days) : null;
    const overdue = nextDue ? Math.round((Date.parse(t0) - Date.parse(nextDue)) / 86_400_000) : 9999;
    return { ...x, sources: ((s ?? []) as Source[]).filter((y) => y.topic_id === x.id), nextDue, overdue };
  });
}

export async function loadEntry(db: SupabaseClient, id: string): Promise<Entry | null> {
  const { data } = await db.from("watch_entries").select("*").eq("id", id).maybeSingle();
  return (data as Entry | null) ?? null;
}

/** Chapters of the entity's published manuals that cite the reference (text search in the current revision). */
export async function findCitations(db: SupabaseClient, entity: string, reference: string): Promise<Citation[]> {
  const needle = reference.trim().replace(/\s+/g, " ");
  if (needle.length < 4) return [];
  const { data: mans } = await db.from("manuals").select("id,code,title").eq("entity", entity);
  const ms = (mans ?? []) as { id: string; code: string; title: string }[];
  if (!ms.length) return [];
  const { data: revs } = await db.from("revisions").select("id,manual_id,published_at").in("manual_id", ms.map((m) => m.id)).in("step", ["published", "repository"]).order("published_at", { ascending: false, nullsFirst: false });
  const current = new Map<string, string>(); // manual → latest published revision
  for (const r of (revs ?? []) as { id: string; manual_id: string }[]) if (!current.has(r.manual_id)) current.set(r.manual_id, r.id);
  const manuals = ms.filter((m) => current.has(m.id)).map((m) => ({ ...m, current_revision_id: current.get(m.id)! }));
  if (!manuals.length) return [];
  const revIds = manuals.map((m) => m.current_revision_id);
  // tokens: "ORO.FC.230" also matches "ORO.FC.230(a)"; a title like "ED Decision 2026/006/R" matches as a whole
  const { data } = await db.from("revision_sections").select("revision_id,ref,title,body_text").in("revision_id", revIds).ilike("body_text", `%${needle}%`).limit(60);
  const out: Citation[] = [];
  for (const s of (data ?? []) as { revision_id: string; ref: string; title: string | null; body_text: string }[]) {
    const m = manuals.find((x) => x.current_revision_id === s.revision_id); if (!m) continue;
    const i = s.body_text.toLowerCase().indexOf(needle.toLowerCase());
    const snippet = s.body_text.slice(Math.max(0, i - 90), i + needle.length + 90).replace(/\s+/g, " ").trim();
    out.push({ manual_id: m.id, code: m.code, title: m.title, ref: s.ref, section_title: s.title, snippet: `…${snippet}…` });
  }
  return out;
}

const SYSTEM = `You are the assistant of a Compliance Monitoring Manager (EASA AOC / CAMO / ATO / FSTD, authorities TM-CAD Malta, DSAC France, OSAC). A regulatory watch entry (a new text, amendment, bulletin, guide or manufacturer document) is given with the chapters of the organisation's manuals that cite its reference.
Say, in neutral professional English, whether it concerns this organisation and what to do. You signal; a human decides and edits.
Answer ONLY with JSON: {"applicability":"applicable|for_information|not_applicable|to_analyse","summary":"2 sentences: what changes and for whom","chapters":[{"manual":"code","ref":"section","why":"one sentence"}],"task":"study|apply|null"} — list only chapters really concerned (from those given, or named by the text itself), none if nothing.`;

/** S.A.M. reads an entry: citations found + Claude's reading when the key is there. Never throws. */
export async function analyseEntry(e: Entry, citations: Citation[]): Promise<EntryAssistant> {
  const base: EntryAssistant = { applicability: citations.length ? "to_analyse" : e.applicability, summary: citations.length ? `${citations.length} chapter${citations.length === 1 ? "" : "s"} cite ${e.reference ?? "this reference"}.` : "No chapter of the published manuals cites this reference.", chapters: citations.slice(0, 8).map((c) => ({ manual: c.code, ref: c.ref, why: c.section_title ?? "" })), task: null, model: "rules", at: new Date().toISOString() };
  if (!process.env.ANTHROPIC_API_KEY) return base;
  try {
    const { callClaude } = await import("@/lib/ai");
    const user = `ENTITY ${e.entity}\nENTRY ${e.number}: ${e.title}\nReference: ${e.reference ?? "—"} · source: ${e.source_kind ?? "—"} · domain: ${e.domain ?? "—"} · published ${e.published_on ?? "—"} · applicable ${e.applicable_on ?? "—"}\nURL: ${e.url ?? "—"}\nNotes so far: ${e.impact ?? "—"}\n\nCHAPTERS CITING THE REFERENCE\n${citations.length ? citations.slice(0, 12).map((c) => `${c.code} ${c.ref} — ${c.section_title ?? ""}: ${c.snippet}`).join("\n") : "none"}`;
    const { text, model } = await callClaude({ agent: "check", personId: null, entity: e.entity, system: SYSTEM, user, maxTokens: 900 });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) return base;
    const j = JSON.parse(m[0]) as Partial<EntryAssistant>;
    return { applicability: ["applicable", "for_information", "not_applicable", "to_analyse"].includes(j.applicability ?? "") ? j.applicability! : base.applicability, summary: String(j.summary ?? base.summary).slice(0, 600), chapters: (j.chapters ?? base.chapters).slice(0, 10).map((c) => ({ manual: String(c.manual ?? ""), ref: String(c.ref ?? ""), why: String(c.why ?? "").slice(0, 200) })), task: j.task === "study" || j.task === "apply" ? j.task : null, model, at: new Date().toISOString() };
  } catch { return base; }
}

/* ---------- Inbox ---------- */
export async function syncEntryTask(db: SupabaseClient, e: Entry): Promise<void> {
  const { data: open } = await db.from("tasks").select("id,title").eq("ref_id", e.id).eq("kind", "watch").eq("status", "open");
  const rows = (open ?? []) as { id: string; title: string }[];
  const wanted = ["open", "in_progress"].includes(e.status) && e.applicability !== "not_applicable" && (e.owner_role || e.owner_person);
  const title = `${e.task === "apply" ? "Apply" : "Study"} · ${e.number} — ${e.title}`.slice(0, 200);
  if (wanted) {
    if (!rows.some((r) => r.title === title)) {
      if (rows.length) await db.from("tasks").update({ status: "done" }).in("id", rows.map((r) => r.id));
      await db.from("tasks").insert({ entity: e.entity, kind: "watch", title, detail: `${e.reference ?? ""}${e.impact ? ` · ${e.impact.slice(0, 300)}` : ""}`.trim() || "Regulatory watch entry to handle.", due: e.due, owner_role: e.owner_person ? null : e.owner_role, owner_person: e.owner_person, status: "open", link: `/comp/watch/${e.id}`, ref_id: e.id });
    }
  } else if (rows.length) await db.from("tasks").update({ status: "done" }).in("id", rows.map((r) => r.id));
}

/** Daily: a topic past its cadence → one open task for its owner (renewed when done). */
export async function sweepWatch(db: SupabaseClient): Promise<number> {
  const topics = await loadTopics(db, null);
  let n = 0;
  for (const t of topics) {
    if (t.overdue < 0) { await db.from("tasks").update({ status: "done" }).eq("ref_id", t.id).eq("kind", "watch_check").eq("status", "open"); continue; }
    const { data: ex } = await db.from("tasks").select("id").eq("ref_id", t.id).eq("kind", "watch_check").eq("status", "open").limit(1);
    if (ex?.length) continue;
    for (const ent of t.entities.slice(0, 1)) {
      await db.from("tasks").insert({ entity: ent, kind: "watch_check", title: `Regulatory watch · ${t.title}`.slice(0, 200), detail: `${t.sources.length} source${t.sources.length === 1 ? "" : "s"} to open${t.last_checked_on ? ` · last check ${t.last_checked_on}` : " · never checked"}. Tick each source: nothing new, or raise an entry.`, due: t.nextDue ?? today(), owner_role: t.owner_person ? null : t.owner_role ?? "CMM", owner_person: t.owner_person, status: "open", link: `/comp/watch/topic/${t.id}`, ref_id: t.id });
      n++;
    }
  }
  return n;
}
