// Risk matrices of the group's MSMs (shared with the browser, no server import).
// Likelihood 5 → 1 × severity A → E (ICAO Doc 9859). Two tolerability schemes:
//  · "centrik" — ASJMT MSM §3.5.1 / ASJFR MSM: zone by SCORE (green 1–10 acceptable, yellow 20–100 tolerable, red 300–2500 intolerable),
//    scores of the MSM matrix (ASJMT MSM §3.5.1 p.3-19 and ASJFR MSM, identical to Centrik — checked 27/10/2026; column E = 1 throughout).
//  · "icao" — ASFFR MSM Ed.10 §3.4 matrix (checked 27/10/2026, = ICAO tolerability table), no score; ASTFR until its CAE says otherwise.
export const SEVERITIES = [
  { id: "A", label: "Catastrophic", hint: "multiple deaths, equipment destroyed" },
  { id: "B", label: "Hazardous", hint: "large reduction in safety margins, serious injury, major equipment damage" },
  { id: "C", label: "Major", hint: "significant reduction in safety margins, serious incident, injury to persons" },
  { id: "D", label: "Minor", hint: "nuisance, operating limitations, use of emergency procedures, minor incident" },
  { id: "E", label: "Negligible", hint: "little consequences" },
] as const;
export const LIKELIHOODS = [
  { id: 5, label: "Frequent", hint: "likely to occur many times (has occurred frequently)" },
  { id: 4, label: "Occasional", hint: "likely to occur sometimes (has occurred infrequently)" },
  { id: 3, label: "Remote", hint: "unlikely to occur, but possible (has occurred rarely)" },
  { id: 2, label: "Improbable", hint: "very unlikely to occur (not known to have occurred)" },
  { id: 1, label: "Extremely improbable", hint: "almost inconceivable that the event will occur" },
] as const;

export type Scheme = "centrik" | "icao";
export const schemeOf = (entity?: string | null): Scheme => (entity === "ASJMT" || entity === "ASJFR" ? "centrik" : "icao");
export const MSM_REF: Record<string, string> = { ASJMT: "ASJMT MSM Iss 01 Rev 09 §3", ASJFR: "ASJFR MSM Iss 10 Rev 07 §3", ASFFR: "ASFFR MSM Ed.10 Rev 01 §3", ASTFR: "ASTFR — CAE (risk method to confirm)" };

const SCORE: Record<string, number> = {
  "5A": 2500, "5B": 1000, "5C": 300, "5D": 100, "5E": 1,
  "4A": 1000, "4B": 300, "4C": 100, "4D": 40, "4E": 1,
  "3A": 300, "3B": 100, "3C": 40, "3D": 10, "3E": 1,
  "2A": 100, "2B": 40, "2C": 10, "2D": 4, "2E": 1,
  "1A": 50, "1B": 20, "1C": 5, "1D": 2, "1E": 1,
};
const ICAO_INTOLERABLE = new Set(["5A", "5B", "5C", "4A", "4B", "3A"]);
const ICAO_TOLERABLE = new Set(["5D", "5E", "4C", "4D", "4E", "3B", "3C", "3D", "2A", "2B", "2C", "1A"]);
export type Tol = "intolerable" | "tolerable" | "acceptable";

export function riskIndex(lik?: number | null, sev?: string | null): string | null { return lik && sev ? `${lik}${sev}` : null; }
export function riskScore(lik?: number | null, sev?: string | null): number | null { const i = riskIndex(lik, sev); return i ? SCORE[i] ?? null : null; }
export function tolerability(lik?: number | null, sev?: string | null, scheme: Scheme = "icao"): Tol | null {
  const i = riskIndex(lik, sev); if (!i) return null;
  if (scheme === "centrik") { const s = SCORE[i]; return s >= 300 ? "intolerable" : s >= 20 ? "tolerable" : "acceptable"; }
  return ICAO_INTOLERABLE.has(i) ? "intolerable" : ICAO_TOLERABLE.has(i) ? "tolerable" : "acceptable";
}
/** "3A · 300" (Centrik entities) or "3A" (ICAO entities). */
export function riskLabel(lik?: number | null, sev?: string | null, scheme: Scheme = "icao"): string | null {
  const i = riskIndex(lik, sev); if (!i) return null;
  return scheme === "centrik" ? `${i} · ${SCORE[i]}` : i;
}
export const TOL_LABEL: Record<Tol, string> = { intolerable: "Intolerable — stop or mitigate", tolerable: "Tolerable — mitigate, management decision", acceptable: "Acceptable" };
export const tolTone = (t: Tol | null) => (t === "intolerable" ? "red" : t === "tolerable" ? "amber" : t === "acceptable" ? "green" : "");
export const worstTol = (ts: (Tol | null)[]): Tol | null => (ts.includes("intolerable") ? "intolerable" : ts.includes("tolerable") ? "tolerable" : ts.some(Boolean) ? "acceptable" : null);

export const KINDS: Record<string, string> = { hazard_log: "Hazard log", moc: "Management of change", ra: "Risk assessment" };
export const KIND_PREFIX: Record<string, string> = { hazard_log: "HZ", moc: "MOC", ra: "RA" };
export const DOMAINS = ["Flight Ops", "Ground Ops", "Crew Training", "CAMO", "Maintenance", "ATO", "FSTD", "Information security", "Compliance & Safety", "Organisation"];
export const RA_STATUS: Record<string, [string, string]> = { draft: ["Draft", "amber"], validated: ["Red — AM decision", "red"], accepted: ["Accepted", "green"], archived: ["Archived", ""], cancelled: ["Cancelled", ""] };
export const DECISIONS: Record<string, string> = { continue: "Continue", continue_with_conditions: "Continue with conditions", stop: "Stop / do not implement" };
export const MOC_CATEGORIES: Record<string, string> = { organisation: "Organisation / structure", np: "Nominated person / key staff", aircraft: "Aircraft / type / fleet", procedure: "Procedure / manual", equipment: "Equipment / EFB / IT", base: "Base / route / aerodrome", subcontractor: "Subcontractor / provider", training: "Training programme", other: "Other" };
export const MOC_STATUS: Record<string, [string, string]> = { assessment: ["Risk assessment", "amber"], approved: ["Approved", "blue"], implemented: ["Implemented", "green"], closed: ["Closed", "green"], cancelled: ["Cancelled", ""] };
export const HZ_STATUS: Record<string, [string, string]> = { open: ["Open", "amber"], monitoring: ["Monitoring", "blue"], closed: ["Closed", "green"] };
