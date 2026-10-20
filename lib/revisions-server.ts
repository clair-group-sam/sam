import type { SupabaseClient } from "@supabase/supabase-js";
import type { Revision } from "@/lib/docs";

/** Chapters frozen in a draft: changed in the base revision while it is still under review. */
export async function frozenRefs(db: SupabaseClient, rev: Revision & { based_on?: string | null }): Promise<{ refs: Set<string>; baseRev: string | null }> {
  if (!rev.based_on) return { refs: new Set(), baseRev: null };
  const { data: b } = await db.from("revisions").select("id,rev,step").eq("id", rev.based_on).maybeSingle();
  if (!b || b.step === "published" || b.step === "repository") return { refs: new Set(), baseRev: null };
  const { data: ch } = await db.from("revision_sections").select("ref").eq("revision_id", b.id).eq("changed", true);
  return { refs: new Set(((ch ?? []) as { ref: string }[]).map((x) => x.ref)), baseRev: b.rev as string };
}

