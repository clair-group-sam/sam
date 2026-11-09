// Part-IS shared rules (10/11/2026): which IS risks belong to a system, the attention level they give it, and what the
// linked contract of the Subcontractors register says. Used by the map, the overview, the annexes and the daily sweep.
export type IsRiskLite = { id: string; entity: string; system_id: string | null; system: string | null; threat: string; likelihood: number | null; severity: number | null; status: string };
export type SubLite = { id: string; name: string; contract_ref: string | null; contract_until: string | null; is_clause: boolean | null; access_clause: boolean | null };

export const riskScore = (r: Pick<IsRiskLite, "likelihood" | "severity">) => (r.likelihood ?? 0) * (r.severity ?? 0);
const first = (n: string) => n.toLowerCase().split(/[ (/]/)[0];

/** The IS risks of a system: linked by system_id, or (older rows without link) named after it in the same entity. */
export function risksOf(sys: { id: string; entity: string; name: string }, risks: IsRiskLite[]): IsRiskLite[] {
  const f = first(sys.name);
  return risks.filter((r) => r.system_id === sys.id || (!r.system_id && r.entity === sys.entity && f.length >= 4 && (r.system ?? "").toLowerCase().includes(f)));
}
/** Attention level from the assessment: the highest score among the risks still live (open, accepted, treated). Null when none is scored. */
export function attentionFrom(rs: IsRiskLite[]): "critical" | "serious" | "warning" | null {
  const live = rs.filter((r) => r.status !== "closed").map(riskScore).filter((n) => n > 0);
  if (!live.length) return null;
  const m = Math.max(...live);
  return m >= 15 ? "critical" : m >= 8 ? "serious" : "warning";
}
/** What the linked contract says: ok only when a contract reference is recorded AND its Part-IS clauses are confirmed. */
export function contractFrom(sub: SubLite | undefined, today = new Date().toISOString().slice(0, 10)): { state: "ok" | "tbc"; txt: string } | null {
  if (!sub) return null;
  const expired = !!sub.contract_until && sub.contract_until < today;
  const ok = !!sub.contract_ref && sub.is_clause === true && !expired;
  const txt = `${sub.name}${sub.contract_ref ? `, ${sub.contract_ref}` : ", no contract reference"}${sub.contract_until ? `, until ${sub.contract_until.split("-").reverse().join("/")}${expired ? " (expired)" : ""}` : ""}. Part-IS clauses: ${sub.is_clause === true ? "yes" : sub.is_clause === false ? "no" : "not recorded"}.`;
  return { state: ok ? "ok" : "tbc", txt };
}
