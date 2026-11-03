import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { parseWmName } from "@/lib/promotion-wm";

export const maxDuration = 60;
/** SAF-09 · one bulletin PDF from Web Manuals (multipart: file + meta JSON) → a safety promotion of the history (published, nothing sent). Re-import updates. */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !isSafetyDesk(s)) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  const fd = await req.formData();
  const file = fd.get("file"); const meta = JSON.parse(String(fd.get("meta") ?? "{}")) as { wmId?: number; name?: string; file?: string; versions?: number; published?: string | null };
  const entity = String(fd.get("entity") ?? "");
  if (!(file instanceof Blob) || !meta.wmId || !meta.name) return NextResponse.json({ error: "file + meta expected" }, { status: 400 });
  if (!s.entities.includes(entity)) return NextResponse.json({ error: "entity out of scope" }, { status: 403 });
  const p = parseWmName(meta.name, meta.file ?? "");
  const db = supabaseAdmin(); const path = `${entity}/${p.number}.pdf`;
  const { error: up } = await db.storage.from("promotions").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: "application/pdf", upsert: true });
  if (up) return NextResponse.json({ error: up.message }, { status: 500 });
  const row = { entity, kind: "bulletin", number: p.number, title: p.title, audience: "all", ack_required: false, status: "published", published_at: meta.published ?? (p.issued ? `${p.issued}T12:00:00Z` : null), issued_on: p.issued,
    summary: meta.versions && meta.versions > 1 ? `Imported from Web Manuals (version ${meta.versions} of ${meta.versions}).` : "Imported from Web Manuals.", source: "webmanuals", source_ref: String(meta.wmId), pdf_path: path, created_by: s.person?.id ?? null };
  const { data: ex } = await db.from("safety_promotions").select("id").eq("source", "webmanuals").eq("source_ref", String(meta.wmId)).maybeSingle();
  const { error } = ex ? await db.from("safety_promotions").update(row).eq("id", (ex as { id: string }).id) : await db.from("safety_promotions").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, number: p.number, title: p.title, updated: !!ex });
}
