"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { agendaFor, buildPack, defaultAttendees, kindName, mayRun, nextNumber, packFor, type Attendee, type Committee, type Item } from "@/lib/committees";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
async function desk(entity: string | null): Promise<Session> {
  const s = await getSession(); if (!s) throw new Error("Sign in again.");
  if (!mayRun(s)) throw new Error("Reserved to the safety desk (SM / CMM / FSO).");
  if (!entity || !s.entities.includes(entity)) throw new Error("Pick an entity in your scope.");
  return s;
}
async function load(id: string): Promise<Committee> { const { data } = await db().from("committees").select("*").eq("id", id).single(); if (!data) throw new Error("Meeting not found."); return data as Committee; }
const log = (committee_id: string, kind: string, actor: string | null, note: string) => db().from("committee_events").insert({ committee_id, kind, actor, note });
const touch = (id?: string) => { revalidatePath("/safe/comm"); if (id) revalidatePath(`/safe/comm/${id}`); revalidatePath("/safe/over"); };

/** Plan a meeting: number, standing agenda of the MSM, attendees from the posts (SRB) or the SM (SAG). */
export async function planCommittee(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity);
  const kind = str(fd, "kind") === "sag" ? "sag" : "srb"; const on = str(fd, "planned_on"); if (!on) throw new Error("Give the date.");
  const topic = str(fd, "topic"); if (kind === "sag" && !topic) throw new Error("A SAG has a topic.");
  const number = await nextNumber(entity!, kind, on);
  const time = str(fd, "time");
  const row = { entity, kind, number, title: str(fd, "title") ?? (kind === "sag" ? `${kindName(entity!, kind)} — ${topic}` : `${kindName(entity!, kind)} ${number.split(" ")[1]}`), topic,
    status: "planned", planned_on: on, starts_at: time ? new Date(`${on}T${time}:00Z`).toISOString() : null, location: str(fd, "location"),
    attendees: await defaultAttendees(entity!, kind), agenda: agendaFor(entity!, kind, topic), parent_id: str(fd, "parent_id"), created_by: s.person?.id ?? null };
  const { data, error } = await db().from("committees").insert(row).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Not created.");
  const id = (data as { id: string }).id;
  await log(id, "planned", s.person?.id ?? null, `${number} planned on ${on} by ${s.name}`);
  touch(id); redirect(`/safe/comm/${id}`);
}

export async function updateCommittee(fd: FormData) {
  const c = await load(String(fd.get("id"))); const s = await desk(c.entity);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "topic", "location", "planned_on"] as const) if (fd.has(k)) patch[k] = str(fd, k);
  const on = (patch.planned_on as string | null) ?? c.planned_on; const t = str(fd, "time"); const te = str(fd, "end_time");
  if (fd.has("time")) patch.starts_at = t && on ? new Date(`${on}T${t}:00Z`).toISOString() : null;
  if (fd.has("end_time")) patch.ends_at = te && on ? new Date(`${on}T${te}:00Z`).toISOString() : null;
  await db().from("committees").update(patch).eq("id", c.id);
  await log(c.id, "updated", s.person?.id ?? null, "details changed"); touch(c.id);
}

/** Attendees: present / apologies, add someone (SME, supervisor, guest), remove. */
export async function saveAttendees(fd: FormData) {
  const c = await load(String(fd.get("id"))); await desk(c.entity);
  const list: Attendee[] = c.attendees.map((a, i) => ({ ...a, present: fd.get(`p${i}`) === "1" ? true : fd.get(`p${i}`) === "0" ? false : null, note: str(fd, `n${i}`) })).filter((_, i) => fd.get(`rm${i}`) !== "1");
  const nn = str(fd, "new_name"); if (nn) list.push({ name: nn, role: str(fd, "new_role"), person_id: str(fd, "new_person"), present: null });
  await db().from("committees").update({ attendees: list, updated_at: new Date().toISOString() }).eq("id", c.id); touch(c.id);
}

/** Notes and decision of an agenda item (taken during the meeting). Items can be added or removed. */
export async function saveItem(fd: FormData) {
  const c = await load(String(fd.get("id"))); await desk(c.entity);
  if (c.status === "closed") throw new Error("The minutes are issued — they are not changed.");
  const key = String(fd.get("key")); let agenda: Item[] = [...c.agenda];
  if (fd.get("remove") === "1") agenda = agenda.filter((x) => x.key !== key);
  else if (key === "__new") { const t = str(fd, "title"); if (!t) return; agenda.push({ key: `x${Date.now().toString(36)}`, title: t, notes: str(fd, "notes"), decision: str(fd, "decision") }); }
  else agenda = agenda.map((x) => (x.key === key ? { ...x, title: str(fd, "title") ?? x.title, notes: str(fd, "notes"), decision: str(fd, "decision") } : x));
  await db().from("committees").update({ agenda, updated_at: new Date().toISOString() }).eq("id", c.id); touch(c.id);
}

/** Freeze the figures presented (SPI, reports, hazard log, changes, actions, findings, SAG outputs) — again until the minutes are issued. */
export async function preparePack(fd: FormData) {
  const c = await load(String(fd.get("id"))); const s = await desk(c.entity);
  if (c.status === "closed") throw new Error("The minutes are issued.");
  const pack = await buildPack(c);
  await db().from("committees").update({ pack, pack_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
  await log(c.id, "pack", s.person?.id ?? null, "figures prepared"); touch(c.id);
}

export async function markHeld(fd: FormData) {
  const c = await load(String(fd.get("id"))); const s = await desk(c.entity);
  const patch: Record<string, unknown> = { status: "held", updated_at: new Date().toISOString() };
  if (!c.starts_at && c.planned_on) patch.starts_at = new Date(`${c.planned_on}T09:00:00Z`).toISOString();
  if (!c.pack) { patch.pack = await buildPack(c); patch.pack_at = new Date().toISOString(); }
  await db().from("committees").update(patch).eq("id", c.id);
  await log(c.id, "held", s.person?.id ?? null, `held — ${c.attendees.filter((a) => a.present).length} present`); touch(c.id);
}

/** Draft the minutes from the item notes, decisions, actions and figures (the SM edits before issuing). */
export async function draftMinutes(fd: FormData) {
  const c = await load(String(fd.get("id"))); const s = await desk(c.entity);
  const { data: acts } = await db().from("safety_actions").select("number,title,owner_role,due").eq("committee_id", c.id);
  const items = c.agenda.map((x, i) => `${i + 1}. ${x.title}${x.ref ? ` (${x.ref})` : ""}\nFigures: ${packFor(x.key, c.pack).slice(0, 8).join(" | ") || "—"}\nNotes: ${x.notes ?? "—"}\nDecision: ${x.decision ?? "—"}`).join("\n\n");
  const { text, model } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity: c.entity, maxTokens: 2500,
    system: "You write the minutes of an aviation safety committee (EASA Safety Review Board / Safety Action Group) for the Safety Manager. English, factual, concise, past tense. For each agenda item in order: one short paragraph of what was presented and discussed (from the notes and figures only), then 'Decision:' if any. End with 'Actions' (number, action, owner, due) exactly as given. Never invent facts, names, figures or decisions; write 'No discussion recorded' when an item has no notes. Plain text, numbered items, no markdown headings.",
    user: `${c.number} — ${c.title}\nDate: ${c.starts_at ?? c.planned_on} · Location: ${c.location ?? "—"}\nPresent: ${c.attendees.filter((a) => a.present).map((a) => `${a.name} (${a.role ?? ""})`).join(", ") || "—"}\nApologies: ${c.attendees.filter((a) => a.present === false).map((a) => a.name).join(", ") || "—"}\n\n${items}\n\nActions:\n${((acts ?? []) as { number: string; title: string; owner_role: string | null; due: string | null }[]).map((a) => `${a.number} ${a.title} — ${a.owner_role ?? ""} — ${a.due ?? ""}`).join("\n") || "none"}` });
  await db().from("committees").update({ minutes: text.trim(), minutes_model: model, updated_at: new Date().toISOString() }).eq("id", c.id);
  touch(c.id);
}
export async function saveMinutes(fd: FormData) {
  const c = await load(String(fd.get("id"))); await desk(c.entity);
  if (c.status === "closed") throw new Error("The minutes are issued.");
  await db().from("committees").update({ minutes: str(fd, "minutes"), updated_at: new Date().toISOString() }).eq("id", c.id); touch(c.id);
}

/** Issue the minutes: frozen; the AM and every attendee get a task to read them (SAG: report to the AM and participants, MSM §4.6). */
export async function issueMinutes(fd: FormData) {
  const c = await load(String(fd.get("id"))); const s = await desk(c.entity);
  if (c.status !== "held") throw new Error("Mark the meeting as held first.");
  if (!c.attendees.some((a) => a.present)) throw new Error("Record who attended.");
  const now = new Date().toISOString();
  await db().from("committees").update({ status: "closed", closed_at: now, closed_by: s.person?.id ?? null, updated_at: now }).eq("id", c.id);
  const people = new Set(c.attendees.map((a) => a.person_id).filter(Boolean) as string[]);
  type T = { entity: string; kind: string; title: string; detail: string; due: string; owner_person: string | null; owner_role: string | null; status: string; link: string; ref_id: string };
  const rows: T[] = [...people].filter((p) => p !== s.person?.id).map((p) => ({ entity: c.entity, kind: "committee_minutes", title: `${c.number} — minutes to read`, detail: `${c.title}: minutes issued, with the decisions and the actions assigned.`, due: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), owner_person: p, owner_role: null, status: "open", link: `/safe/comm/${c.id}`, ref_id: c.id }));
  if (!c.attendees.some((a) => /\bAM\b/.test(a.role ?? "") && a.person_id)) rows.push({ entity: c.entity, kind: "committee_minutes", title: `${c.number} — minutes to read`, detail: `${c.title}: minutes issued.`, due: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), owner_person: null, owner_role: "AM", status: "open", link: `/safe/comm/${c.id}`, ref_id: c.id });
  if (rows.length) await db().from("tasks").insert(rows);
  await log(c.id, "closed", s.person?.id ?? null, `minutes issued by ${s.name} — ${rows.length} reader(s)`);
  touch(c.id);
}
export async function cancelCommittee(fd: FormData) {
  const c = await load(String(fd.get("id"))); const s = await desk(c.entity);
  if (c.status === "closed") throw new Error("The minutes are issued.");
  await db().from("committees").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", c.id);
  await log(c.id, "cancelled", s.person?.id ?? null, str(fd, "reason") ?? "cancelled"); touch(c.id);
}
/** The person reads the minutes: their task is done. */
export async function ackMinutes(fd: FormData) {
  const s = await getSession(); if (!s?.person) throw new Error("Sign in again.");
  const id = String(fd.get("id"));
  await db().from("tasks").update({ status: "done" }).eq("kind", "committee_minutes").eq("ref_id", id).eq("owner_person", s.person.id).eq("status", "open");
  await log(id, "read", s.person.id, `${s.name} read the minutes`); touch(id);
}
