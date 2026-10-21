"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { htmlToText } from "@/lib/wm-import";
import { structureHtml, type Manual, type Revision, type Section } from "@/lib/docs";
import { TRANSITIONS, isCmm, nextRev, ownsManual, UNDER_REVIEW, EDITING } from "@/lib/revisions";
import { frozenRefs } from "@/lib/revisions-server";
import { callClaude, parseJsonBlock, userPromptFor, type AiAgent } from "@/lib/ai";
import { stripHtml } from "@/lib/docs";

async function guard(revisionId: string) {
  const s = await getSession();
  if (!s) throw new Error("Not signed in");
  const db = supabaseAdmin();
  const { data: r } = await db.from("revisions").select("*").eq("id", revisionId).maybeSingle();
  if (!r) throw new Error("Revision not found");
  const rev = r as Revision;
  const { data: m } = await db.from("manuals").select("*").eq("id", rev.manual_id).maybeSingle();
  const manual = m as Manual;
  if (!s.group && !s.entities.includes(manual.entity)) throw new Error("Out of scope");
  const may = isCmm(s) || ownsManual(s, manual.owner_role);
  return { s, db, rev, manual, may };
}
async function audit(db: ReturnType<typeof supabaseAdmin>, actor: string | null, entity: string, objectId: string, action: string, after: unknown) {
  await db.from("audit_log").insert({ actor, entity, object_type: "revision", object_id: objectId, action, after });
}

/** Rev N+1 as a draft. Based on the revision under review when there is one (parallel revisions), else on the published one. */
export async function startRevision(formData: FormData) {
  const fromId = String(formData.get("from_revision") ?? "");
  const { s, db, rev, manual, may } = await guard(fromId);
  if (!may) throw new Error("Only the owner NP or Compliance can start a revision");
  const { data: open } = await db.from("revisions").select("id,rev,step,created_at").eq("manual_id", manual.id).not("step", "in", "(published,repository)").order("created_at", { ascending: false });
  const opens = (open ?? []) as { id: string; rev: string; step: string }[];
  const editing = opens.find((x) => EDITING.includes(x.step));
  if (editing) redirect(`/docs/editor/${editing.id}`);                 // one revision per upstream step: resume it
  const underReview = opens.find((x) => UNDER_REVIEW.includes(x.step));
  const base = underReview ? (await db.from("revisions").select("*").eq("id", underReview.id).single()).data as Revision : rev;
  const newRev = nextRev(base.rev);
  const { data: created, error } = await db.from("revisions").insert({ manual_id: manual.id, issue: base.issue, rev: newRev, step: "draft", authority_route: base.authority_route, summary: "", created_by: s.person?.id ?? null, step_changed_by: s.person?.id ?? null, based_on: base.id }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "not created");
  const { data: secs } = await db.from("revision_sections").select("ord,ref,title,body").eq("revision_id", base.id).order("ord");
  const rows = ((secs ?? []) as Section[]).map((x) => ({ revision_id: created.id, ord: x.ord, ref: x.ref, title: x.title, changed: false, body: { ...x.body, base_norm: null, base_html: x.body.html ?? "" } }));
  for (let i = 0; i < rows.length; i += 20) await db.from("revision_sections").insert(rows.slice(i, i + 20));
  await audit(db, s.person?.id ?? null, manual.entity, created.id, "revision_started", { code: manual.code, rev: newRev, based_on: base.rev, parallel: !!underReview, sections: rows.length });
  revalidatePath(`/docs/manual/${manual.id}`); revalidatePath("/docs/drafts");
  redirect(`/docs/editor/${created.id}`);
}

/** Takes the approved text for a conflicting chapter (base wins), or keeps own text (conflict cleared). */
export async function resolveConflict(formData: FormData) {
  const revisionId = String(formData.get("revision_id") ?? ""); const sectionId = String(formData.get("section_id") ?? ""); const choice = String(formData.get("choice") ?? "");
  const { s, db, rev, may } = await guard(revisionId);
  if (!may || rev.step !== "draft") return;
  const { data: cur } = await db.from("revision_sections").select("id,ref,ord,body,conflict").eq("id", sectionId).eq("revision_id", rev.id).maybeSingle();
  if (!cur?.conflict) return;
  const c = cur as Section & { conflict: { base_html: string } };
  if (choice === "base") {
    const st = structureHtml(c.conflict.base_html, `s${c.ord}`, c.ref);
    await db.from("revision_sections").update({ body: { ...c.body, html: st.html, headings: st.headings, structured: true, text: htmlToText(st.html), base_html: c.conflict.base_html, base_norm: null }, changed: false, conflict: null, updated_at: new Date().toISOString(), updated_by: s.person?.id ?? null }).eq("id", c.id);
  } else {
    await db.from("revision_sections").update({ conflict: null, body: { ...c.body, base_html: c.conflict.base_html, base_norm: null }, changed: true }).eq("id", c.id);
  }
  revalidatePath(`/docs/editor/${rev.id}`);
}

/** Saves a chapter. `baseNorm` is the editor's own rendering of the untouched chapter, sent on first open, so that a save without change is not flagged. */
export async function saveSection(input: { revisionId: string; sectionId: string; html: string; title?: string; baseNorm?: string }): Promise<{ ok: boolean; changed?: boolean; error?: string }> {
  try {
    const { s, db, rev, manual, may } = await guard(input.revisionId);
    if (!may || rev.step !== "draft") return { ok: false, error: "This revision is not editable (draft only)." };
    const fz = await frozenRefs(db, rev as Revision & { based_on?: string | null });
    const { data: cur } = await db.from("revision_sections").select("id,ord,ref,title,body").eq("id", input.sectionId).eq("revision_id", rev.id).maybeSingle();
    if (!cur) return { ok: false, error: "Chapter not found" };
    const c = cur as Section & { body: Section["body"] & { base_norm?: string | null; base_html?: string } };
    if (fz.refs.has(c.ref)) return { ok: false, error: `Chapter ${c.ref} is frozen: changed in Rev ${fz.baseRev}, under review. It unlocks when Rev ${fz.baseRev} is published.` };
    const baseNorm = c.body.base_norm ?? input.baseNorm ?? null;
    const norm = (h: string) => h.replace(/\s+/g, " ").trim();
    const changed = baseNorm !== null ? norm(input.html) !== norm(baseNorm) : norm(input.html) !== norm(c.body.base_html ?? "");
    const st = structureHtml(input.html, `s${c.ord}`, c.ref);
    const body = { ...c.body, html: st.html, headings: st.headings, structured: true, text: htmlToText(st.html), base_norm: baseNorm };
    const { error } = await db.from("revision_sections").update({ body, changed, title: input.title ?? c.title, updated_at: new Date().toISOString(), updated_by: s.person?.id ?? null }).eq("id", c.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/docs/editor/${rev.id}`); revalidatePath(`/docs/manual/${manual.id}`);
    return { ok: true, changed };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function saveSummary(formData: FormData) {
  const revisionId = String(formData.get("revision_id") ?? "");
  const { db, rev, may } = await guard(revisionId);
  if (!may) return;
  await db.from("revisions").update({ summary: String(formData.get("summary") ?? ""), authority_route: String(formData.get("authority_route") ?? "") || null, authority_ref: String(formData.get("authority_ref") ?? "") || null }).eq("id", rev.id);
  revalidatePath(`/docs/editor/${rev.id}`);
}

/** DOC-09 step change, checked against the transition table and the caller's role. */
export async function moveStep(formData: FormData) {
  const revisionId = String(formData.get("revision_id") ?? "");
  const to = String(formData.get("to") ?? "");
  const note = String(formData.get("note") ?? "");
  const { s, db, rev, manual } = await guard(revisionId);
  const t = TRANSITIONS.find((x) => x.from === rev.step && x.to === to);
  if (!t) throw new Error("Transition not allowed");
  const cmm = isCmm(s), owner = ownsManual(s, manual.owner_role);
  if (!(t.by === "cmm" ? cmm : t.by === "owner" ? owner : owner || cmm)) throw new Error("Not allowed for your role");
  if (to === "approved_np") {
    const { count } = await db.from("revision_sections").select("id", { count: "exact", head: true }).eq("revision_id", rev.id).not("conflict", "is", null);
    if (count) throw new Error(`${count} chapter(s) in conflict must be resolved before submitting.`);
  }
  const patch: Record<string, unknown> = { step: to, step_changed_at: new Date().toISOString(), step_changed_by: s.person?.id ?? null };
  if (to === "approved_np") patch.submitted_at = new Date().toISOString();
  if (to === "published") patch.published_at = new Date().toISOString().slice(0, 10);
  await db.from("revisions").update(patch).eq("id", rev.id);
  if (to === "with_civil_aviation" || rev.step === "with_civil_aviation") {
    await db.from("authority_rounds").insert({ revision_id: rev.id, at: new Date().toISOString().slice(0, 10), direction: to === "with_civil_aviation" ? "sent" : "received", who: s.name, note: note || (to === "with_civil_aviation" ? "Application / notification sent" : `Return integrated → ${to}`) });
  }
  if (to === "published") await rebaseDependants(db, rev.id, rev.rev);
  await audit(db, s.person?.id ?? null, manual.entity, rev.id, `step_${to}`, { code: manual.code, rev: rev.rev, from: rev.step, note });
  revalidatePath(`/docs/editor/${rev.id}`); revalidatePath(`/docs/manual/${manual.id}`); revalidatePath("/docs/drafts"); revalidatePath("/docs/lib");
  if (to === "published" || to === "repository") redirect(`/docs/manual/${manual.id}?rev=${rev.id}`);
}

/** On publication: later drafts based on this revision receive its final text for the chapters it changed (or a conflict when they changed it too). */
async function rebaseDependants(db: ReturnType<typeof supabaseAdmin>, baseId: string, baseRev: string) {
  const { data: deps } = await db.from("revisions").select("id").eq("based_on", baseId).not("step", "in", "(published,repository)");
  if (!deps?.length) return;
  const { data: changedBase } = await db.from("revision_sections").select("ref,ord,title,body").eq("revision_id", baseId).eq("changed", true);
  const bases = (changedBase ?? []) as Section[];
  for (const d of deps as { id: string }[]) {
    for (const b of bases) {
      const { data: tgt } = await db.from("revision_sections").select("id,changed,body").eq("revision_id", d.id).eq("ref", b.ref).maybeSingle();
      if (!tgt) { await db.from("revision_sections").insert({ revision_id: d.id, ord: b.ord, ref: b.ref, title: b.title, changed: false, body: { ...b.body, base_norm: null, base_html: b.body.html ?? "" } }); continue; }
      const t = tgt as { id: string; changed: boolean; body: Section["body"] };
      if (t.changed) await db.from("revision_sections").update({ conflict: { base_html: b.body.html ?? "", base_rev: baseRev, at: new Date().toISOString() } }).eq("id", t.id);
      else await db.from("revision_sections").update({ title: b.title, changed: false, body: { ...b.body, base_norm: null, base_html: b.body.html ?? "" } }).eq("id", t.id);
    }
  }
}

/** Cancel changes on a chapter: back to the text of the base revision, "changed" cleared. */
export async function revertSection(input: { revisionId: string; sectionId: string }): Promise<{ ok: boolean; html?: string; error?: string }> {
  try {
    const { s, db, rev, manual, may } = await guard(input.revisionId);
    if (!may || rev.step !== "draft") return { ok: false, error: "Draft only." };
    const { data: cur } = await db.from("revision_sections").select("id,ord,ref,body").eq("id", input.sectionId).eq("revision_id", rev.id).maybeSingle();
    if (!cur) return { ok: false, error: "Chapter not found" };
    const c = cur as Section & { body: Section["body"] & { base_html?: string } };
    const baseHtml = c.body.base_html ?? "";
    const st = structureHtml(baseHtml, `s${c.ord}`, c.ref);
    const { error } = await db.from("revision_sections").update({ body: { ...c.body, html: st.html, headings: st.headings, structured: true, text: htmlToText(st.html), base_norm: null }, changed: false, updated_at: new Date().toISOString(), updated_by: s.person?.id ?? null }).eq("id", c.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/docs/editor/${rev.id}`); revalidatePath(`/docs/manual/${manual.id}`);
    return { ok: true, html: st.html };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Draft with AI: a proposal for ONE chapter, never written to the document by itself (the author inserts, edits or discards). */
export async function aiPropose(input: { revisionId: string; sectionId: string; agent: AiAgent; request: string; currentHtml: string }): Promise<{ ok: true; html: string; notes: { where: string; change: string; why: string }[]; model: string } | { ok: false; error: string }> {
  try {
    const { s, db, rev, manual, may } = await guard(input.revisionId);
    if (!may || rev.step !== "draft") return { ok: false, error: "Draft only." };
    const { data: cur } = await db.from("revision_sections").select("id,ref,title").eq("id", input.sectionId).eq("revision_id", rev.id).maybeSingle();
    if (!cur) return { ok: false, error: "Chapter not found" };
    const { data: others } = await db.from("revision_sections").select("ref,title").eq("revision_id", rev.id).order("ord");
    const html = input.currentHtml.slice(0, 120_000);
    if (stripHtml(html).length > 60_000) return { ok: false, error: "This chapter is too long for a single proposal — split it or ask for a specific sub-chapter." };
    const user = userPromptFor(input.agent, { manual: manual.title, entity: manual.entity, chapterRef: cur.ref as string, chapterTitle: (cur.title as string) ?? "", chapterHtml: html, neighbours: ((others ?? []) as { ref: string; title: string | null }[]).map((o) => `${o.ref} ${o.title ?? ""}`).slice(0, 80), request: input.request });
    const { text, model } = await callClaude({ agent: input.agent, personId: s.person?.id ?? null, entity: manual.entity, user, maxTokens: 12000 });
    const parsed = parseJsonBlock(text);
    return { ok: true, html: parsed.html, notes: parsed.notes, model };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
