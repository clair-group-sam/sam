// SAF-07 · FlightLogger SMS reports read by the S.A.M. server with a dedicated FlightLogger account (compliance@clair-group.com).
// FlightLogger has no API for SMS reports (GraphQL API = flights, bookings, training… only): S.A.M. signs in like a browser and
// READS the report list (GET only — the status select and the delete link of the list are never used).
// Vercel: FLIGHTLOGGER_USER, FLIGHTLOGGER_PASSWORD (secret), optional FLIGHTLOGGER_BASE (default https://astonfly.flightlogger.net/a/astonfly).
import type { SupabaseClient } from "@supabase/supabase-js";
import { centrikDate } from "@/lib/centrik";

export type FlReport = { flId: string; no: string; kind?: string; type?: string; date?: string; aircraft?: string; headline: string; risk?: string; status?: string | null; narrative?: string; reporter?: string };
export const FL_ENTITY = "ASFFR";
const BASE = () => (process.env.FLIGHTLOGGER_BASE ?? "https://astonfly.flightlogger.net/a/astonfly").replace(/\/$/, "");
export const flConfigured = () => !!process.env.FLIGHTLOGGER_USER && !!process.env.FLIGHTLOGGER_PASSWORD;

const UA = "Mozilla/5.0 (S.A.M. Clair Group; read-only)";
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

class Jar {
  c = new Map<string, string>();
  take(res: Response) { for (const sc of res.headers.getSetCookie?.() ?? []) { const [kv] = sc.split(";"); const i = kv.indexOf("="); if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
  get header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function signIn(): Promise<Jar> {
  const jar = new Jar(); const base = BASE(); const origin = new URL(base).origin;
  const r1 = await fetch(`${base}/login`, { headers: { "user-agent": UA }, redirect: "manual" }); jar.take(r1);
  const h1 = await r1.text();
  const token = /name="authenticity_token"[^>]*value="([^"]+)"/.exec(h1)?.[1] ?? /name="csrf-token"\s+content="([^"]+)"/.exec(h1)?.[1];
  if (!token) throw new Error("FlightLogger login page not recognised.");
  const body = new URLSearchParams({ authenticity_token: token, "member_session[email]": process.env.FLIGHTLOGGER_USER!, "member_session[password]": process.env.FLIGHTLOGGER_PASSWORD!, commit: "Log in" });
  const r2 = await fetch(`${base}/member_sessions`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header, "user-agent": UA, origin, referer: `${base}/login` }, redirect: "manual" });
  jar.take(r2);
  const loc = r2.headers.get("location") ?? "";
  if (r2.status !== 302 && r2.status !== 303) throw new Error(`FlightLogger sign-in refused (${r2.status}) — check FLIGHTLOGGER_USER / FLIGHTLOGGER_PASSWORD.`);
  if (/login|member_sessions|two_factor|otp/i.test(loc)) throw new Error("FlightLogger sign-in refused — wrong password, or two-factor authentication on the account.");
  return jar;
}

/** Parses the #reportstable rows of the SMS list page. */
export function parseReportList(html: string): { rows: FlReport[]; next: string | null } {
  const start = html.indexOf('id="reportstable"'); if (start < 0) return { rows: [], next: null };
  const end = html.indexOf("</table>", start); const tbl = html.slice(start, end);
  const body = tbl.slice(Math.max(0, tbl.indexOf("<tbody")));
  const rows: FlReport[] = [];
  for (const tr of body.split(/<tr[\s>]/i).slice(1)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]); if (tds.length < 7) continue;
    const [no, flId] = text(tds[1]).split(/\s+/); if (!/^\d+$/.test(no ?? "")) continue;
    const link = /\/sms\/([a-z_]+)\/(\d+)\/edit/.exec(tr);
    const sel = /<option[^>]*selected[^>]*>([^<]+)<\/option>/i.exec(tds[6]);
    rows.push({ no, flId: flId ?? link?.[2] ?? "", kind: link?.[1], aircraft: text(tds[0]) || undefined, type: text(tds[2]), date: text(tds[3]), headline: text(tds[4]), risk: text(tds[5]), status: sel ? sel[1].trim() : null });
  }
  // pagination of the reports table (the headlines table has its own "headlines_page")
  const frame = html.slice(html.indexOf('id="sms_reports_table"') >= 0 ? html.indexOf('id="sms_reports_table"') : start, html.indexOf('id="sms_headlines_table"') > start ? html.indexOf('id="sms_headlines_table"') : undefined);
  const nx = [...frame.matchAll(/<a[^>]*href="([^"#][^"]*)"[^>]*>\s*Next/gi)].map((m) => m[1].replace(/&amp;/g, "&")).find((u) => !/headlines_page/.test(u));
  return { rows, next: nx ?? null };
}

/** Reads every report (open and closed). The narrative is read for the reports S.A.M. still lacks it for (new ones first), when the account may open them. */
export async function fetchFlReports(opts: { needNarrative?: (no: string) => Promise<boolean> | boolean; max?: number } = {}): Promise<FlReport[]> {
  if (!flConfigured()) throw new Error("FlightLogger account not configured (FLIGHTLOGGER_USER / FLIGHTLOGGER_PASSWORD in Vercel).");
  const jar = await signIn(); const base = BASE(); const origin = new URL(base).origin;
  const get = async (u: string) => { const r = await fetch(u.startsWith("http") ? u : `${origin}${u}`, { headers: { cookie: jar.header, "user-agent": UA }, redirect: "manual" }); jar.take(r); return r; };
  const out = new Map<string, FlReport>(); let url: string | null = `${base}/sms/reports?show_closed=1&per_page=100`; const seen = new Set<string>();
  for (let p = 0; url && p < 30 && !seen.has(url); p++) {
    seen.add(url); const r = await get(url);
    if (r.status !== 200) throw new Error(`FlightLogger list not readable (${r.status}) — does the account have access to Safety Management?`);
    const { rows, next } = parseReportList(await r.text()); rows.forEach((x) => out.has(x.no) || out.set(x.no, x)); url = next;
  }
  const list = [...out.values()];
  let n = 0;
  if (opts.needNarrative) for (const x of list) {
    if (!x.kind || !x.flId || n >= (opts.max ?? 30) || !(await opts.needNarrative(x.no))) continue; n++;
    const r = await get(`${base}/sms/${x.kind}/${x.flId}/edit`); if (r.status !== 200) continue;
    const h = await r.text(); const ta = [...h.matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/gi)].map((m) => text(m[1])).filter((t) => t.length > 10);
    if (ta.length) x.narrative = ta.join("\n\n");
  }
  return list;
}

/** New report → created as received (72 h from its FlightLogger date, SM Inbox item); known report → FlightLogger status only. */
export async function upsertFlReports(db: SupabaseClient, reports: FlReport[], opts: { dry?: boolean; by: string; narrativesKnown?: boolean }) {
  const now = new Date().toISOString();
  const ids = reports.map((r) => `FL-${String(r.no).trim()}`);
  const have = new Map<string, { source_status: string | null; narrative: string; headline: string }>();
  for (let k = 0; k < ids.length; k += 200) { const { data } = await db.from("reports").select("id,source_status,narrative,headline").in("id", ids.slice(k, k + 200)); for (const x of (data ?? []) as { id: string; source_status: string | null; narrative: string; headline: string }[]) have.set(x.id, x); }
  const created: string[] = []; const changed: string[] = []; const errors: string[] = [];
  for (const r of reports) {
    const id = `FL-${String(r.no).trim()}`;
    try {
      if (!/^\d+$/.test(String(r.no).trim()) || !r.headline?.trim()) throw new Error("number or headline missing");
      const h = have.get(id);
      if (h) {
        if ((r.status ?? null) !== h.source_status) changed.push(id);
        if (!opts.dry) await db.from("reports").update({ source_status: r.status ?? null, synced_at: now, ...(r.narrative && h.narrative === h.headline ? { narrative: r.narrative } : {}) }).eq("id", id);
        continue;
      }
      created.push(id); if (opts.dry) continue;
      const d = centrikDate(r.date) ?? now; const received = d.length > 10 ? d : `${d}T12:00:00Z`;
      const { error } = await db.from("reports").insert({ id, entity: FL_ENTITY, received_at: received, event_date: received.slice(0, 10), aircraft: r.aircraft?.trim() || null,
        headline: r.headline.trim().slice(0, 300), narrative: r.narrative?.trim() || r.headline.trim(), status: "received", anonymous: false, reporter_name: r.reporter?.trim() || null,
        source: "flightlogger", history: false, source_ref: r.flId, external_no: String(r.no).trim(), report_type: r.type ?? null, source_status: r.status ?? null, synced_at: now });
      if (error) throw new Error(error.message);
      await db.from("report_events").insert({ report_id: id, kind: "received", at: received, note: `Reported in FlightLogger — ${r.type ?? "report"} ${r.no}; retrieved in S.A.M. on ${now.slice(0, 10)} (${opts.by})` });
      const due = new Date(Date.parse(received) + 72 * 3600e3).toISOString().slice(0, 10);
      await db.from("tasks").insert({ entity: FL_ENTITY, kind: "safety_report", title: `Safety report ${id} — ${r.headline.trim().slice(0, 120)}`, detail: "New report from FlightLogger: acknowledge, classify and decide on the MOR within 72 h of receipt.", due, owner_role: "SM", status: "open", link: `/safe/reports/${id}` });
    } catch (e) { errors.push(`${r.no}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { read: reports.length, created, status_changed: changed, errors };
}

/** Report numbers S.A.M. does not have yet, or has without the narrative (only the headline). */
export async function missingNarratives(db: SupabaseClient): Promise<(no: string) => boolean> {
  const { data } = await db.from("reports").select("external_no,narrative,headline").eq("source", "flightlogger").eq("entity", FL_ENTITY).limit(5000);
  const known = new Map(((data ?? []) as { external_no: string | null; narrative: string; headline: string }[]).map((r) => [r.external_no ?? "", r.narrative === r.headline]));
  return (no: string) => !known.has(no) || known.get(no) === true;
}

/** The whole retrieval: sign in, read, create / update. Used by the button and the evening run. */
export async function syncFlightLogger(db: SupabaseClient, by: string) {
  const need = await missingNarratives(db);
  const list = await fetchFlReports({ needNarrative: need, max: 30 });
  return upsertFlReports(db, list, { by });
}
