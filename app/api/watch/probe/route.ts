import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { readSource } from "@/lib/watch-read";

export const maxDuration = 60;
/** REG-06 · Compliance: can S.A.M. read these pages? (status, title, number of entries found, first entries) */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !(s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { urls } = (await req.json()) as { urls: string[] };
  const out = await Promise.all((urls ?? []).slice(0, 30).map(async (u) => { const r = await readSource(u); return { url: u, ok: r.ok, status: r.status, final: r.finalUrl, title: r.title, n: r.items.length, first: r.items.slice(0, 4).map((x) => x.title.slice(0, 90)), note: r.note, ms: r.ms }; }));
  return NextResponse.json(out);
}
