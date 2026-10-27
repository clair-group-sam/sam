// Safety › Risk register (server side): who may do what, references, MSM conformity of an assessment.
import type { SupabaseClient } from "@supabase/supabase-js";
import { basePost, type Session } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
import { MSM_REF, schemeOf, tolerability, type Scheme } from "@/lib/risk-shared";
export * from "@/lib/risk-shared";

/** Hazards and assessments are written by the safety desk, the nominated persons and the AM. */
export const mayEditRisk = (s: Session) => isSafetyDesk(s) || s.role === "np" || s.role === "am";
/** Validation (electronic sign-off) by the most relevant nominated person, his/her deputy, or the SM (AJD/ASJ MSM §3.4, §3.5.3). */
export const mayValidate = (s: Session) => isSafetyDesk(s) || s.role === "np";
/** The Accountable Manager keeps the final say (AJD MSM §3.5.3, ASF MSM §3.4): he does not sign every assessment, but decides on a red residual risk
 *  (forced approval or stop) and may overrule any scoring / sign-off by opening a new version. Green / yellow are accepted by the NP / SM sign-off. */
export const mayAccept = (s: Session) => s.roles.map(basePost).some((p) => p === "AM" || p === "SUPERADMIN");
export const mayApproveMoc = mayValidate;
export const postOf = (s: Session) => s.roles.map(basePost).find((p) => p !== "SUPERADMIN") ?? s.roles[0] ?? "";

export async function nextHazardRef(db: SupabaseClient, entity: string): Promise<string> {
  const { data } = await db.from("hazards").select("ref").like("ref", `HZ-${entity}-%`);
  const n = ((data ?? []) as { ref: string }[]).map((r) => Number(r.ref.split("-").pop())).filter(Number.isFinite);
  return `HZ-${entity}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, "0")}`;
}
/** Next assessment number in the entity: "HZ OPS-24" style for the hazard log (by domain), "MOC 45", "RA 18". */
export async function nextAssessmentNumber(db: SupabaseClient, entity: string, kind: string, domain?: string | null): Promise<string> {
  const { data } = await db.from("risk_assessments").select("number").eq("entity", entity).eq("kind", kind);
  const nums = ((data ?? []) as { number: string }[]).map((r) => r.number);
  if (kind === "hazard_log") {
    const code = (domain ?? "GEN").replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "GEN";
    const n = nums.filter((x) => x.startsWith(`HZ ${code}-`)).map((x) => Number(x.split("-").pop())).filter(Number.isFinite);
    return `HZ ${code}-${(n.length ? Math.max(...n) : 0) + 1}`;
  }
  const p = kind === "moc" ? "MOC" : "RA";
  const n = nums.filter((x) => x.startsWith(p + " ")).map((x) => Number(x.split(/[\s-]/).pop())).filter(Number.isFinite);
  return `${p} ${(n.length ? Math.max(...n) : 0) + 1}`;
}
export const addMonths = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export type Ra = { id: string; entity: string; kind: string; number: string; name: string; description: string | null; domain: string | null; status: string; decision: string | null; decision_comment: string | null; top_risk: boolean; version: number; conducted_on: string | null; next_due: string | null; participants: { name: string; role: string }[]; owner_role: string | null; validated_name: string | null; validated_role: string | null; validated_at: string | null; accepted_name: string | null; accepted_at: string | null; moc_status: string | null; category: string | null; change_type: string | null; start_date: string | null; end_date: string | null; reason: string | null; requestor: string | null; affected: string | null; criticality: string | null; prior_assessments: string | null; actions_in_place: string | null; authority_route: string | null; project_id: string | null; project_task_id: string | null; authority_file_id: string | null; source: string; source_ref: string | null };
export type Hz = { id: string; ref: string; title: string; description: string | null; consequence: string | null; main_impact: string | null; proposed: boolean; status: string; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; needs_review: boolean; owner_role: string | null; log_hazard_id?: string | null; local_only?: boolean; hazard_mitigations?: { text: string; existing: boolean; owner_role: string | null; due: string | null; done_at: string | null }[] };
export type Check = { label: string; ok: boolean; ref: string; detail?: string };

/** What the entity's MSM requires of a risk assessment, checked one by one. */
export function msmChecks(ra: Ra, hazards: Hz[]): Check[] {
  const scheme: Scheme = schemeOf(ra.entity);
  const ref = MSM_REF[ra.entity] ?? "MSM §3";
  const kept = hazards.filter((h) => !h.proposed && h.status !== "closed");
  const today = new Date().toISOString().slice(0, 10);
  const c: Check[] = [];
  c.push({ label: "Hazards identified with their consequence (hazard–consequence method)", ok: kept.length > 0 && kept.every((h) => !!h.consequence), ref: `${ref}.2.2`, detail: kept.length ? `${kept.filter((h) => !h.consequence).length} without consequence` : "no hazard" });
  c.push({ label: "Every hazard rated before and after mitigation", ok: kept.length > 0 && kept.every((h) => h.lik_before && h.sev_before && h.lik_after && h.sev_after), ref: `${ref}.5.1 / 3.5.3` });
  c.push({ label: "No residual risk left intolerable (activity cannot continue as it is)", ok: !kept.some((h) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, scheme) === "intolerable"), ref: `${ref}.5.3` });
  c.push({ label: "Mitigations to put in place assigned to a post", ok: kept.every((h) => (h.hazard_mitigations ?? []).filter((m) => !m.existing && !m.done_at).every((m) => !!m.owner_role)), ref: ra.kind === "moc" ? `${ref}.4 step 8` : `${ref}.5.2` });
  if (scheme === "centrik" || ra.kind === "moc") c.push({ label: "Participants formally identified (names and roles)", ok: (ra.participants ?? []).length > 0, ref: ra.kind === "moc" ? `${ref}.4` : `${ref}.5.1` });
  c.push({ label: "Validated by the most relevant nominated person (or deputy / SM)", ok: !!ra.validated_at, ref: `${ref}.5.3`, detail: ra.validated_at ? `${ra.validated_name ?? ""} (${ra.validated_role ?? ""})` : undefined });
  c.push({ label: "Residual risk accepted (by the sign-off; by the AM when it stays red)", ok: ra.status === "accepted", ref: scheme === "centrik" ? `${ref}.5.3` : `${ref}.4`, detail: ra.accepted_at ? `AM — ${ra.accepted_name ?? ""}` : ra.status === "accepted" ? ra.validated_name ?? "" : ra.status === "validated" ? "red residual risk — waiting for the AM" : undefined });
  if (ra.kind === "moc") {
    c.push({ label: "Change described: what, why, who asks, what is affected, criticality and human performance impact, prior assessments, actions", ok: !!(ra.description && ra.reason && ra.affected && ra.criticality), ref: `${ref}.4 steps 1–6` });
    c.push({ label: "MOC completed before the change is implemented", ok: !(ra.moc_status === "implemented" || ra.moc_status === "closed") || ra.status === "accepted", ref: `${ref}.4` });
  } else {
    c.push({ label: "Review date not passed (hazard log kept current, reviewed at the SRB)", ok: !ra.next_due || ra.next_due >= today, ref: `${ref}.2.2 / 3.7`, detail: ra.next_due ? `next due ${ra.next_due}` : "no review date" });
  }
  if (ra.kind !== "hazard_log" && kept.every((h) => h.log_hazard_id !== undefined)) c.push({ label: "Hazard log kept current: each hazard linked to the log or kept local (temporary)", ok: kept.every((h) => h.log_hazard_id || h.local_only), ref: `${ref}.2.2`, detail: kept.filter((h) => !h.log_hazard_id && !h.local_only).map((h) => h.ref).join(", ") || undefined });
  c.push({ label: "Reassessed after each new occurrence linked to it", ok: !kept.some((h) => h.needs_review), ref: `${ref}.5.1`, detail: kept.filter((h) => h.needs_review).map((h) => h.ref).join(", ") || undefined });
  return c;
}
