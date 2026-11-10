/* 10/11 · Authority audits as the authority shares them (Monday « Compliance Software », Guillaume): the report received, each finding with
 * its METEOR / TM-CAD reference, its deadline (+ extension), the authority's decisions on the root cause, the plan and the proof. */
export const DECISION_LABEL: Record<string, string> = { awaiting: "Awaiting", yes: "Accepted", no: "Refused", na: "Not required" };
export const DECISION_TONE: Record<string, string> = { awaiting: "amber", yes: "green", no: "red", na: "" };
export const EXT_LABEL: Record<string, string> = { "1m": "Extension 1 month", "3m": "Extension 3 months", reworked: "Finding reworked" };
export type AuthFinding = { id: string; number: string; title: string; status: string; level: string; due: string | null; owner_role: string | null; owner_person: string | null; requirement: string | null;
  authority_ref: string | null; authority_rca: string | null; authority_pac: string | null; authority_proof: string | null; proof: string | null; extension: string | null; extension_reason: string | null; finding_file: string | null; closed_at: string | null; notified: string | null };
/** Deadline with the extension granted (1 month = +30 d, 3 months = +90 d, as in Monday's « Échéance effective »). */
export function effectiveDue(f: Pick<AuthFinding, "due" | "extension">): string | null {
  if (!f.due) return null; const add = f.extension === "1m" ? 30 : f.extension === "3m" ? 90 : 0; if (!add) return f.due;
  const d = new Date(f.due + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + add); return d.toISOString().slice(0, 10);
}
/** Where the finding stands with the authority — the next thing the authority has to say. */
export function authorityStep(f: { status: string; authority_rca?: string | null; authority_pac?: string | null; authority_proof?: string | null }): { label: string; tone: string } {
  if (f.status === "closed") return { label: "Closed", tone: "green" };
  if (f.status === "cancelled") return { label: "Cancelled", tone: "" };
  if (!f.authority_rca && !f.authority_pac) return { label: "Answer to send", tone: "amber" };
  if (f.authority_rca === "no" || f.authority_pac === "no") return { label: "Refused by the authority, to rework", tone: "red" };
  if (f.authority_rca === "awaiting" || f.authority_pac === "awaiting") return { label: "Sent, awaiting acceptance", tone: "" };
  if (f.authority_proof === "awaiting" || !f.authority_proof) return { label: "Accepted, proof to send", tone: "amber" };
  if (f.authority_proof === "no") return { label: "Proof refused", tone: "red" };
  return { label: "Proof accepted, to close", tone: "green" };
}
