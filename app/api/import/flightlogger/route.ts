import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { FL_ENTITY, flConfigured, syncFlightLogger, upsertFlReports, type FlReport } from "@/lib/flightlogger-sms";

export const maxDuration = 60;
/**
 * SAF-07 · FlightLogger → S.A.M. (Astonfly). GET: last read + whether the S.A.M. FlightLogger account is set.
 * POST {}: S.A.M. signs in to FlightLogger with its own account and reads the reports (the "Retrieve from FlightLogger" button).
 * POST {reports:[…]}: fallback — what the collector script copied in FlightLogger. {dry:true} = check only.
 */
async function desk() {
  const s = await getSession();
  if (!s || !isSafetyDesk(s) || !s.entities.includes(FL_ENTITY)) return null;
  return s;
}

export async function GET() {
  if (!(await desk())) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("synced_at").eq("source", "flightlogger").eq("entity", FL_ENTITY).not("synced_at", "is", null).order("synced_at", { ascending: false }).limit(1);
  const { count } = await db.from("reports").select("id", { count: "exact", head: true }).eq("source", "flightlogger").eq("entity", FL_ENTITY);
  return NextResponse.json({ configured: flConfigured(), last: (data?.[0] as { synced_at: string } | undefined)?.synced_at ?? null, count });
}

export async function POST(req: NextRequest) {
  const s = await desk();
  if (!s) return NextResponse.json({ error: "Safety desk only (Astonfly in your scope)." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { reports?: FlReport[]; dry?: boolean };
  try {
    const res = body.reports?.length ? await upsertFlReports(supabaseAdmin(), body.reports, { dry: !!body.dry, by: s.name }) : await syncFlightLogger(supabaseAdmin(), s.name);
    return NextResponse.json({ ok: true, dry: !!body.dry, ...res });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
