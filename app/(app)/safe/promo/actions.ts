"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { AUDIENCE, PROMO_KIND, audiencePeople, mayPublish, mayWrite, nextPromoNumber, type Promotion, type Question } from "@/lib/promotion";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
async function sess(): Promise<Session> { const s = await getSession(); if (!s) throw new Error("Sign in again."); return s; }
async function load(id: string): Promise<Promotion> { const { data } = await db().from("safety_promotions").select("*").eq("id", id).single(); if (!data) throw new Error("Not found."); return data as Promotion; }
async function draftOf(id: string) {
  const s = await sess(); const p = await load(id);
  if (!s.entities.includes(p.entity) || !mayWrite(s)) throw new Error("Reserved to the safety desk, the NPs and the AM.");
  if (p.status !== "draft") throw new Error("Published — it is not changed. Publish a new one (it can refer to this one).");
  return { s, p };
}
const touch = (id?: string) => { revalidatePath("/safe/promo"); if (id) revalidatePath(`/safe/promo/${id}`); revalidatePath("/home/tasks"); };

export async function createPromotion(fd: FormData) {
  const s = await sess(); const entity = str(fd, "entity");
  if (!entity || !s.entities.includes(entity) || !mayWrite(s)) throw new Error("Pick an entity in your scope.");
  const kind = PROMO_KIND[str(fd, "kind") ?? ""] ? str(fd, "kind")! : "bulletin";
  const title = str(fd, "title"); if (!title) throw new Error("Give it a title.");
  const audience = AUDIENCE[str(fd, "audience") ?? ""] ? str(fd, "audience")! : "all";
  const number = await nextPromoNumber(db(), entity, kind);
  const { data, error } = await db().from("safety_promotions").insert({ entity, kind, number, title: title.slice(0, 200), audience, ack_required: kind !== "bulletin" || fd.get("ack") === "1",
    report_id: str(fd, "report_id"), investigation_id: str(fd, "investigation_id"), anonymous: kind === "survey", body: str(fd, "notes"), created_by: s.person?.id ?? null }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Not created.");
  touch(); redirect(`/safe/promo/${(data as { id: string }).id}`);
}

export async function savePromotion(fd: FormData) {
  const { p } = await draftOf(String(fd.get("id")));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "summary", "body", "due", "closes_at"] as const) if (fd.has(k)) patch[k] = str(fd, k);
  if (fd.has("audience") && AUDIENCE[String(fd.get("audience"))]) patch.audience = String(fd.get("audience"));
  if (fd.has("ack_flag")) patch.ack_required = fd.get("ack") === "1";
  if (fd.has("anon_flag")) patch.anonymous = fd.get("anonymous") === "1";
  if (patch.title === null) delete patch.title;
  await db().from("safety_promotions").update(patch).eq("id", p.id); touch(p.id);
}

/** Survey questions: add (scale 1–5, choice, free text) or remove. */
export async function saveQuestion(fd: FormData) {
  const { p } = await draftOf(String(fd.get("id")));
  let q: Question[] = [...p.questions];
  const rm = str(fd, "remove"); if (rm) q = q.filter((x) => x.key !== rm);
  const label = str(fd, "label");
  if (label) { const type = (["scale", "choice", "text"].includes(String(fd.get("type"))) ? fd.get("type") : "scale") as Question["type"];
    q.push({ key: `q${Date.now().toString(36)}`, label: label.slice(0, 300), type, options: type === "choice" ? (str(fd, "options") ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 10) : undefined }); }
  await db().from("safety_promotions").update({ questions: q, updated_at: new Date().toISOString() }).eq("id", p.id); touch(p.id);
}

/** Draft the text from the linked report / investigation (de-identified) and the author's notes; the author edits before publishing. */
export async function draftPromotion(fd: FormData) {
  const { s, p } = await draftOf(String(fd.get("id")));
  let src = "";
  if (p.report_id) { const { data } = await db().from("reports").select("headline,headline_en,narrative,narrative_en,event_date,aircraft,phase,findings,investigation").eq("id", p.report_id).maybeSingle();
    const r = data as Record<string, string | null> | null; if (r) src += `Report: ${r.headline_en ?? r.headline} · ${r.event_date ?? ""} · ${r.phase ?? ""}\n${r.narrative_en ?? r.narrative}\n${r.investigation ? `Investigation (source tool): ${r.investigation}\n` : ""}${r.findings ? `Findings: ${r.findings}\n` : ""}`; }
  if (p.investigation_id) { const { data } = await db().from("investigations").select("number,title,facts,causes,conclusions,report_text").eq("id", p.investigation_id).maybeSingle();
    const i = data as Record<string, string | null> | null; if (i) src += `\nInvestigation ${i.number} — ${i.title}\n${i.report_text ?? `Facts: ${i.facts ?? "—"}\nCauses: ${i.causes ?? "—"}\nConclusions: ${i.conclusions ?? "—"}`}\n`;
    const { data: a } = await db().from("safety_actions").select("title").eq("investigation_id", p.investigation_id); if (a?.length) src += `Actions decided: ${(a as { title: string }[]).map((x) => x.title).join("; ")}\n`; }
  const kind = PROMO_KIND[p.kind].label;
  const { text, model } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity: p.entity, maxTokens: 1800,
    system: `You write a ${kind} for the staff and crews of an aviation organisation (EASA ORO.GEN.200(a)(4) safety communication). English, plain, positive, just-culture. De-identify completely: no names, no registration, no flight number, no exact date — keep only what helps others learn. ${p.kind === "notice" ? "A notice is short (under 150 words): what, why it matters, what to do now." : p.kind === "survey" ? "For a survey, write a short introduction (purpose, anonymity, 5 minutes) — the questions are set separately." : "A bulletin: what happened (briefly), what we learned, what to do / remember (3–5 bullet points starting with -)."} Use only the material given; never invent facts. First line: a one-sentence summary. Then a blank line. Then the text. No markdown headings.`,
    user: `Title: ${p.title}\nAudience: ${AUDIENCE[p.audience]}\n\nAuthor's notes:\n${p.body ?? "—"}\n\nMaterial:\n${src || "—"}` });
  const [first, ...rest] = text.trim().split(/\n\s*\n/);
  await db().from("safety_promotions").update({ summary: first.trim().slice(0, 400), body: rest.join("\n\n").trim() || first.trim(), draft_model: model, updated_at: new Date().toISOString() }).eq("id", p.id); touch(p.id);
}

/** Publish: every person of the audience gets it in the Inbox (read / acknowledge / answer); then frozen. */
export async function publishPromotion(fd: FormData) {
  const { s, p } = await draftOf(String(fd.get("id")));
  if (!mayPublish(s)) throw new Error("Published by the safety desk (SM / CMM / FSO).");
  if (!p.body?.trim() && p.kind !== "survey") throw new Error("Write the text first.");
  if (p.kind === "survey" && !p.questions.length) throw new Error("Add at least one question.");
  const people = await audiencePeople(db(), p.entity, p.audience);
  if (!people.length) throw new Error("Nobody in this audience yet.");
  const now = new Date().toISOString();
  const due = p.due ?? (p.kind === "notice" ? new Date(Date.now() + 7 * 864e5) : new Date(Date.now() + 21 * 864e5)).toISOString().slice(0, 10);
  await db().from("safety_promotions").update({ status: "published", published_at: now, published_by: s.person?.id ?? null, due, updated_at: now }).eq("id", p.id);
  await db().from("safety_promotion_reads").upsert(people.map((person_id) => ({ promotion_id: p.id, person_id, sent_at: now })), { onConflict: "promotion_id,person_id", ignoreDuplicates: true });
  const verb = p.kind === "survey" ? "to answer" : p.ack_required ? "to acknowledge" : "to read";
  const rows = people.map((owner_person) => ({ entity: p.entity, kind: "promo_read", title: `${p.number} — ${PROMO_KIND[p.kind].label.toLowerCase()} ${verb}`, detail: (p.summary ?? p.title).slice(0, 200), due, owner_person, status: "open", link: `/safe/promo/${p.id}`, ref_id: p.id }));
  for (let k = 0; k < rows.length; k += 200) await db().from("tasks").insert(rows.slice(k, k + 200));
  touch(p.id);
}

const myRead = async (id: string) => { const s = await sess(); if (!s.person) throw new Error("Sign in again."); const p = await load(id); if (!s.entities.includes(p.entity)) throw new Error("Not in your scope."); return { s, p }; };
const doneTask = (p: Promotion, person: string) => db().from("tasks").update({ status: "done" }).eq("kind", "promo_read").eq("ref_id", p.id).eq("owner_person", person).eq("status", "open");

export async function ackPromotion(fd: FormData) {
  const { s, p } = await myRead(String(fd.get("id"))); const now = new Date().toISOString();
  await db().from("safety_promotion_reads").upsert({ promotion_id: p.id, person_id: s.person!.id, read_at: now, acknowledged_at: now }, { onConflict: "promotion_id,person_id" });
  await doneTask(p, s.person!.id); touch(p.id);
}
export async function answerSurvey(fd: FormData) {
  const { s, p } = await myRead(String(fd.get("id")));
  if (p.kind !== "survey" || p.status !== "published") throw new Error("This survey is not open.");
  const { data: r } = await db().from("safety_promotion_reads").select("answered_at").eq("promotion_id", p.id).eq("person_id", s.person!.id).maybeSingle();
  if ((r as { answered_at: string | null } | null)?.answered_at) throw new Error("You already answered — thank you.");
  const answers = Object.fromEntries(p.questions.map((q) => [q.key, str(fd, q.key)]).filter(([, v]) => v));
  if (!Object.keys(answers).length) throw new Error("Answer at least one question.");
  const now = new Date().toISOString();
  await db().from("safety_survey_answers").insert({ promotion_id: p.id, person_id: p.anonymous ? null : s.person!.id, answers, at: p.anonymous ? now.slice(0, 10) + "T00:00:00Z" : now });
  await db().from("safety_promotion_reads").upsert({ promotion_id: p.id, person_id: s.person!.id, read_at: now, answered_at: now }, { onConflict: "promotion_id,person_id" });
  await doneTask(p, s.person!.id); touch(p.id);
}
export async function closePromotion(fd: FormData) {
  const s = await sess(); const p = await load(String(fd.get("id")));
  if (!s.entities.includes(p.entity) || !mayPublish(s)) throw new Error("Reserved to the safety desk.");
  await db().from("safety_promotions").update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", p.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "promo_read").eq("ref_id", p.id).eq("status", "open");
  touch(p.id);
}
