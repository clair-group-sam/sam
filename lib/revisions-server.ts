import type { SupabaseClient } from "@supabase/supabase-js";
import type { Revision, Section } from "@/lib/docs";
import { randomUUID } from "crypto";
import { EDITING, UNDER_REVIEW, nextRev } from "@/lib/revisions";

/** Chapters frozen in a draft: changed in the base revision while it is still under review. */
export async function frozenRefs(db: SupabaseClient, rev: Revision & { based_on?: string | null }): Promise<{ refs: Set<string>; baseRev: string | null }> {
  if (!rev.based_on) return { refs: new Set(), baseRev: null };
  const { data: b } = await db.from("revisions").select("id,rev,step").eq("id", rev.based_on).maybeSingle();
  if (!b || b.step === "published" || b.step === "repository") return { refs: new Set(), baseRev: null };
  const { data: ch } = await db.from("revision_sections").select("ref").eq("revision_id", b.id).eq("changed", true);
  return { refs: new Set(((ch ?? []) as { ref: string }[]).map((x) => x.ref)), baseRev: b.rev as string };
}


/**
 * Opens (or resumes) the draft of a manual: the revision being edited if there is one, else Rev N+1 based on the revision
 * under review (parallel revisions) or on the published one. Used by the editor's "Start a new revision" and by projects
 * that open the manuals they need by themselves. Returns null when the manual has no revision at all.
 */
export async function openDraft(db: SupabaseClient, manualId: string, who: { personId: string | null; name: string }, summary?: string): Promise<{ id: string; rev: string; created: boolean } | null> {
  const { data: open } = await db.from("revisions").select("id,rev,step,created_at").eq("manual_id", manualId).not("step", "in", "(published,repository)").order("created_at", { ascending: false });
  const opens = (open ?? []) as { id: string; rev: string; step: string }[];
  const editing = opens.find((x) => EDITING.includes(x.step));
  if (editing) return { id: editing.id, rev: editing.rev, created: false };
  const underReview = opens.find((x) => UNDER_REVIEW.includes(x.step));
  const baseId = underReview?.id ?? ((await db.from("revisions").select("id").eq("manual_id", manualId).in("step", ["published", "repository"]).order("published_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()).data as { id: string } | null)?.id;
  if (!baseId) return null;
  const { data: b } = await db.from("revisions").select("*").eq("id", baseId).single();
  const base = b as Revision;
  const newRev = nextRev(base.rev);
  const { data: created, error } = await db.from("revisions").insert({ manual_id: manualId, issue: base.issue, rev: newRev, step: "draft", authority_route: base.authority_route, summary: summary ?? "", created_by: who.personId, step_changed_by: who.personId, based_on: base.id }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "not created");
  const { data: secs } = await db.from("revision_sections").select("ord,ref,title,body,deleted_at").eq("revision_id", base.id).order("ord");
  const rows = ((secs ?? []) as (Section & { deleted_at?: string | null })[]).filter((x) => !x.deleted_at).map((x, n) => ({ revision_id: created.id, ord: n + 1, ref: x.ref, base_ref: x.ref, title: x.title, changed: false, body: { ...x.body, uid: (x.body as { uid?: string }).uid ?? randomUUID(), base_norm: null, base_html: x.body.html ?? "" } }));
  for (let i = 0; i < rows.length; i += 20) await db.from("revision_sections").insert(rows.slice(i, i + 20));
  const { data: m } = await db.from("manuals").select("entity,code").eq("id", manualId).single();
  await db.from("audit_log").insert({ actor: who.personId, entity: (m as { entity: string }).entity, object_type: "revision", object_id: created.id, action: "revision_started", after: { code: (m as { code: string }).code, rev: newRev, based_on: base.rev, parallel: !!underReview, sections: rows.length } });
  return { id: created.id, rev: newRev, created: true };
}
