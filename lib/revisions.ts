import type { Session } from "@/lib/session";
import { STEPS } from "@/lib/docs";

/** Who may move a revision from one step to the next (DOC-09, DOC-06). */
export type Transition = { from: string; to: string; label: string; by: "owner" | "cmm" | "owner_or_cmm"; note?: string };
export const TRANSITIONS: Transition[] = [
  { from: "draft", to: "approved_np", label: "Approve content (NP)", by: "owner_or_cmm", note: "The nominated person validates the content and hands over to Compliance." },
  { from: "approved_np", to: "draft", label: "Send back to draft", by: "cmm", note: "Compliance remarks: the author resumes the draft; the round stays in the history." },
  { from: "approved_np", to: "approved_compliance", label: "Approve (Compliance)", by: "cmm", note: "Checked against the requirements register." },
  { from: "approved_compliance", to: "signed", label: "Mark as signed", by: "cmm", note: "Only for manuals that need signatures (NP + CMM; MSM: AM + CMM)." },
  { from: "approved_compliance", to: "with_civil_aviation", label: "Send to the civil aviation authority", by: "cmm", note: "One application for the whole exchange; corrected manual goes back as a comment." },
  { from: "signed", to: "with_civil_aviation", label: "Send to the civil aviation authority", by: "cmm" },
  { from: "approved_compliance", to: "published", label: "Publish (no authority route)", by: "cmm", note: "Manuals that need neither notification nor approval." },
  { from: "signed", to: "published", label: "Publish (no authority route)", by: "cmm" },
  { from: "with_civil_aviation", to: "published", label: "Publish", by: "cmm", note: "After the authority's return has been integrated." },
  { from: "with_civil_aviation", to: "draft", label: "Authority remarks → back to draft", by: "cmm" },
  { from: "published", to: "repository", label: "Deposited on the TM-CAD repository", by: "cmm" },
];
export const EDITING = ["draft", "approved_np"];
export const UNDER_REVIEW = ["approved_compliance", "signed", "with_civil_aviation"];
export function isCmm(s: Session): boolean { return s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"); }
export function ownsManual(s: Session, ownerRole: string): boolean { return s.roles.map((r) => r.toUpperCase()).includes(ownerRole.toUpperCase()); }
export function allowedTransitions(s: Session, step: string, ownerRole: string, needsSignature: boolean, toRepo: boolean): Transition[] {
  const cmm = isCmm(s), owner = ownsManual(s, ownerRole);
  return TRANSITIONS.filter((t) => t.from === step)
    .filter((t) => (t.by === "cmm" ? cmm : t.by === "owner" ? owner : owner || cmm))
    .filter((t) => !(t.to === "signed" && !needsSignature))
    .filter((t) => !(t.to === "repository" && !toRepo))
    .filter((t) => !(t.from === "approved_compliance" && t.to === "with_civil_aviation" && needsSignature));
}
export function nextRev(current: string | null | undefined): string {
  const n = parseInt(current ?? "0", 10);
  const next = Number.isFinite(n) ? n + 1 : 1;
  return String(next).padStart((current ?? "00").length || 2, "0");
}
export function stepIndex(step: string): number { return STEPS.indexOf(step); }
