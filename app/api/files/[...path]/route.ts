import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
/** Private files: /api/files/<bucket>/<entity>/... → scope check → short signed URL. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const s = await getSession();
  if (!s) return new Response("unauthorized", { status: 401 });
  const [bucket, entity, ...rest] = path;
  if (!["manuals", "certificates", "evidence"].includes(bucket) || !entity || !rest.length) return new Response("not found", { status: 404 });
  if (!s.group && !s.entities.includes(entity)) return new Response("forbidden", { status: 403 });
  const key = [entity, ...rest].join("/");
  const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(key, 120);
  if (error || !data) return new Response("not found", { status: 404 });
  void req;
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "cache-control": "private, max-age=60" } });
}
