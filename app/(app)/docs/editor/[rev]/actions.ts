"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { htmlToText } from "@/lib/wm-import";
import { structureHtml, type Manual, type Revision, type Section } from "@/lib/docs";
import { TRANSITIONS, isCmm, nextRev, ownsManual } from "@/lib/revisions";

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

/** Rev N+1 as a draft, chapters copied from the revision given (the current published one). */
export async function startRevision(formData: FormData) {
  const fromId = String(formData.get("from_revision") ?? "");
  const { s, db, rev, manual, may } = await guard(fromId);
  if (!may) throw new Error("Only the owner NP or Compliance can start a revision");
  const { data: existing } = await db.from("revisions").select("id").eq("manual_id", manual.id).not("step", "in", "(published,repository)").maybeSingle();
  if (existing?.id) redirect(`/docs/editor/${existing.id}`);
  const newRev = nextRev(rev.rev);
  const { data: created, error } = await db.from("revisions").insert({ manual_id: manual.id, issue: rev.issue, rev: newRev, step: "draft", authority_route: rev.authority_route, summary: "", created_by: s.person?.id ?? null, step_changed_by: s.person?.id ?? null }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "not created");
  const { data: secs } = await db.from("revision_sections").select("ord,ref,title,body").eq("revision_id", rev.id).order("ord");
  const rows = ((secs ?? []) as Section[]).map((x) => ({ revision_id: created.id, ord: x.ord, ref: x.ref, title: x.title, changed: false, body: { ...x.body, base_norm: null, base_html: x.body.html ?? "" } }));
  for (let i = 0; i < rows.length; i += 20) await db.from("revision_sections").insert(rows.slice(i, i + 20));
  await audit(db, s.person?.id ?? null, manual.entity, created.id, "revision_started", { code: manual.code, rev: newRev, from: rev.rev, sections: rows.length });
  revalidatePath(`/docs/manual/${manual.id}`); revalidatePath("/docs/drafts");
  redirect(`/docs/editor/${created.id}`);
}

/** Saves a chapter. `baseNorm` is the editor's own rendering of the untouched chapter, sent on first open, so that a save without change is not flagged. */
export async function saveSection(input: { revisionId: string; sectionId: string; html: string; title?: string; baseNorm?: string }): Promise<{ ok: boolean; changed?: boolean; error?: string }> {
  try {
    const { s, db, rev, manual, may } = await guard(input.revisionId);
    if (!may || rev.step !== "draft") return { ok: false, error: "This revision is not editable (draft only)." };
    const { data: cur } = await db.from("revision_sections").select("id,ord,ref,title,body").eq("id", input.sectionId).eq("revision_id", rev.id).maybeSingle();
    if (!cur) return { ok: false, error: "Chapter not found" };
    const c = cur as Section & { body: Section["body"] & { base_norm?: string | null; base_html?: string } };
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
  const patch: Record<string, unknown> = { step: to, step_changed_at: new Date().toISOString(), step_changed_by: s.person?.id ?? null };
  if (to === "approved_np") patch.submitted_at = new Date().toISOString();
  if (to === "published") patch.published_at = new Date().toISOString().slice(0, 10);
  await db.from("revisions").update(patch).eq("id", rev.id);
  if (to === "with_civil_aviation" || rev.step === "with_civil_aviation") {
    await db.from("authority_rounds").insert({ revision_id: rev.id, at: new Date().toISOString().slice(0, 10), direction: to === "with_civil_aviation" ? "sent" : "received", who: s.name, note: note || (to === "with_civil_aviation" ? "Application / notification sent" : `Return integrated → ${to}`) });
  }
  await audit(db, s.person?.id ?? null, manual.entity, rev.id, `step_${to}`, { code: manual.code, rev: rev.rev, from: rev.step, note });
  revalidatePath(`/docs/editor/${rev.id}`); revalidatePath(`/docs/manual/${manual.id}`); revalidatePath("/docs/drafts"); revalidatePath("/docs/lib");
  if (to === "published" || to === "repository") redirect(`/docs/manual/${manual.id}?rev=${rev.id}`);
}
