// SAF-08 client-safe constants.
export const INV_STATUS: Record<string, [string, string]> = {
  open: ["Opened", "amber"], facts: ["Gathering facts", "amber"], analysis: ["Analysis", "blue"], report: ["Report", "blue"], closed: ["Closed", "green"], cancelled: ["Cancelled", ""],
};
export const INV_STEPS = ["open", "facts", "analysis", "report", "closed"] as const;
export const INV_LEVEL: Record<string, [string, number]> = {
  light: ["Light — desk review", 14], standard: ["Standard investigation", 30], full: ["Full investigation (team)", 60],
};
/** Contributing factors grouped as in ICAO Doc 9859 / the MSM investigation chapter. */
export const FACTOR_CAT: Record<string, string> = {
  human: "Human (performance, fatigue, CRM, training)", technical: "Technical (aircraft, equipment)", procedural: "Procedures & documentation",
  organisational: "Organisational (planning, supervision, resources, culture)", environmental: "Environment (weather, airport, ATC, traffic)",
};
export type TeamMember = { name: string; role: string | null; person_id: string | null };
export type TimelineRow = { at: string; text: string };
export type Factor = { cat: string; text: string };
export type Investigation = {
  id: string; entity: string; number: string; report_id: string | null; title: string; level: string; status: string;
  lead_person: string | null; lead_name: string | null; team: TeamMember[]; terms: string | null; due: string | null;
  timeline: TimelineRow[]; facts: string | null; factors: Factor[]; causes: string | null; conclusions: string | null;
  report_text: string | null; report_model: string | null; closed_at: string | null; closed_by: string | null; created_at: string; updated_at: string;
};
export const invLate = (i: Pick<Investigation, "status" | "due">, today = new Date().toISOString().slice(0, 10)) => !["closed", "cancelled"].includes(i.status) && !!i.due && i.due < today;
