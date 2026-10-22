import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { isCmm } from "@/lib/revisions";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * One-off repair for manuals imported before page ids were kept: Compliance sends the Web Manuals page list
 * ([id, number] pairs, read-only extract) and every chapter of the imported revisions gets the ids of its pages,
 * so cross-references open the right chapter. POST { wmId, pages: [[id, number], …] }.
 */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !isCmm(s)) return NextResponse.json({ error: "Compliance only" }, { status: 403 });
  const { wmId, pages } = (await req.json()) as { wmId: number | string; pages: [number | string, string][] };
  const byNumber = new Map<string, string>();
  for (const [id, num] of pages ?? []) if (!byNumber.has(num || "cover")) byNumber.set(num || "cover", String(id));
  const db = supabaseAdmin();
  const { data: revs } = await db.from("revisions").select("id,source").eq("source->>manualId", String(wmId));
  let updated = 0;
  for (const r of (revs ?? []) as { id: string }[]) {
    const { data: secs } = await db.from("revision_sections").select("id,body").eq("revision_id", r.id);
    for (const x of (secs ?? []) as { id: string; body: { pages?: string[] } & Record<string, unknown> }[]) {
      const ids = (x.body.pages ?? []).map((n) => byNumber.get(n) ?? "");
      if (!ids.some(Boolean)) continue;
      await db.from("revision_sections").update({ body: { ...x.body, page_ids: ids } }).eq("id", x.id);
      updated++;
    }
  }
  return NextResponse.json({ revisions: revs?.length ?? 0, chapters: updated });
}
