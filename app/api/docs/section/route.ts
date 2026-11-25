import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { chapterHtml, type ChapterMeta, type ChapterRow } from "@/lib/chapter-render";
import type { Heading } from "@/lib/docs";

/** DOC-16 · one chapter of a revision, ready to read: what the reader asks for when a chapter is opened, instead of the whole page.
 *  Read with the person's own rights: the database only returns the chapters of the manuals of their entities. */
export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams; const manualId = u.get("manual") ?? "", revId = u.get("rev") ?? "", sec = u.get("sec") ?? "";
  if (!manualId || !revId || !sec) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const sb = await supabaseServer();
  const [{ data: sd }, { data: one }] = await Promise.all([
    sb.from("revision_sections").select("id,ref,deleted_at,uid:body->>uid,headings:body->headings").eq("revision_id", revId).order("ord"),
    sb.from("revision_sections").select("id,ord,ref,title,body,deleted_at").eq("revision_id", revId).eq("ref", sec).is("deleted_at", null).limit(1).maybeSingle(),
  ]);
  const metas = ((sd ?? []) as unknown as { id: string; ref: string; deleted_at: string | null; uid: string | null; headings: Heading[] | null }[]).filter((x) => !x.deleted_at);
  const active = one as (ChapterRow & { deleted_at: string | null }) | null;
  if (!active || !metas.some((x) => x.id === active.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sections: ChapterMeta[] = metas.map((x) => ({ id: x.id, ref: x.ref, uid: x.uid, headings: x.headings ?? [] }));
  const html = await chapterHtml(supabaseAdmin, { manualId, revId, sections, active });
  return NextResponse.json({ ref: active.ref, title: active.title, html, pages: active.body.pages?.length ?? 0, firstPage: active.body.pages?.[0] ?? "", start: active.body.page_start ?? null, cover: /^(cover|couverture|page de garde)$/i.test((active.title ?? "").trim()) }, { headers: { "cache-control": "private, no-store" } });
}
