/** Notice to the authority before a planned change of nominated person, as the regulation reads (Easy Access Rules in S.A.M., 19/11/2026):
 *  AMC1 ORO.GEN.130(b) 20 days · AMC1 CAMO.A.130(b) 20 working days · AMC1 ORA.GEN.130(b) 10 days ·
 *  CAO.A.105(a)(2) before the change takes place, no number of days. Unforeseen changes: at the earliest opportunity. */
export type Notice = { days: number; working: boolean; ref: string; text: string };
const AIRWORTHINESS = /^(D?NPCA|CAM|CAMO|ARS)/;
/** 24/11 (Guillaume) · the longest notice applies: every rule that applies to the post, and the notice the authority set itself
 *  for this change when there is one; a working day counts for 7/5 of a day to compare them. */
export function noticeFor(entity: string, post: string, authorityDays?: number | null): Notice | null {
  const all: Notice[] = [];
  if (entity === "ASJMT" && AIRWORTHINESS.test(post.toUpperCase())) all.push({ days: 20, working: true, ref: "AMC1 CAMO.A.130(b)", text: "20 working days" });
  if (entity === "ASJMT" || entity === "ASJFR") all.push({ days: 20, working: false, ref: "AMC1 ORO.GEN.130(b)", text: "20 days" });
  if (entity === "ASFFR") all.push({ days: 10, working: false, ref: "AMC1 ORA.GEN.130(b)", text: "10 days" });
  if (entity === "ASTFR") all.push({ days: 0, working: false, ref: "CAO.A.105(a)(2)", text: "before the change takes place" });
  if (authorityDays && authorityDays > 0) all.push({ days: authorityDays, working: false, ref: "the notice set by the authority", text: `${authorityDays} days` });
  const len = (n: Notice) => (n.working ? n.days * 1.4 : n.days);
  return all.sort((a, b) => len(b) - len(a))[0] ?? null;
}
/** Monday to Friday between two dates (public holidays are not counted out). */
export function workingDays(from: string, to: string): number { let n = 0; const d = new Date(from + "T00:00:00Z"); const end = Date.parse(to + "T00:00:00Z"); const step = d.getTime() <= end ? 1 : -1;
  while (d.getTime() !== end) { if (step > 0) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; d.setUTCDate(d.getUTCDate() + 1); } else { d.setUTCDate(d.getUTCDate() - 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; } } return n; }
/** Days of notice left between a day and the effective date, counted the way the rule counts. */
export const leadOf = (nt: Notice, from: string, effective: string) => (nt.working ? workingDays(from, effective) : Math.round((Date.parse(effective) - Date.parse(from)) / 86_400_000));
