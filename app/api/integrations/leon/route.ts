import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { leonConfigured, leonType } from "@/lib/leon";

/** Leon integration — GET ?probe=<GraphQL type>: field names of a type (schema only, no operational data). Compliance session only. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== "cmm") return NextResponse.json({ error: "Reserved to Compliance." }, { status: 403 });
  if (!leonConfigured()) return NextResponse.json({ configured: false });
  const probe = req.nextUrl.searchParams.get("probe");
  try {
    if (probe) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(probe)) return NextResponse.json({ error: "bad type" }, { status: 400 }); return NextResponse.json({ configured: true, type: await leonType(probe) }); }
    const q = await leonType("Query");
    return NextResponse.json({ configured: true, ok: true, queries: q?.fields.filter((f) => /flight|journey|aircraft|acft|log/i.test(f)) });
  } catch (e) { return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 }); }
}
