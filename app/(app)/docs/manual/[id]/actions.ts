"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { isCmm, ownsManual } from "@/lib/revisions";
import type { Manual } from "@/lib/docs";
import { callClaude } from "@/lib/ai";

/** Reading acknowledgement: one row per (revision, person), kept forever (readers tab, Read tracking). Closes the reading task. */
export async function acknowledge(formData: FormData) {
  const revisionId = String(formData.get("revision_id") ?? "");
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s?.person || !revisionId) return;
  const sb = await supabaseServer();
  await sb.from("readings").upsert({ revision_id: revisionId, person_id: s.person.id, acknowledged_at: new Date().toISOString(), via: "app" }, { onConflict: "revision_id,person_id" });
  await supabaseAdmin().from("tasks").update({ status: "done" }).eq("kind", "reading").eq("owner_person", s.person.id).eq("ref_id", revisionId).eq("status", "open");
  revalidatePath(`/docs/manual/${manualId}`); revalidatePath("/home/tasks");
}

/** Who must read this manual (CMM or the owner NP). Tokens: ALL · ROLE:<post> · PERSON:<id>. */
export async function saveAudience(formData: FormData) {
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s) return;
  const db = supabaseAdmin();
  const { data: m } = await db.from("manuals").select("*").eq("id", manualId).maybeSingle();
  if (!m) return;
  const manual = m as Manual;
  if (!(isCmm(s) || ownsManual(s, manual.owner_role))) return;
  if (!s.group && !s.entities.includes(manual.entity)) return;
  const tokens = [
    ...(formData.get("all") ? ["ALL"] : []),
    ...formData.getAll("post").map((p) => `ROLE:${String(p)}`),
    ...formData.getAll("person").map((p) => `PERSON:${String(p)}`),
  ];
  await db.from("manual_audiences").delete().eq("manual_id", manual.id);
  await db.from("manual_audiences").insert((tokens.length ? tokens : ["NONE"]).map((token) => ({ manual_id: manual.id, token })));
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: manual.entity, object_type: "manual", object_id: manual.id, action: "audience", after: { tokens } });
  revalidatePath(`/docs/manual/${manual.id}`);
}

/** ★ favourite manuals, shown in the Library shortcuts across entities. */
export async function toggleFavourite(formData: FormData) {
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s?.person || !manualId) return;
  const db = supabaseAdmin();
  const { data: f } = await db.from("manual_favourites").select("manual_id").eq("person_id", s.person.id).eq("manual_id", manualId).maybeSingle();
  if (f) await db.from("manual_favourites").delete().eq("person_id", s.person.id).eq("manual_id", manualId);
  else await db.from("manual_favourites").insert({ person_id: s.person.id, manual_id: manualId });
  revalidatePath(`/docs/manual/${manualId}`); revalidatePath("/docs/lib");
}

/** Nature of the document (Compliance only): regulated manual (DOC-09 cycle, authority route) or internal document (reviewed, published by its author). */
export async function setNature(formData: FormData) {
  const manualId = String(formData.get("manual_id") ?? "");
  const internal = String(formData.get("nature") ?? "") === "internal";
  const s = await getSession();
  if (!s || !isCmm(s)) return;
  const db = supabaseAdmin();
  const { data: m } = await db.from("manuals").select("id,entity,code,internal").eq("id", manualId).maybeSingle();
  if (!m) return;
  const manual = m as { id: string; entity: string; code: string; internal: boolean };
  if (!s.group && !s.entities.includes(manual.entity)) return;
  if (manual.internal === internal) return;
  await db.from("manuals").update({ internal }).eq("id", manual.id);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: manual.entity, object_type: "manual", object_id: manual.id, action: "nature", before: { internal: manual.internal }, after: { internal, code: manual.code } });
  revalidatePath(`/docs/manual/${manual.id}`); revalidatePath("/docs/lib"); revalidatePath("/docs/drafts");
  const { data: revs } = await db.from("revisions").select("id").eq("manual_id", manual.id);
  for (const r of (revs ?? []) as { id: string }[]) revalidatePath(`/docs/editor/${r.id}`);
}

/* ------------------------------------------------------------------------------------------------
 * Ask this manual (IA plan 21/10, readers): a reader asks a question; S.A.M. picks the chapters of the
 * revision being read that mention the question's words, and Claude answers ONLY from them, citing the
 * chapters. Read-only, nothing stored but the usage line (AI-01). Answer in the reader's language.
 * ------------------------------------------------------------------------------------------------ */
export type ManualAnswer = { answer: string; notFound: boolean; cites: { ref: string; title: string; quote: string }[]; searched: number };

const STOP = new Set("the and for are with that this what when who how does must shall which from into have has been can may our your their about there where les des une est que qui pour dans par sur pas aux avec sont doit quoi comment quand quel quelle quels quelles nous vous elle ils leur plus".split(" "));
const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const ENTS: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", deg: "°", sect: "§", euro: "€", oelig: "œ", aelig: "æ" };
const MARKS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", uml: "̈", cedil: "̧", tilde: "̃", ring: "̊" };
/** HTML entities to text: named (é, «, …), accented letters (&eacute; &Agrave;…) and numeric. */
const decode = (x: string) => x
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m: string, n: string) => {
    if (ENTS[n.toLowerCase()]) return ENTS[n.toLowerCase()];
    const k = /^([a-z])(acute|grave|circ|uml|cedil|tilde|ring)$/i.exec(n);
    return k ? (k[1] + MARKS[k[2].toLowerCase()]).normalize("NFC") : m;
  });
const plain = (b: { html?: string; text?: string } | null) => decode((b?.html ?? b?.text ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const ASK_SYSTEM = `You answer a reader's question about ONE aviation organisation manual, using ONLY the chapter excerpts given.
Rules:
- Answer in the language of the QUESTION, even when the manual is written in another language (quotes stay in the manual's language). Plain professional words, at most 120 words. Lead with the answer itself.
- Use only what the excerpts say. Never use outside knowledge, never invent a rule, a delay, a post or a reference. If the excerpts do not answer, say so and set not_found to true.
- Cite every chapter you rely on by its reference (e.g. "A.3"), with one short verbatim quote (at most 25 words) from that chapter.
- Answer ONLY with a JSON object: {"answer": "...", "not_found": false, "cites": [{"ref": "A.3", "quote": "..."}]}`;

export async function askManual(input: { manualId: string; revisionId: string; question: string }): Promise<{ ok: true; a: ManualAnswer } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.person) return { ok: false, error: "Your session has expired, sign in again." };
  const question = input.question.trim().slice(0, 600);
  if (question.length < 6) return { ok: false, error: "Ask a full question, for example: who approves a temporary revision?" };
  const sb = await supabaseServer(); // row-level security: only a manual the reader can open
  const { data: m } = await sb.from("manuals").select("id,code,title,entity").eq("id", input.manualId).maybeSingle();
  if (!m) return { ok: false, error: "This manual is not available to you." };
  const { data: rows } = await sb.from("revision_sections").select("ref,title,body,deleted_at").eq("revision_id", input.revisionId).order("ord");
  const secs = ((rows ?? []) as { ref: string; title: string | null; body: { html?: string; text?: string } | null; deleted_at: string | null }[])
    .filter((r) => !r.deleted_at).map((r) => ({ ref: r.ref, title: r.title ?? "", text: plain(r.body) })).filter((r) => r.text.length > 0);
  const terms = [...new Set(fold(question).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
  if (!terms.length) return { ok: false, error: "Ask with a few precise words (a post, a document, a delay…)." };
  const scored = secs.map((x) => {
    const body = fold(x.text), head = fold(x.ref + " " + x.title);
    let sc = 0;
    for (const t of terms) { const n = body.split(t).length - 1; sc += Math.min(n, 8) + (head.includes(t) ? 6 : 0); }
    return { ...x, sc };
  }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 8);
  if (!scored.length) return { ok: true, a: { answer: "No chapter of this revision mentions these words. Try other words, or the full-text search of the library.", notFound: true, cites: [], searched: secs.length } };
  const lang = /[éèêàùçœ]/i.test(question) || /\b(qui|quel|quelle|quels|quelles|est|sont|les|des|une|pour|dans|doit|comment|quand|faut)\b/i.test(question) ? "French" : "English";
  let budget = 48_000;
  const excerpts = scored.map((x) => { const t = x.text.slice(0, Math.max(1500, Math.min(9000, budget))); budget -= t.length; return `### Chapter ${x.ref}: ${x.title}\n${t}`; }).filter((_, i) => i === 0 || budget > 0);
  try {
    const { text } = await callClaude({ agent: "ask", personId: s.person.id, entity: m.entity, system: ASK_SYSTEM, maxTokens: 900,
      user: `Manual: ${m.code}, ${m.title} (${m.entity}).\nANSWER LANGUAGE: ${lang} (the language of the question; quotes stay as written in the manual).\n\nQUESTION: ${question}\n\nEXCERPTS (the chapters that mention the question's words):\n${excerpts.join("\n\n")}` });
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { answer?: string; not_found?: boolean; cites?: { ref: string; quote?: string }[] };
    const byRef = new Map(secs.map((x) => [x.ref.toLowerCase(), x]));
    // the model may write "Chapter A.5", "§A.5" or a sub-chapter "A.5.2": bring each cite back to a chapter of this revision
    const resolve = (raw: string) => {
      let r = String(raw ?? "").replace(/^(chapter|chapitre|section|§)\s*/i, "").trim().toLowerCase();
      while (r && !byRef.has(r)) { const cut = r.lastIndexOf("."); if (cut <= 0) break; r = r.slice(0, cut); }
      return byRef.get(r) ?? null;
    };
    const seen = new Set<string>();
    let cites = (j.cites ?? []).map((c) => ({ x: resolve(c.ref), quote: (c.quote ?? "").slice(0, 220) }))
      .filter((c) => c.x && !seen.has(c.x.ref) && seen.add(c.x.ref)).slice(0, 5).map((c) => ({ ref: c.x!.ref, title: c.x!.title, quote: c.quote }));
    // no usable cite: show where SAM looked first, so the reader can check
    if (!cites.length && !j.not_found) cites = scored.slice(0, 2).map((x) => ({ ref: x.ref, title: x.title, quote: "" }));
    return { ok: true, a: { answer: (j.answer ?? "").trim() || "No answer.", notFound: !!j.not_found, cites, searched: secs.length } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "SAM could not answer, try again." };
  }
}
