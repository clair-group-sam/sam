"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { FACTOR_CAT, INV_LEVEL, INV_STEPS, mayEdit, mayOpen, nextInvNumber, type Factor, type Investigation, type TeamMember, type TimelineRow } from "@/lib/investigations";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
async function sess(): Promise<Session> { const s = await getSession(); if (!s) throw new Error("Sign in again."); return s; }
async function load(id: string): Promise<Investigation> { const { data } = await db().from("investigations").select("*").eq("id", id).single(); if (!data) throw new Error("Investigation not found."); return data as Investigation; }
async function editable(id: string) {
  const s = await sess(); const i = await load(id);
  if (!s.entities.includes(i.entity) || !mayEdit(s, i)) throw new Error("Reserved to the safety desk and the investigation lead.");
  if (["closed", "cancelled"].includes(i.status)) throw new Error("The investigation is closed — it is not changed.");
  return { s, i };
}
const log = (investigation_id: string, kind: string, actor: string | null, note: string) => db().from("investigation_events").insert({ investigation_id, kind, actor, note });
const touch = (i: { id: string; report_id: string | null }) => { revalidatePath("/safe/inv"); revalidatePath(`/safe/inv/${i.id}`); if (i.report_id) revalidatePath(`/safe/reports/${i.report_id}`); revalidatePath("/home/tasks"); };
const save = async (i: Investigation, patch: Record<string, unknown>) => { await db().from("investigations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", i.id); touch(i); };
/** Moving forward only (open → facts → analysis → report); never back past a step already reached. */
const atLeast = (cur: string, step: string) => (INV_STEPS.indexOf(cur as never) >= INV_STEPS.indexOf(step as never) ? cur : step);

/** Open an investigation on a report (or without one, on a topic). The report goes "Under investigation"; the lead gets an Inbox item. */
export async function openInvestigation(fd: FormData) {
  const s = await sess(); const entity = str(fd, "entity");
  if (!entity || !s.entities.includes(entity) || !mayOpen(s)) throw new Error("Reserved to the safety desk (SM / CMM / FSO).");
  const reportId = str(fd, "report_id");
  let title = str(fd, "title");
  if (reportId) {
    const { data: r } = await db().from("reports").select("id,entity,headline,status").eq("id", reportId).maybeSingle();
    if (!r || (r as { entity: string }).entity !== entity) throw new Error("Report not found in this entity.");
    const { data: open } = await db().from("investigations").select("id").eq("report_id", reportId).not("status", "in", "(closed,cancelled)").limit(1);
    if (open?.length) redirect(`/safe/inv/${(open[0] as { id: string }).id}`);
    title = title ?? (r as { headline: string }).headline;
  }
  if (!title) throw new Error("Give the investigation a title.");
  const level = INV_LEVEL[str(fd, "level") ?? ""] ? str(fd, "level")! : "standard";
  const leadId = str(fd, "lead_person") ?? s.person?.id ?? null;
  let leadName: string | null = s.name;
  if (leadId && leadId !== s.person?.id) { const { data: p } = await db().from("people").select("display_name").eq("id", leadId).maybeSingle(); leadName = (p as { display_name: string } | null)?.display_name ?? null; }
  const due = str(fd, "due") ?? new Date(Date.now() + INV_LEVEL[level][1] * 864e5).toISOString().slice(0, 10);
  const number = await nextInvNumber(db(), entity);
  const { data, error } = await db().from("investigations").insert({ entity, number, report_id: reportId, title: title.slice(0, 300), level, status: "open", lead_person: leadId, lead_name: leadName,
    team: leadId ? [{ name: leadName, role: "Lead", person_id: leadId }] : [], terms: str(fd, "terms"), due, created_by: s.person?.id ?? null }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Not created.");
  const id = (data as { id: string }).id;
  await log(id, "opened", s.person?.id ?? null, `${number} opened by ${s.name}${reportId ? ` on report ${reportId}` : ""} · ${INV_LEVEL[level][0]} · due ${due}`);
  if (reportId) {
    await db().from("reports").update({ status: "investigation" }).eq("id", reportId).neq("status", "closed");
    await db().from("report_events").insert({ report_id: reportId, kind: "status", actor: s.person?.id ?? null, note: `Investigation ${number} opened` });
  }
  if (leadId) await db().from("tasks").insert({ entity, kind: "investigation", title: `${number} — investigation to lead`, detail: title.slice(0, 200), due, owner_person: leadId, status: "open", link: `/safe/inv/${id}`, ref_id: id });
  touch({ id, report_id: reportId }); redirect(`/safe/inv/${id}`);
}

/** Scope: level, lead, due date, terms of reference. */
export async function saveScope(fd: FormData) {
  const { s, i } = await editable(String(fd.get("id")));
  const patch: Record<string, unknown> = { terms: str(fd, "terms"), due: str(fd, "due") ?? i.due, title: str(fd, "title") ?? i.title };
  const lv = str(fd, "level"); if (lv && INV_LEVEL[lv]) patch.level = lv;
  const lead = str(fd, "lead_person");
  if (lead && lead !== i.lead_person) {
    const { data: p } = await db().from("people").select("display_name").eq("id", lead).maybeSingle();
    patch.lead_person = lead; patch.lead_name = (p as { display_name: string } | null)?.display_name ?? null;
    await db().from("tasks").update({ owner_person: lead }).eq("kind", "investigation").eq("ref_id", i.id).eq("status", "open");
    await log(i.id, "lead", s.person?.id ?? null, `lead: ${patch.lead_name}`);
  }
  if (patch.due !== i.due) await db().from("tasks").update({ due: patch.due }).eq("kind", "investigation").eq("ref_id", i.id).eq("status", "open");
  await save(i, patch);
}

export async function saveTeam(fd: FormData) {
  const { i } = await editable(String(fd.get("id")));
  let team: TeamMember[] = i.team.filter((_, k) => fd.get(`rm${k}`) !== "1");
  const pid = str(fd, "new_person"); const nn = str(fd, "new_name");
  if (pid || nn) {
    let name = nn;
    if (pid) { const { data: p } = await db().from("people").select("display_name").eq("id", pid).maybeSingle(); name = (p as { display_name: string } | null)?.display_name ?? nn; }
    if (name) team = [...team, { name, role: str(fd, "new_role"), person_id: pid }];
  }
  await save(i, { team });
}

/** Facts: timeline rows and the narrative of the facts gathered. */
export async function saveFacts(fd: FormData) {
  const { i } = await editable(String(fd.get("id")));
  let timeline: TimelineRow[] = i.timeline.filter((_, k) => fd.get(`trm${k}`) !== "1");
  const at = str(fd, "t_at"); const tx = str(fd, "t_text");
  if (tx) timeline = [...timeline, { at: at ?? "", text: tx }].sort((a, b) => a.at.localeCompare(b.at));
  const facts = fd.has("facts") ? str(fd, "facts") : i.facts;
  await save(i, { timeline, facts, status: facts || timeline.length ? atLeast(i.status, "facts") : i.status });
}

/** Analysis: contributing factors by category, causes. */
export async function saveAnalysis(fd: FormData) {
  const { i } = await editable(String(fd.get("id")));
  let factors: Factor[] = i.factors.filter((_, k) => fd.get(`frm${k}`) !== "1");
  const cat = str(fd, "f_cat"); const tx = str(fd, "f_text");
  if (tx) factors = [...factors, { cat: cat && FACTOR_CAT[cat] ? cat : "organisational", text: tx }];
  const causes = fd.has("causes") ? str(fd, "causes") : i.causes;
  await save(i, { factors, causes, status: factors.length || causes ? atLeast(i.status, "analysis") : i.status });
}

export async function saveConclusions(fd: FormData) {
  const { i } = await editable(String(fd.get("id")));
  const conclusions = str(fd, "conclusions"); const report_text = fd.has("report_text") ? str(fd, "report_text") : i.report_text;
  await save(i, { conclusions, report_text, status: conclusions || report_text ? atLeast(i.status, "report") : i.status });
}

/** Draft the investigation report from the sections (never invents; the lead edits before closing). */
export async function draftInvReport(fd: FormData) {
  const { s, i } = await editable(String(fd.get("id")));
  const { data: r } = i.report_id ? await db().from("reports").select("id,headline,headline_en,narrative,narrative_en,event_date,aircraft,phase,location").eq("id", i.report_id).maybeSingle() : { data: null };
  const rep = r as { id: string; headline: string; headline_en: string | null; narrative: string; narrative_en: string | null; event_date: string | null; aircraft: string | null; phase: string | null; location: string | null } | null;
  const { data: acts } = await db().from("safety_actions").select("number,title,owner_role,due").eq("investigation_id", i.id);
  const { text, model } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity: i.entity, maxTokens: 3000,
    system: "You write the internal safety investigation report of an aviation organisation (EASA ORO.GEN.200, ICAO Doc 9859) for the investigation lead. English, factual, neutral, just-culture: no blame, no names of persons (use their function: the commander, the instructor, the student, the dispatcher), past tense. Sections in this order: 1. Summary · 2. Terms of reference · 3. Factual information (with the sequence of events) · 4. Analysis (contributing factors by category) · 5. Causes · 6. Conclusions · 7. Safety recommendations (exactly the actions given, with number, owner and due date). Use ONLY the material given; write 'Not established' where a section has no material. Plain text, numbered headings, no markdown.",
    user: `${i.number} — ${i.title}\nLevel: ${i.level}\n${rep ? `Report ${rep.id}: ${rep.headline_en ?? rep.headline} · ${rep.event_date ?? ""} · ${rep.aircraft ?? ""} · ${rep.phase ?? ""} · ${rep.location ?? ""}\nReporter's account:\n${rep.narrative_en ?? rep.narrative}\n` : ""}\nTerms of reference:\n${i.terms ?? "—"}\n\nTimeline:\n${i.timeline.map((t) => `${t.at} ${t.text}`).join("\n") || "—"}\n\nFacts:\n${i.facts ?? "—"}\n\nContributing factors:\n${i.factors.map((f) => `[${f.cat}] ${f.text}`).join("\n") || "—"}\n\nCauses:\n${i.causes ?? "—"}\n\nConclusions:\n${i.conclusions ?? "—"}\n\nActions (safety recommendations):\n${((acts ?? []) as { number: string; title: string; owner_role: string | null; due: string | null }[]).map((a) => `${a.number} ${a.title} — ${a.owner_role ?? ""} — ${a.due ?? ""}`).join("\n") || "none"}` });
  await save(i, { report_text: text.trim(), report_model: model, status: atLeast(i.status, "report") });
  await log(i.id, "draft", s.person?.id ?? null, "report drafted from the sections");
}

/** Close: conclusions and report written; the report gets an entry; the desk gives the reporter feedback from the report page. */
export async function closeInvestigation(fd: FormData) {
  const { s, i } = await editable(String(fd.get("id")));
  if (!i.conclusions) throw new Error("Write the conclusions first.");
  if (!i.report_text) throw new Error("Write (or draft) the investigation report first.");
  const now = new Date().toISOString();
  await db().from("investigations").update({ status: "closed", closed_at: now, closed_by: s.person?.id ?? null, updated_at: now }).eq("id", i.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "investigation").eq("ref_id", i.id).eq("status", "open");
  const { count } = await db().from("safety_actions").select("id", { count: "exact", head: true }).eq("investigation_id", i.id);
  await log(i.id, "closed", s.person?.id ?? null, `closed by ${s.name} — ${count ?? 0} action(s)`);
  if (i.report_id) await db().from("report_events").insert({ report_id: i.report_id, kind: "status", actor: s.person?.id ?? null, note: `Investigation ${i.number} closed — ${count ?? 0} safety action(s). Give the reporter feedback, then close the report.` });
  touch(i);
}
export async function cancelInvestigation(fd: FormData) {
  const { s, i } = await editable(String(fd.get("id")));
  const why = str(fd, "reason"); if (!why) throw new Error("Say why.");
  await db().from("investigations").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", i.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "investigation").eq("ref_id", i.id).eq("status", "open");
  await log(i.id, "cancelled", s.person?.id ?? null, why);
  if (i.report_id) await db().from("report_events").insert({ report_id: i.report_id, kind: "status", actor: s.person?.id ?? null, note: `Investigation ${i.number} cancelled — ${why}` });
  touch(i);
}
