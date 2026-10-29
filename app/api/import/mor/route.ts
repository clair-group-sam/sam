import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 300;
/**
 * MOR status from ECCAIRS 2 (step 5): POST {entity, dry?, rows:[{e2id, no, date:"14-Oct-2026", headline, status, reg, created:"15-Oct-2026", sent}]}
 * read (read-only) in the organisation's ECCAIRS 2 report list by a Compliance session. Each row is matched to a report of the entity:
 * its source number (FlightLogger / Centrik number = "Report identification - custom") and the date (the report up to 30 days after the occurrence), else the date and
 * the headline. A matched report becomes a mandatory occurrence filed in ECCAIRS (reference, date the report was created in ECCAIRS).
 */
type Row = { e2id: string; no?: string; date: string; headline: string; status?: string; reg?: string; created?: string; sent?: boolean };
const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const iso = (d?: string) => { const m = d?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); return m ? `${m[3]}-${MON[m[2]]}-${m[1].padStart(2, "0")}` : null; };
const days = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 864e5;
const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const sim = (a: string, b: string) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== "cmm") return NextResponse.json({ error: "Reserved to Compliance." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { entity?: string; dry?: boolean; rows?: Row[] } | null;
  if (!b?.entity || !s.entities.includes(b.entity) || !b.rows?.length) return NextResponse.json({ error: "entity and rows[] expected" }, { status: 400 });
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("id,external_no,event_date,received_at,headline,aircraft,mor_ref,mor_filed_at,report_analysis(mor_status)").eq("entity", b.entity).limit(5000);
  type R = { id: string; external_no: string | null; event_date: string | null; received_at: string; headline: string; aircraft: string | null; mor_ref: string | null; mor_filed_at: string | null };
  const reps = ((data ?? []) as unknown as R[]).map((r) => ({ ...r, d: r.event_date ?? r.received_at.slice(0, 10) }));
  const used = new Set<string>(); const matched: { e2id: string; report: string; how: string }[] = []; const unmatched: string[] = [];
  const rows = b.rows.filter((r) => r.sent !== false && iso(r.date));
  // pass 1: number + date, pass 2: date + headline (+ registration)
  const pick = (r: Row, pass: number) => {
    const d = iso(r.date)!; const no = (r.no ?? "").replace(/^0+/, "");
    let best: { r: (typeof reps)[number]; sc: number } | null = null;
    for (const x of reps) {
      if (used.has(x.id)) continue;
      // the date kept in S.A.M. may be the date of the report (after the occurrence): up to 30 days after with the same number, 20 days on the headline
      const lag = (new Date(x.d).getTime() - new Date(d).getTime()) / 864e5; const dd = Math.abs(lag);
      if (pass === 1) { if (no && lag >= -3 && lag <= 30 && (x.external_no ?? "").replace(/^0+/, "") === no) return { r: x, how: "number + date" }; continue; }
      if (lag < -3 || lag > 20) continue;
      const reg = r.reg && x.aircraft && r.reg.replace(/[^A-Z0-9]/gi, "").toUpperCase() === x.aircraft.replace(/[^A-Z0-9]/gi, "").toUpperCase() ? 0.3 : 0;
      const sc = sim(r.headline, x.headline) + reg - dd * 0.02;
      if (sc >= 0.5 && (!best || sc > best.sc)) best = { r: x, sc };
    }
    return best ? { r: best.r, how: "date + headline" } : null;
  };
  const plan: { row: Row; rep: (typeof reps)[number]; how: string }[] = [];
  for (const pass of [1, 2]) for (const r of rows) {
    if (plan.some((p) => p.row.e2id === r.e2id)) continue;
    const m = pick(r, pass); if (m) { used.add(m.r.id); plan.push({ row: r, rep: m.r, how: m.how }); }
  }
  for (const r of rows) if (!plan.some((p) => p.row.e2id === r.e2id)) unmatched.push(`${r.e2id} ${r.no ?? ""} ${r.date} ${r.headline}`);
  for (const p of plan) {
    matched.push({ e2id: p.row.e2id, report: p.rep.id, how: p.how });
    if (b.dry) continue;
    const filed = iso(p.row.created) ?? iso(p.row.date)!;
    await db.from("reports").update({ mor_ref: `ECCAIRS ${p.row.e2id}`, mor_filed_at: p.rep.mor_filed_at ?? `${filed}T12:00:00Z` }).eq("id", p.rep.id);
    await db.from("report_analysis").upsert({ report_id: p.rep.id, mor_status: "mandatory", mor_basis: "Filed in ECCAIRS 2 (checked in the ECCAIRS report list)", confirmed_at: new Date().toISOString(), confirmed_by: s.person?.id ?? null }, { onConflict: "report_id" });
    await db.from("report_events").insert({ report_id: p.rep.id, kind: "mor", actor: s.person?.id ?? null, note: `MOR in ECCAIRS 2: ${p.row.e2id}${p.row.status ? ` (${p.row.status})` : ""} — checked by ${s.name}` });
  }
  const inEccairs = new Set(plan.map((p) => p.rep.id));
  return NextResponse.json({ ok: true, dry: !!b.dry, rows: rows.length, matched: matched.length, unmatched, notInEccairs: reps.filter((r) => !inEccairs.has(r.id) && r.d >= (rows.map((x) => iso(x.date)!).sort()[0] ?? "9999")).map((r) => `${r.id} ${r.d} ${r.headline}`), sample: matched.slice(0, 10) });
}
