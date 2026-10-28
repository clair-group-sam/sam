import type { SupabaseClient } from "@supabase/supabase-js";
import { nextReportId } from "@/lib/safety";

export type NewReport = { entity: string; headline: string; narrative: string; event_date: string; event_time_utc: string; aircraft: string; flight_ref: string; phase: string; location: string; contributing: string; anonymous: boolean; language: string; precisions: Record<string, string> };

/** Stores a safety report exactly as the app does (id YYYY-NNN, received event, SM Inbox item with the 72 h clock). Shared by the app form and the Teams bot. */
export async function createReport(db: SupabaseClient, r: NewReport, reporterId: string | null, opts: { source?: "app" | "teams"; note?: string } = {}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (r.narrative.trim().length < 10 || !r.headline.trim()) return { ok: false, error: "Write what happened and a one-line title." };
  const { data: ids } = await db.from("reports").select("id").like("id", `${new Date().getUTCFullYear()}-%`);
  const complements = Object.fromEntries(Object.entries(r.precisions ?? {}).filter(([, v]) => v && String(v).trim()));
  let id = nextReportId(((ids ?? []) as { id: string }[]).map((x) => x.id));
  for (let tries = 0; tries < 3; tries++) {
    const { error } = await db.from("reports").insert({ id, entity: r.entity, headline: r.headline.trim().slice(0, 200), narrative: r.narrative.trim(), event_date: r.event_date || null, event_time_utc: r.event_time_utc || null,
      aircraft: r.aircraft.trim().toUpperCase() || null, flight_ref: r.flight_ref.trim() || null, phase: r.phase || null, location: r.location.trim() || null, contributing: r.contributing.trim() || null,
      complements, anonymous: r.anonymous, reporter_person: r.anonymous ? null : reporterId, language: r.language || null, status: "received" });
    if (!error) break;
    if (!/duplicate/i.test(error.message) || tries === 2) return { ok: false, error: error.message };
    id = nextReportId([id]);
  }
  const due = new Date(Date.now() + 72 * 3600e3).toISOString().slice(0, 10);
  await db.from("report_events").insert({ report_id: id, kind: "received", to_reporter: true, note: opts.note ?? (r.anonymous ? "Received (anonymous)" : opts.source === "teams" ? "Received (from a Teams conversation)" : "Received") });
  await db.from("tasks").insert({ entity: r.entity, kind: "safety_report", title: `Safety report ${id} — ${r.headline.trim().slice(0, 120)}`, detail: "New report: acknowledge, classify and decide on the MOR within 72 h of receipt.", due, owner_role: "SM", status: "open", link: `/safe/reports/${id}` });
  return { ok: true, id };
}
