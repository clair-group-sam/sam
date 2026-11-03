import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** The PDF of a bulletin (imported from Web Manuals): signed link, 10 minutes, for the people of the entity. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) return NextResponse.redirect(new URL("/login", _req.url));
  const { id } = await params; const db = supabaseAdmin();
  const { data } = await db.from("safety_promotions").select("entity,pdf_path").eq("id", id).maybeSingle();
  const p = data as { entity: string; pdf_path: string | null } | null;
  if (!p?.pdf_path || !s.entities.includes(p.entity)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: u } = await db.storage.from("promotions").createSignedUrl(p.pdf_path, 600);
  return u?.signedUrl ? NextResponse.redirect(u.signedUrl) : NextResponse.json({ error: "Not found." }, { status: 404 });
}
