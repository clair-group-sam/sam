import type { NextRequest } from "next/server";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadItems, unzipDocument } from "@/lib/regulation-items";
import type { Regulation } from "@/lib/regulation";

/* REG-03 · POST {key} loads the articles of one EAR from the EASA XML export (Compliance desk). */
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SM", "SUPERADMIN"].includes(r)))) return Response.json({ error: "Compliance desk only" }, { status: 403 });
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const db = supabaseAdmin();
  const { data } = await db.from("regulations").select("*").eq("key", key ?? "").maybeSingle();
  if (!data) return Response.json({ error: "Regulation not found" }, { status: 404 });
  try {
    const t0 = Date.now();
    const r = await loadItems(db, data as Regulation & { items_version: string | null }, s.person?.id ?? null);
    return Response.json({ ...r, ms: Date.now() - t0 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}

/* GET ?key=…  → how the export is built (paragraph styles and heading samples), to adapt the parser to a new layout. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== "cmm") return Response.json({ error: "Compliance desk only" }, { status: 403 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const db = supabaseAdmin();
  const { data } = await db.from("regulations").select("xml_url").eq("key", key).maybeSingle();
  const url = (data as { xml_url: string | null } | null)?.xml_url;
  if (!url) return Response.json({ error: "No XML export" }, { status: 404 });
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; S.A.M.)" }, cache: "no-store" });
  const doc = unzipDocument(Buffer.from(await res.arrayBuffer()));
  const styles: Record<string, number> = {}; const samples: Record<string, string[]> = {};
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g; let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const st = (m[0].match(/w:pStyle w:val="([^"]+)"/) || [])[1] ?? "(none)";
    const t = [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((z) => z[1]).join("").trim();
    if (!t) continue; styles[st] = (styles[st] ?? 0) + 1; if (/^Heading/.test(st) && (samples[st] ??= []).length < 6) samples[st].push(t.slice(0, 90));
  }
  return Response.json({ styles, samples });
}
