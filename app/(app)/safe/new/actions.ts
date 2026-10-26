"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { DEFAULT_PRECISIONS, nextReportId, type Precision } from "@/lib/safety";
import { runAnalysis } from "@/lib/safety-analysis";

/** Step 1 · SAM reads the narrative and proposes 3 to 5 FACTUAL precisions, in the reporter's language. No chat, nothing stored. */
export async function proposePrecisions(input: { narrative: string; known: Record<string, string> }): Promise<{ lang: string; items: Precision[] }> {
  const s = await getSession();
  if (!s) throw new Error("Not signed in.");
  if (input.narrative.trim().length < 20) return { lang: "en", items: DEFAULT_PRECISIONS };
  try {
    const { text } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity: null, maxTokens: 1200,
      system: `A crew or staff member of an aviation operator wrote a safety report. Propose 3 to 5 FACTUAL precisions that would help the Safety Manager, chosen from what the narrative does NOT already say (and not already given in "known"): time UTC, phase of flight, what alerted them, TCAS RA/TA, ATC informed, consequences (damage, injury, go-around, delay), weather, technical log entry, witnesses, location on the aerodrome. NEVER ask about causes, blame or human factors. Write the labels in the language of the narrative. Short answers: prefer "choice" with 2–6 options. Answer ONLY JSON: {"lang":"fr|en|…","items":[{"key":"snake_case","label":"…","type":"choice|text|time","options":["…"]}]}`,
      user: JSON.stringify({ narrative: input.narrative.slice(0, 6000), known: input.known }) });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error("none");
    const j = JSON.parse(m[0]) as { lang?: string; items?: Precision[] };
    const items = (j.items ?? []).filter((x) => x?.key && x?.label).slice(0, 5).map((x) => ({ key: String(x.key).slice(0, 40), label: String(x.label).slice(0, 160), type: (["choice", "text", "time"].includes(x.type) ? x.type : "text") as Precision["type"], options: Array.isArray(x.options) ? x.options.map(String).slice(0, 8) : undefined }));
    return { lang: j.lang ?? "en", items: items.length ? items : DEFAULT_PRECISIONS };
  } catch { return { lang: "en", items: DEFAULT_PRECISIONS }; }
}

export type NewReport = { entity: string; headline: string; narrative: string; event_date: string; event_time_utc: string; aircraft: string; flight_ref: string; phase: string; location: string; contributing: string; anonymous: boolean; language: string; precisions: Record<string, string> };

/** Step 2 · the report as validated by the reporter is stored; SM / FSO get an Inbox item; the analysis runs afterwards. */
export async function submitReport(r: NewReport): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.person) return { ok: false, error: "Your account is not attached to a person in S.A.M. yet." };
  if (!s.entities.includes(r.entity)) return { ok: false, error: "Entity outside your scope." };
  if (r.narrative.trim().length < 10 || !r.headline.trim()) return { ok: false, error: "Write what happened and a one-line title." };
  const db = supabaseAdmin();
  const { data: ids } = await db.from("reports").select("id").like("id", `${new Date().getUTCFullYear()}-%`);
  const complements = Object.fromEntries(Object.entries(r.precisions).filter(([, v]) => v && v.trim()));
  let id = nextReportId(((ids ?? []) as { id: string }[]).map((x) => x.id));
  for (let tries = 0; tries < 3; tries++) {
    const { error } = await db.from("reports").insert({ id, entity: r.entity, headline: r.headline.trim().slice(0, 200), narrative: r.narrative.trim(), event_date: r.event_date || null, event_time_utc: r.event_time_utc || null,
      aircraft: r.aircraft.trim().toUpperCase() || null, flight_ref: r.flight_ref.trim() || null, phase: r.phase || null, location: r.location.trim() || null, contributing: r.contributing.trim() || null,
      complements, anonymous: r.anonymous, reporter_person: r.anonymous ? null : s.person.id, language: r.language || null, status: "received" });
    if (!error) break;
    if (!/duplicate/i.test(error.message) || tries === 2) return { ok: false, error: error.message };
    id = nextReportId([id]);
  }
  const due = new Date(Date.now() + 72 * 3600e3).toISOString().slice(0, 10);
  await db.from("report_events").insert({ report_id: id, kind: "received", to_reporter: true, note: r.anonymous ? "Received (anonymous)" : "Received" });
  for (const role of ["SM"]) {
    await db.from("tasks").insert({ entity: r.entity, kind: "safety_report", title: `Safety report ${id} — ${r.headline.trim().slice(0, 120)}`, detail: "New report: acknowledge, classify and decide on the MOR within 72 h of receipt.", due, owner_role: role, status: "open", link: `/safe/reports/${id}` });
  }
  after(() => runAnalysis(id));
  revalidatePath("/safe/mine"); revalidatePath("/safe/reports");
  return { ok: true, id };
}
