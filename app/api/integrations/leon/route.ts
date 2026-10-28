import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { leonConfigured, leonType } from "@/lib/leon";
import { syncLeonHours } from "@/lib/leon-hours";

export const maxDuration = 300;
/** Leon integration — GET ?probe=<GraphQL type>: field names of a type (schema only). Compliance session only. */
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
/** POST {from:"2025-01", to:"2026-10", dry?, overwrite?}: monthly block / flight hours and flights from the journey log → SPI activity (AJD, ASJ). */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== "cmm") return NextResponse.json({ error: "Reserved to Compliance." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { from?: string; to?: string; dry?: boolean; overwrite?: boolean };
  const re = /^\d{4}-\d{2}$/; if (!b.from || !re.test(b.from) || (b.to && !re.test(b.to))) return NextResponse.json({ error: "from / to as YYYY-MM" }, { status: 400 });
  const months: string[] = []; const [y0, m0] = b.from.split("-").map(Number); const to = b.to ?? new Date().toISOString().slice(0, 7);
  for (let y = y0, m = m0; `${y}-${String(m).padStart(2, "0")}` <= to && months.length < 36; m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  try {
    const rows = await syncLeonHours(months, { dry: !!b.dry, overwrite: !!b.overwrite });
    if (!b.dry) revalidatePath("/safe/over", "layout");
    return NextResponse.json({ months: months.length, rows });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
