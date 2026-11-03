import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { parseWmName } from "@/lib/promotion-wm";

export const maxDuration = 60;
/** SAF-09 · one bulletin PDF from Web Manuals → a safety promotion of the history (published, nothing sent). Re-import updates. */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !isSafetyDesk(s)) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { step?: "sign" | "save"; entity?: string; meta?: { wmId?: number; name?: string; file?: string; versions?: number; published?: string | null } } | null;
  const meta = body?.meta; const entity = String(body?.entity ?? "");
  if (!meta?.wmId || !meta.name) return NextResponse.json({ error: "meta expected" }, { status: 400 });
  if (!s.entities.includes(entity)) return NextResponse.json({ error: "entity out of scope" }, { status: 403 });
  const p = parseWmName(meta.name, meta.file ?? "");
  const db = supabaseAdmin(); const path = `${entity}/${p.number}.pdf`;
  // 1 · the PDF goes straight from the browser to the private storage (no size limit of the app server), through a one-time signed URL
  if (body?.step === "sign") {
    const { data, error } = await db.storage.from("promotions").createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "no upload URL" }, { status: 500 });
    return NextResponse.json({ ok: true, url: data.signedUrl, path });
  }
  // 2 · the bulletin is recorded once its PDF is in the storage
  const { data: listed } = await db.storage.from("promotions").list(entity, { search: `${p.number}.pdf` });
  if (!(listed ?? []).some((f) => f.name === `${p.number}.pdf`)) return NextResponse.json({ error: "PDF not uploaded" }, { status: 400 });
  const row = { entity, kind: "bulletin", number: p.number, title: p.title, audience: "all", ack_required: false, status: "published", published_at: meta.published ?? (p.issued ? `${p.issued}T12:00:00Z` : null), issued_on: p.issued,
    summary: meta.versions && meta.versions > 1 ? `Imported from Web Manuals (version ${meta.versions} of ${meta.versions}).` : "Imported from Web Manuals.", source: "webmanuals", source_ref: String(meta.wmId), pdf_path: path, created_by: s.person?.id ?? null };
  const { data: ex } = await db.from("safety_promotions").select("id").eq("source", "webmanuals").eq("source_ref", String(meta.wmId)).maybeSingle();
  const { error } = ex ? await db.from("safety_promotions").update(row).eq("id", (ex as { id: string }).id) : await db.from("safety_promotions").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, number: p.number, title: p.title, updated: !!ex });
}
