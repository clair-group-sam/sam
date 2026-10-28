// SAF-04 Safety performance indicators — client-safe definitions: what S.A.M. can compute, how months add up, how a value is judged.

export type Basis = "count" | "per_1000_bh" | "per_1000_fh" | "per_100_fh" | "per_1000_flights" | "percent" | "score";
export type SpiDef = { id: string; entity: string; code: string; label: string; objective: string | null; area: string; metric: string | null; basis: Basis; direction: "le" | "ge" | "eq"; period: "month" | "quarter" | "year"; agg: "sum" | "last" | "avg" | null; ref: string | null; owner_role: string | null; sort: number; status: "active" | "proposed" | "retired"; note: string | null };
export type Target = { target: number | null; alert: number | null; note: string | null };

/** Computed by S.A.M. from its own records. kind: count = events in the month · ratio = num / den (percent) · snapshot = state at month end. */
export const METRICS: Record<string, { label: string; kind: "count" | "ratio" | "snapshot"; how: string }> = {
  reports: { label: "Safety reports received", kind: "count", how: "reports received in the month (test reports excluded)" },
  mor: { label: "Mandatory occurrences (MOR)", kind: "count", how: "reports classified as mandatory occurrences" },
  significant: { label: "Significant events (ERC ≥ 100)", kind: "count", how: "reports with an ERC of 100 or more (SAM / safety desk score, else the score of the source tool)" },
  acc: { label: "Accidents", kind: "count", how: "reports whose occurrence class is an accident" },
  si: { label: "Serious incidents", kind: "count", how: "reports whose occurrence class is a serious incident" },
  acc_si: { label: "Accidents and serious incidents", kind: "count", how: "reports whose occurrence class is an accident or a serious incident" },
  type_haz: { label: "Hazard reports (HAZ)", kind: "count", how: "reports of type HAZ / hazard report" },
  type_dgr: { label: "Dangerous goods reports (DGR)", kind: "count", how: "reports of type DGR" },
  type_fat: { label: "Fatigue reports", kind: "count", how: "reports of type FAT, or whose title mentions fatigue" },
  kw_bird: { label: "Birdstrike / wildlife", kind: "count", how: "reports mentioning a bird strike or wildlife (title, type, event type, category)" },
  kw_tcas: { label: "TCAS RA", kind: "count", how: "reports mentioning a TCAS RA / resolution advisory (title, type, event type, category)" },
  kw_laser: { label: "Laser attacks", kind: "count", how: "reports mentioning a laser (title, type, event type, category)" },
  anon_pct: { label: "Anonymous reports", kind: "ratio", how: "anonymous reports ÷ reports received" },
  dexres_pct: { label: "DEX + RES reports", kind: "ratio", how: "reports of type DEX or RES ÷ reports received" },
  tech_pct: { label: "Technical reports (ESR, MSR)", kind: "ratio", how: "reports of type ESR or MSR ÷ reports received" },
  feedback_pct: { label: "Reports with feedback", kind: "ratio", how: "reports received in S.A.M. and closed whose reporter got feedback ÷ those closed (history: entered values)" },
  mor_72h: { label: "MOR filed within 72 h", kind: "ratio", how: "MOR filed within 72 h of receipt in S.A.M. ÷ MOR received in S.A.M. (history: entered values)" },
  closed90_pct: { label: "Reports closed in ≤ 90 days", kind: "ratio", how: "reports closed in the month within 90 days of receipt ÷ reports closed in the month" },
  open90: { label: "Reports open > 90 days", kind: "snapshot", how: "reports still open at month end and received more than 90 days before" },
  new_hazards: { label: "New hazards in the hazard log", kind: "count", how: "hazards of the hazard log, dated by the first safety report linked to them (identified through reporting), else by their log entry" },
  ra_count: { label: "Risk assessments", kind: "count", how: "risk assessments conducted (not cancelled)" },
  moc_count: { label: "Management of change files", kind: "count", how: "MOC files opened (not cancelled)" },
  actions_late: { label: "Safety actions overdue", kind: "snapshot", how: "safety actions open past their due date at month end" },
};

export const BASIS: Record<Basis, { label: string; short: string; den: "bh" | "fh" | "flights" | null; per: number }> = {
  count: { label: "number", short: "", den: null, per: 1 },
  per_1000_bh: { label: "per 1000 block hours", short: "/1000 BH", den: "bh", per: 1000 },
  per_1000_fh: { label: "per 1000 flight hours", short: "/1000 FH", den: "fh", per: 1000 },
  per_100_fh: { label: "per 100 flight hours", short: "/100 FH", den: "fh", per: 100 },
  per_1000_flights: { label: "per 1000 flights", short: "/1000 flights", den: "flights", per: 1000 },
  percent: { label: "percentage", short: "%", den: null, per: 1 },
  score: { label: "score 1–5", short: "/5", den: null, per: 1 },
};
export const DIR: Record<string, string> = { le: "≤", ge: "≥", eq: "=" };
export const PERIOD: Record<string, string> = { month: "per month", quarter: "per quarter", year: "per year" };
export const AREA: Record<string, string> = { outcome: "Outcomes", reporting: "Reporting", hazards: "Hazards & risk", operational: "Operational", promotion: "Safety promotion", management: "Management commitment", culture: "Safety culture", erp: "Emergency response", other: "Other" };
export const ACTIVITY: Record<string, string> = { bh: "Block hours", fh: "Flight hours", flights: "Flights" };

/** One month of an SPI: the numerator (count, or percent / score already), its denominator when there is one, and where it came from. */
export type Cell = { num: number; den: number | null; src: "sam" | "entered" } | null;

/** Is the value counted (sum) or a level (last / mean)? */
export function aggOf(d: Pick<SpiDef, "agg" | "basis" | "metric">): "sum" | "last" | "avg" | "pool" {
  if (d.agg) return d.agg;
  if (d.metric && METRICS[d.metric]?.kind === "snapshot") return "last";
  if (d.basis === "score") return "avg";
  if (d.basis === "percent") return "pool";
  return "sum";
}

/** Value of an SPI over a set of months (cells and activity aligned). null = no data. */
export function valueOver(d: Pick<SpiDef, "agg" | "basis" | "metric">, cells: Cell[], activity: (number | null)[]): number | null {
  const a = aggOf(d); const have = cells.map((c, i) => [c, i] as const).filter(([c]) => c);
  if (!have.length) return null;
  if (a === "last") return have[have.length - 1][0]!.num;
  if (a === "avg") return have.reduce((t, [c]) => t + c!.num, 0) / have.length;
  if (a === "pool") { // percent: Σnum / Σden when denominators are known, else the mean of the months
    const withDen = have.filter(([c]) => c!.den != null && c!.den > 0);
    if (withDen.length === have.length) { const den = withDen.reduce((t, [c]) => t + c!.den!, 0); return den ? (withDen.reduce((t, [c]) => t + c!.num, 0) / den) * 100 : null; }
    const pct = have.map(([c]) => (c!.den != null ? (c!.den > 0 ? (c!.num / c!.den) * 100 : null) : c!.num)).filter((x): x is number => x != null);
    return pct.length ? pct.reduce((t, x) => t + x, 0) / pct.length : null;
  }
  const b = BASIS[d.basis];
  if (!b.den) return have.reduce((t, [c]) => t + c!.num, 0);
  const rated = have.filter(([, i]) => (activity[i] ?? 0) > 0); // a rate only over the months whose activity is entered
  const hours = rated.reduce((t, [, i]) => t + (activity[i] ?? 0), 0);
  if (!hours) return null; // no activity entered: no rate
  return (rated.reduce((t, [c]) => t + c!.num, 0) * b.per) / hours;
}

export type Verdict = "ok" | "improve" | "far" | "none" | "nodata";
export const VERDICT: Record<Verdict, [string, string]> = { ok: ["On target", "green"], improve: ["To improve", "amber"], far: ["Far off target", "red"], none: ["No target", ""], nodata: ["No data", ""] };

/** ENR-CM-06 reading: achieved · not achieved, to improve · far off target. With an alert threshold, beyond it = far off; without, 50 % beyond the target (or any event against a zero target) = far off. */
export function judge(v: number | null, dir: string, t: Target | undefined): Verdict {
  if (!t || t.target == null) return v == null ? "nodata" : "none";
  if (v == null) return "nodata";
  const x = Math.round(v * 100) / 100; const T = t.target;
  const ok = dir === "ge" ? x >= T : dir === "le" ? x <= T : x === T;
  if (ok) return "ok";
  if (t.alert != null) return (dir === "ge" ? x >= t.alert : x <= t.alert) ? "improve" : "far";
  if (dir === "ge") return x >= T * 0.5 ? "improve" : "far";
  if (T === 0) return "far";
  return x <= T * 1.5 ? "improve" : "far";
}

/** Target applicable to the part of the period elapsed (a yearly or quarterly "≥ N" is not missed before its end). */
export function proRata(d: Pick<SpiDef, "period" | "direction" | "basis" | "metric" | "agg">, t: Target | undefined, months: number, periodMonths: number): Target | undefined {
  if (!t || t.target == null || d.direction !== "ge" || aggOf(d) !== "sum" || BASIS[d.basis].den) return t;
  if (months >= periodMonths) return t;
  const f = months / periodMonths;
  return { ...t, target: Math.round(t.target * f * 10) / 10, alert: t.alert == null ? null : Math.round(t.alert * f * 10) / 10 };
}

export function fmt(v: number | null, basis: Basis): string {
  if (v == null) return "—";
  if (basis === "percent") return `${Math.round(v)} %`;
  if (basis === "count") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (basis === "score") return v.toFixed(1);
  return String(parseFloat(v.toFixed(v >= 10 ? 1 : 2)));
}
export const targetText = (d: Pick<SpiDef, "direction" | "basis" | "period">, t: Target | undefined) => t?.target == null ? "TBD" : `${DIR[d.direction]} ${fmt(t.target, d.basis)}${d.basis === "percent" || d.basis === "score" ? "" : BASIS[d.basis].short ? " " + BASIS[d.basis].short : ""}${d.period !== "month" && !BASIS[d.basis].den && d.basis === "count" ? " " + PERIOD[d.period] : ""}`;
