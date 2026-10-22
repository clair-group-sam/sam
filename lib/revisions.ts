import { basePost, NP_ROLES, type Session } from "@/lib/session";
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
  { from: "draft", to: "published", label: "Publish (internal document)", by: "owner_or_cmm", note: "Internal document: no authority route; published by its author after the review." },
];
export const EDITING = ["draft", "approved_np"];
export const UNDER_REVIEW = ["approved_compliance", "signed", "with_civil_aviation"];
export function isCmm(s: Session): boolean { return s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"); }
/** Owner = holder (or deputy) of the owner post, or the named person when the owner is a person (owner_role 'PERSON:<id>'). */
export function ownsManual(s: Session, ownerRole: string): boolean {
  if (ownerRole.startsWith("PERSON:")) return s.person?.id === ownerRole.slice(7);
  return s.roles.map(basePost).includes(basePost(ownerRole));
}
/** Posts that may create a manual (the "selected few" are flagged on their person: people.can_create_manuals). */
export function postMayCreate(s: Session): boolean {
  return s.roles.map(basePost).some((x) => ["AM", "CMM", "SM", "SUPERADMIN"].includes(x) || NP_ROLES.includes(x) || x.startsWith("NP"));
}
/**
 * DOC-06: once Compliance has approved, the way forward depends on the authority route it decided:
 * notification / approval → only "Send to the authority"; none → only "Publish"; not decided yet → nothing forward.
 */
export function allowedTransitions(s: Session, step: string, ownerRole: string, needsSignature: boolean, toRepo: boolean, route?: string | null, internal?: boolean): Transition[] {
  const cmm = isCmm(s), owner = ownsManual(s, ownerRole);
  const viaAuthority = route === "notification" || route === "approval";
  return TRANSITIONS.filter((t) => t.from === step)
    // internal documents: draft → published by the author; regulated manuals: never straight from draft
    .filter((t) => (internal ? step !== "draft" || t.to === "published" : !(t.from === "draft" && t.to === "published")))
    .filter((t) => !(t.to === "with_civil_aviation" && !viaAuthority))
    .filter((t) => !((t.from === "approved_compliance" || t.from === "signed") && t.to === "published" && route !== "none"))
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

/** DOC-03 · what the authority sends back after an approval, by entity / authority and kind of manual. */
export type ReturnKind = "none" | "approval_page" | "approval_lep" | "consolidated";
export const RETURN_LABEL: Record<ReturnKind, string> = {
  none: "Nothing expected back",
  approval_page: "Approval page",
  approval_lep: "Approval page + stamped list of effective pages",
  consolidated: "Consolidated manual with the signature page",
};
export function expectedReturn(entity: string, code: string, route: string | null | undefined): ReturnKind {
  if (route !== "approval") return "none";
  if (entity === "AJD") return /CAME|AMP|MOE|CAMO/i.test(code) ? "approval_lep" : "consolidated"; // TM-CAD Airworthiness vs Flight Ops
  return "none"; // DSAC (ASF, ASJ) and OSAC (TEC) send nothing to integrate — an approval letter can still be added
}
