// SAF-01 · analysis for the Safety Manager (never shown to the reporter). Runs after the report is received.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { ercValue } from "@/lib/safety";

type R = { id: string; entity: string; event_date: string | null; event_time_utc: string | null; aircraft: string | null; flight_ref: string | null; phase: string | null; location: string | null; headline: string; narrative: string; complements: Record<string, string>; contributing: string | null; language: string | null };

export async function runAnalysis(reportId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("id,entity,event_date,event_time_utc,aircraft,flight_ref,phase,location,headline,narrative,complements,contributing,language").eq("id", reportId).maybeSingle();
  const r = data as R | null; if (!r) return;
  const system = `You assist the Safety Manager of an EASA operator (entity ${r.entity}: AOC / CAMO / ATO / CAO) with a safety report received from staff. Work only from the report; never invent facts.
Return ONLY JSON:
{"headline_en":"short English headline","narrative_en":"faithful English translation of the narrative and precisions (copy as is if already English)","summary":"2 sentences for the SM",
"adrep":["CICTT occurrence categories, e.g. SCF-NP, LOC-I, ATM, RAMP, TURB, CFIT, RE, ARC, F-NI, MAC, BIRD, WSTRW, OTHR"],"primary_hazard":"one line",
"erc_outcome":"catastrophic|major|minor|none (most credible accident outcome if it had escalated)","erc_barriers":"effective|limited|minimal|not_effective (barriers that remained)",
"mor_status":"mandatory|likely|voluntary","mor_basis":"Regulation (EU) 2015/1018 annex item and why, or why not reportable",
"questions":["up to 4 factual questions the SM could ask the reporter — never about blame"],"suggested_actions":["up to 4 concrete actions"],
"mor_draft":"de-identified MOR draft in English (no names, no crew identities): what, when (UTC), where, aircraft type, phase, consequences, immediate actions"}`;
  const user = JSON.stringify({ event_date: r.event_date, time_utc: r.event_time_utc, aircraft: r.aircraft, flight: r.flight_ref, phase: r.phase, location: r.location, headline: r.headline, narrative: r.narrative, precisions: r.complements, contributing_factors_in_reporters_view: r.contributing, language: r.language });
  try {
    const { text, model } = await callClaude({ agent: "safety", personId: null, entity: r.entity, system, user, maxTokens: 3000 });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error("no analysis returned");
    const a = JSON.parse(m[0]) as Record<string, unknown>;
    const arr = (x: unknown) => (Array.isArray(x) ? x.map(String).slice(0, 8) : []);
    const outcome = String(a.erc_outcome ?? ""), barriers = String(a.erc_barriers ?? "");
    await db.from("report_analysis").upsert({ report_id: r.id, adrep: arr(a.adrep), primary_hazard: String(a.primary_hazard ?? "") || null, erc_outcome: outcome || null, erc_barriers: barriers || null, erc_value: ercValue(outcome, barriers),
      mor_status: ["mandatory", "likely", "voluntary"].includes(String(a.mor_status)) ? String(a.mor_status) : null, mor_basis: String(a.mor_basis ?? "") || null, mor_draft: String(a.mor_draft ?? "") || null,
      questions: arr(a.questions), suggested_actions: arr(a.suggested_actions), summary: String(a.summary ?? "") || null, ran_at: new Date().toISOString(), model, error: null }, { onConflict: "report_id" });
    await db.from("reports").update({ narrative_en: String(a.narrative_en ?? "") || null, headline_en: String(a.headline_en ?? "") || null }).eq("id", r.id);
    await db.from("report_events").insert({ report_id: r.id, kind: "analysis", note: "Analysis prepared for the Safety Manager" });
    // which hazard of the log this occurrence is about (MSM §3.5.1: each new occurrence reassesses its hazard) — suggestion only
    try { const { matchReport } = await import("@/lib/risk-match"); await matchReport({ id: r.id, entity: r.entity, headline: String(a.headline_en ?? "") || r.headline, narrative: String(a.narrative_en ?? "") || r.narrative, primary_hazard: String(a.primary_hazard ?? "") || null }, null); } catch { /* the log may be empty */ }
  } catch (e) {
    await db.from("report_analysis").upsert({ report_id: r.id, ran_at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) }, { onConflict: "report_id" });
  }
}
