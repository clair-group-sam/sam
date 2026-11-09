// ERP shared helpers (10/11/2026): primary information sheet, scenarios, posts of a response unit, milestone clocks.

/** Fields of the primary information sheet (ERP-AJD-01 / ENR-CM-15 §2), captured when the alert is raised. [key, label, placeholder] */
export const INFO: [string, string, string?][] = [
  ["caller", "Caller, name"], ["caller_tel", "Caller, phone"], ["caller_org", "Caller, company"],
  ["reg", "Aircraft registration", "9H-AST"], ["flight", "Flight number"], ["from", "Departed from", "LFPB"], ["to", "Destination", "LFMN"],
  ["time_utc", "Time of the event (UTC)", "14:05"], ["location", "Location"], ["crew", "Crew on board", "2"], ["pax", "Passengers on board", "4"],
  ["casualties", "Casualties", "None known"], ["dg", "Dangerous goods on board", "None"],
];

export const SCENARIOS: [string, string][] = [["safety", "Safety: accident, serious incident"], ["overdue", "Aircraft overdue or missing"], ["security", "Security: threat, attack, crew held"], ["cyber", "Cyber-attack, loss of IT systems"], ["other", "Other: premises, health, staff"]];

/** "AM, SM; NPFO" → ["AM","SM","NPFO"] */
export const posts = (v: string | null | undefined) => (v ?? "").split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

/** Does a checklist or milestone written for `applies` run in this scenario? "all" always; "other" runs only "all". */
export const appliesTo = (applies: string | null | undefined, scenario: string) => !applies || applies === "all" || applies === scenario || (scenario === "overdue" && applies === "safety");

/** "45 min", "2 h", "72 h", "at once" */
export function after(min: number): string {
  if (!min) return "at once";
  if (min < 60) return `${min} min`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`;
}
