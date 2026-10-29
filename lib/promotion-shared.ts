// SAF-09 Safety promotion — client-safe constants.
export const PROMO_KIND: Record<string, { label: string; short: string; hint: string }> = {
  bulletin: { label: "Safety bulletin", short: "SB", hint: "Lessons learned, trends, a reminder — to read" },
  notice: { label: "Safety notice", short: "SN", hint: "Short, urgent, action required — to acknowledge" },
  survey: { label: "Safety survey", short: "SS", hint: "Questionnaire — safety culture, a topic, feedback" },
};
export const AUDIENCE: Record<string, string> = { all: "Everyone in the entity", crew: "Crew & staff (no office post)", office: "Office (posts held)", np: "Nominated persons, SM / CMM, AM" };
export const PROMO_STATUS: Record<string, [string, string]> = { draft: ["Draft", "amber"], published: ["Published", "green"], closed: ["Closed", ""] };
export type Question = { key: string; label: string; type: "scale" | "choice" | "text"; options?: string[] };
export type Promotion = {
  id: string; entity: string; kind: string; number: string; title: string; summary: string | null; body: string | null; audience: string; ack_required: boolean;
  questions: Question[]; anonymous: boolean; status: string; published_at: string | null; due: string | null; closes_at: string | null;
  report_id: string | null; investigation_id: string | null; hazard_id: string | null; draft_model: string | null; created_at: string;
};
export const SCALE = ["1 — strongly disagree", "2", "3", "4", "5 — strongly agree"];
