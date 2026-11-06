import type { NextRequest } from "next/server";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadItems } from "@/lib/regulation-items";
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
