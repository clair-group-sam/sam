import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { centrikDate } from "@/lib/centrik";

export const maxDuration = 120;
/**
 * SAF-07 · FlightLogger → S.A.M. (Astonfly). The staff keep reporting in FlightLogger; the safety desk retrieves the reports here
 * (collector scripts/flightlogger-reports-export.js, run in the FlightLogger SMS page, then pasted in Safety › Reports).
 * A report not yet in S.A.M. is created as received (72 h clock from its date in FlightLogger, SM Inbox item) and treated in S.A.M.;
 * a report already in S.A.M. only gets its FlightLogger status refreshed — the treatment done in S.A.M. is never overwritten.
 * GET: last sync. POST {reports:[…], dry?:true}.
 */
type Fl = { flId: string; no: string; kind?: string; type?: string; date?: string; aircraft?: string; headline: string; risk?: string; status?: string; narrative?: string; reporter?: string };
const ENTITY = "ASFFR";

async function desk() {
  const s = await getSession();
  if (!s || !isSafetyDesk(s) || !s.entities.includes(ENTITY)) return null;
  return s;
}

export async function GET() {
  if (!(await desk())) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  const { data } = await supabaseAdmin().from("reports").select("external_no,synced_at,received_at").eq("source", "flightlogger").eq("entity", ENTITY).order("synced_at", { ascending: false, nullsFirst: false }).limit(1);
  const { count } = await supabaseAdmin().from("reports").select("id", { count: "exact", head: true }).eq("source", "flightlogger").eq("entity", ENTITY);
  return NextResponse.json({ last: data?.[0] ?? null, count });
}

export async function POST(req: NextRequest) {
  const s = await desk();
  if (!s) return NextResponse.json({ error: "Safety desk only (Astonfly in your scope)." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { reports?: Fl[]; dry?: boolean } | null;
  if (!body?.reports?.length) return NextResponse.json({ error: "reports[] expected — run the collector in FlightLogger first." }, { status: 400 });
  const db = supabaseAdmin(); const now = new Date().toISOString();
  const ids = body.reports.map((r) => `FL-${String(r.no).trim()}`);
  const { data: ex } = await db.from("reports").select("id,source_status").in("id", ids);
  const have = new Map(((ex ?? []) as { id: string; source_status: string | null }[]).map((r) => [r.id, r.source_status]));
  const created: string[] = []; const changed: string[] = []; const errors: string[] = [];
  for (const r of body.reports) {
    const id = `FL-${String(r.no).trim()}`;
    try {
      if (!/^\d+$/.test(String(r.no).trim()) || !r.headline?.trim()) throw new Error("number or headline missing");
      if (have.has(id)) {
        if ((r.status ?? null) !== have.get(id)) changed.push(id);
        if (!body.dry) await db.from("reports").update({ source_status: r.status ?? null, synced_at: now }).eq("id", id);
        continue;
      }
      created.push(id);
      if (body.dry) continue;
      const received = centrikDate(r.date) ?? now; const evDate = received.slice(0, 10);
      const { error } = await db.from("reports").insert({ id, entity: ENTITY, received_at: received.length > 10 ? received : `${received}T12:00:00Z`, event_date: evDate, aircraft: r.aircraft?.trim() || null,
        headline: r.headline.trim().slice(0, 300), narrative: r.narrative?.trim() || r.headline.trim(), status: "received", anonymous: false, reporter_name: r.reporter?.trim() || null,
        source: "flightlogger", history: false, source_ref: r.flId, external_no: String(r.no).trim(), report_type: r.type ?? null, source_status: r.status ?? null, synced_at: now });
      if (error) throw new Error(error.message);
      await db.from("report_events").insert({ report_id: id, kind: "received", at: received.length > 10 ? received : `${received}T12:00:00Z`, note: `Reported in FlightLogger — ${r.type ?? "report"} ${r.no}; retrieved in S.A.M. on ${now.slice(0, 10)} by ${s.name}` });
      const due = new Date(Date.parse(received.length > 10 ? received : `${received}T12:00:00Z`) + 72 * 3600e3).toISOString().slice(0, 10);
      await db.from("tasks").insert({ entity: ENTITY, kind: "safety_report", title: `Safety report ${id} — ${r.headline.trim().slice(0, 120)}`, detail: "New report from FlightLogger: acknowledge, classify and decide on the MOR within 72 h of receipt.", due, owner_role: "SM", status: "open", link: `/safe/reports/${id}` });
    } catch (e) { errors.push(`${r.no}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return NextResponse.json({ ok: true, dry: !!body.dry, read: body.reports.length, created, status_changed: changed, errors });
}
