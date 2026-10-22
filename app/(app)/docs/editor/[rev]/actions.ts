"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { sendUpdateNotice } from "@/lib/notice";
import { expectedReturn, type ReturnKind } from "@/lib/revisions";
import { ENT } from "@/lib/nav";
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
  const patch: Record<string, unknown> = { summary: String(formData.get("summary") ?? "") };
  if (formData.has("authority_ref")) patch.authority_ref = String(formData.get("authority_ref") ?? "") || null;
  await db.from("revisions").update(patch).eq("id", rev.id);
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
  const r2 = rev as Revision & { return_kind?: string | null; return_pdf_path?: string | null };
  if (to === "published" && rev.step === "with_civil_aviation") {
    const kind = (r2.return_kind ?? expectedReturn(manual.entity, manual.code, rev.authority_route)) as ReturnKind;
    if (kind !== "none" && !r2.return_pdf_path) throw new Error("The authority's return must be integrated before publication (DOC-03).");
  }
  const patch: Record<string, unknown> = { step: to, step_changed_at: new Date().toISOString(), step_changed_by: s.person?.id ?? null };
  if (to === "approved_np") patch.submitted_at = new Date().toISOString();
  if (to === "published") patch.published_at = new Date().toISOString().slice(0, 10);
  await db.from("revisions").update(patch).eq("id", rev.id);
  if (to === "with_civil_aviation" || rev.step === "with_civil_aviation") {
    await db.from("authority_rounds").insert({ revision_id: rev.id, at: new Date().toISOString().slice(0, 10), direction: to === "with_civil_aviation" ? "sent" : "received", who: s.name, note: note || (to === "with_civil_aviation" ? "Application / notification sent" : `Return integrated → ${to}`) });
  }
  if (to === "published") {
    await rebaseDependants(db, rev.id, rev.rev);
    // DOC-04: the update notice is created only after publication
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const { data: ch } = await db.from("revision_sections").select("ref,title").eq("revision_id", rev.id).eq("changed", true).order("ord");
    const { data: fresh } = await db.from("revisions").select("*").eq("id", rev.id).maybeSingle();
    const n = await sendUpdateNotice(db, { manual, rev: (fresh ?? rev) as Revision, origin, senderId: s.person?.id ?? null, changed: (ch ?? []) as { ref: string; title: string | null }[] });
    await audit(db, s.person?.id ?? null, manual.entity, rev.id, "update_notice", { recipients: n.recipients, emailed: n.emailed, email: n.emailStatus });
  }
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

/** DOC-03 · the authority's return: original PDF + the pages kept in the manual (approval / signature page, stamped LEP). */
export async function recordReturn(input: { revisionId: string; kind: ReturnKind; pdfPath: string; pages: { path: string; role: "approval" | "lep" | "signature"; page: number }[]; receivedAt: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { s, db, rev, manual } = await guard(input.revisionId);
    if (!isCmm(s)) return { ok: false, error: "Compliance only (DOC-06)." };
    if (rev.step !== "with_civil_aviation") return { ok: false, error: "The revision is not with the authority." };
    const prefix = `${manual.entity}/`;
    if (!input.pdfPath.startsWith(prefix) || input.pages.some((p) => !p.path.startsWith(prefix))) return { ok: false, error: "Unexpected file location." };
    await db.from("revisions").update({ return_kind: input.kind, return_pdf_path: input.pdfPath, return_pages: input.pages, return_received_at: input.receivedAt || new Date().toISOString().slice(0, 10), return_by: s.person?.id ?? null }).eq("id", rev.id);
    await db.from("authority_rounds").insert({ revision_id: rev.id, at: input.receivedAt || new Date().toISOString().slice(0, 10), direction: "received", who: s.name, note: `Authority return integrated: ${input.pages.length} page(s) kept in the manual` });
    await audit(db, s.person?.id ?? null, manual.entity, rev.id, "authority_return", { kind: input.kind, pages: input.pages.length, received: input.receivedAt });
    revalidatePath(`/docs/editor/${rev.id}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
export async function clearReturn(formData: FormData) {
  const { s, db, rev, manual } = await guard(String(formData.get("revision_id") ?? ""));
  if (!isCmm(s) || rev.step !== "with_civil_aviation") return;
  await db.from("revisions").update({ return_pdf_path: null, return_pages: null, return_received_at: null }).eq("id", rev.id);
  await audit(db, s.person?.id ?? null, manual.entity, rev.id, "authority_return_removed", {});
  revalidatePath(`/docs/editor/${rev.id}`);
}
export async function setReturnKind(formData: FormData) {
  const { s, db, rev } = await guard(String(formData.get("revision_id") ?? ""));
  if (!isCmm(s)) return;
  await db.from("revisions").update({ return_kind: String(formData.get("kind") ?? "none") }).eq("id", rev.id);
  revalidatePath(`/docs/editor/${rev.id}`);
}

/** DOC-06 · proposal for the authority route, from the changed chapters and the manual's own amendment procedure. Compliance decides. */
export type RouteProposal = { route: "notification" | "approval" | "none"; confidence: "high" | "medium" | "low"; reasons: { chapter: string; change: string; rule: string }[]; summary: string; at?: string; model?: string };
export async function proposeRoute(input: { revisionId: string }): Promise<{ ok: true; proposal: RouteProposal } | { ok: false; error: string }> {
  try {
    const { s, db, rev, manual } = await guard(input.revisionId);
    if (!isCmm(s)) return { ok: false, error: "Compliance only (DOC-06)." };
    const { data: ch } = await db.from("revision_sections").select("ref,title,body").eq("revision_id", rev.id).eq("changed", true).order("ord");
    const changed = (ch ?? []) as Section[];
    if (!changed.length) return { ok: false, error: "No chapter has been changed in this revision." };
    const baseId = (rev as Revision & { based_on?: string | null }).based_on;
    const baseMap = new Map<string, string>();
    if (baseId) {
      const { data: b } = await db.from("revision_sections").select("ref,body").eq("revision_id", baseId).in("ref", changed.map((c) => c.ref));
      for (const x of (b ?? []) as Section[]) baseMap.set(x.ref, stripHtml(x.body.html ?? x.body.text ?? ""));
    }
    const { data: all } = await db.from("revision_sections").select("ref,title,body").eq("revision_id", rev.id).order("ord");
    const procedure = ((all ?? []) as Section[]).filter((x) => /amend|modif|change|approbation|approval|notif/i.test(x.title ?? "")).map((x) => `### ${x.ref} ${x.title}\n${stripHtml(x.body.html ?? "").slice(0, 6000)}`).join("\n\n").slice(0, 14000);
    const blocks = changed.slice(0, 25).map((c) => `### ${c.ref} ${c.title ?? ""}\nBEFORE:\n${(baseMap.get(c.ref) ?? "(not available)").slice(0, 3500)}\nAFTER:\n${stripHtml(c.body.html ?? "").slice(0, 3500)}`).join("\n\n");
    const ent = ENT[manual.entity];
    const system = `You assist the Compliance Monitoring Manager of an aviation organisation. For a revision of a regulatory manual you propose whether the authority must APPROVE it before publication, only be NOTIFIED, or neither. Base yourself on (1) the manual's own amendment procedure quoted below, which prevails, then (2) the applicable EASA rules for this organisation (Part-CAO: CAO.A.015 / CAO.A.025 changes; Part-CAMO: CAMO.A.130 and the CAME indirect approval procedure; AOC: ORO.GEN.130 and ORO.GEN.200; ATO: ORA.GEN.130). Typical approval items: name, location, accountable manager and nominated persons, scope / ratings, facilities, the change procedure itself. Editorial, typographical or purely internal procedural changes are usually notification or none according to the procedure. Never invent references; when unsure, say so and lower the confidence. Answer ONLY with JSON: {"route":"approval|notification|none","confidence":"high|medium|low","summary":"one or two sentences","reasons":[{"chapter":"ref","change":"what changed","rule":"procedure paragraph or rule that applies"}]}`;
    const user = `Organisation: ${ent?.name ?? manual.entity} (${ent?.qual ?? ""}), authority ${ent?.auth ?? ""}. Manual: ${manual.code} — ${manual.title}, Issue ${rev.issue} Rev ${rev.rev}.\nRevision summary by the author: ${rev.summary ?? "(none)"}\n\nAMENDMENT PROCEDURE OF THE MANUAL:\n${procedure || "(no amendment chapter found)"}\n\nCHANGED CHAPTERS:\n${blocks}`;
    const { text, model } = await callClaude({ agent: "route", personId: s.person?.id ?? null, entity: manual.entity, system, user, maxTokens: 2500 });
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return { ok: false, error: "No proposal returned." };
    const proposal = { ...(JSON.parse(m[0]) as RouteProposal), at: new Date().toISOString(), model };
    if (!["approval", "notification", "none"].includes(proposal.route)) return { ok: false, error: "Unexpected proposal." };
    await db.from("revisions").update({ route_proposal: proposal }).eq("id", rev.id);
    revalidatePath(`/docs/editor/${rev.id}`);
    return { ok: true, proposal };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
/** Compliance's decision on the route (DOC-06). The journal records the person who decided. */
export async function decideRoute(formData: FormData) {
  const { s, db, rev, manual } = await guard(String(formData.get("revision_id") ?? ""));
  if (!isCmm(s)) return;
  const route = String(formData.get("route") ?? "");
  if (!["approval", "notification", "none"].includes(route)) return;
  await db.from("revisions").update({ authority_route: route, return_kind: expectedReturn(manual.entity, manual.code, route) }).eq("id", rev.id);
  await audit(db, s.person?.id ?? null, manual.entity, rev.id, "authority_route", { route });
  revalidatePath(`/docs/editor/${rev.id}`);
}
