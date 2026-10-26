// Risk matrix (ICAO Doc 9859 / SMM): likelihood 5 → 1 × severity A → E. Shared with the browser (no server import).
export const SEVERITIES = [
  { id: "A", label: "Catastrophic", hint: "aircraft destroyed, multiple deaths" },
  { id: "B", label: "Hazardous", hint: "large reduction in safety margins, serious injury, major damage" },
  { id: "C", label: "Major", hint: "significant reduction in safety margins, serious incident, injury" },
  { id: "D", label: "Minor", hint: "nuisance, operating limitations, use of emergency procedures, minor incident" },
  { id: "E", label: "Negligible", hint: "few consequences" },
] as const;
export const LIKELIHOODS = [
  { id: 5, label: "Frequent", hint: "likely to occur many times" },
  { id: 4, label: "Occasional", hint: "likely to occur sometimes" },
  { id: 3, label: "Remote", hint: "unlikely, but possible" },
  { id: 2, label: "Improbable", hint: "very unlikely to occur" },
  { id: 1, label: "Extremely improbable", hint: "almost inconceivable" },
] as const;
const INTOLERABLE = new Set(["5A", "5B", "5C", "4A", "4B", "3A"]);
const TOLERABLE = new Set(["5D", "5E", "4C", "4D", "4E", "3B", "3C", "3D", "2A", "2B", "2C", "1A"]);
export type Tol = "intolerable" | "tolerable" | "acceptable";
export function riskIndex(lik?: number | null, sev?: string | null): string | null { return lik && sev ? `${lik}${sev}` : null; }
export function tolerability(lik?: number | null, sev?: string | null): Tol | null {
  const i = riskIndex(lik, sev); if (!i) return null;
  return INTOLERABLE.has(i) ? "intolerable" : TOLERABLE.has(i) ? "tolerable" : "acceptable";
}
export const TOL_LABEL: Record<Tol, string> = { intolerable: "Intolerable — stop or mitigate", tolerable: "Tolerable — mitigate, SM accepts", acceptable: "Acceptable" };
export const tolTone = (t: Tol | null) => (t === "intolerable" ? "red" : t === "tolerable" ? "amber" : t === "acceptable" ? "green" : "");

export const MOC_CATEGORIES: Record<string, string> = { organisation: "Organisation / structure", np: "Nominated person / key staff", aircraft: "Aircraft / type / fleet", procedure: "Procedure / manual", equipment: "Equipment / EFB / IT", base: "Base / route / aerodrome", subcontractor: "Subcontractor / provider", other: "Other" };
export const MOC_STATUS: Record<string, [string, string]> = { draft: ["Draft", ""], assessment: ["Risk assessment", "amber"], approved: ["Approved by the SM", "blue"], implemented: ["Implemented", "green"], closed: ["Closed", "green"], cancelled: ["Cancelled", ""] };
export const HZ_STATUS: Record<string, [string, string]> = { open: ["Open", "amber"], monitoring: ["Monitoring", "blue"], closed: ["Closed", "green"] };
