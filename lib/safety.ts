// SAF-01 Safety reports: roles, report ids, the 72 h MOR clock (376/2014 art. 4(8): from RECEIPT in S.A.M.), ERC (ARMS) matrix.
import { basePost, type Session } from "@/lib/session";

/** Safety desk = the people who read and analyse reports: CMM / SM / FSO (and their deputies). */
export function isSafetyDesk(s: Session): boolean {
  const p = s.roles.map(basePost);
  return s.role === "cmm" || p.includes("SM") || p.includes("FSO");
}
/** Reporter identity is shown to the SM / FSO only (confidentiality, 376/2014 art. 16). */
export function seesReporter(s: Session): boolean {
  const p = s.roles.map(basePost);
  return p.includes("SM") || p.includes("FSO") || p.includes("SUPERADMIN");
}

export const STATUS: Record<string, [string, string]> = {
  received: ["Received", "amber"], acknowledged: ["Acknowledged", "blue"], classified: ["Classified", "blue"],
  investigation: ["Under investigation", "amber"], closed: ["Closed", "green"],
};
export const PHASES = ["Parked / ground", "Taxi", "Take-off", "Initial climb", "Climb", "Cruise", "Descent", "Approach", "Landing", "After landing", "Training / simulator", "Maintenance", "Not in flight"];

export const MOR_HOURS = 72;
export function morClock(receivedAt: string, filedAt: string | null, status: string | null, now = Date.now()) {
  const deadline = new Date(new Date(receivedAt).getTime() + MOR_HOURS * 3600e3);
  if (filedAt) return { state: "filed" as const, deadline, left: 0, label: "MOR filed" };
  if (status === "voluntary") return { state: "not_reportable" as const, deadline, left: 0, label: "not a mandatory occurrence" };
  const left = Math.round((deadline.getTime() - now) / 3600e3);
  return { state: left < 0 ? ("late" as const) : ("running" as const), deadline, left, label: left < 0 ? `${-left} h past the 72 h` : `${left} h left` };
}

// ERC — ARMS Event Risk Classification: most credible accident outcome × remaining barriers
export const ERC_OUTCOMES = [
  { id: "catastrophic", label: "Catastrophic accident", hint: "loss of aircraft or multiple fatalities" },
  { id: "major", label: "Major accident", hint: "1–2 fatalities, multiple serious injuries, major damage" },
  { id: "minor", label: "Minor injuries or damage", hint: "minor injuries, minor damage" },
  { id: "none", label: "No accident outcome", hint: "no potential damage or injury" },
] as const;
export const ERC_BARRIERS = [
  { id: "effective", label: "Effective" }, { id: "limited", label: "Limited" },
  { id: "minimal", label: "Minimal" }, { id: "not_effective", label: "Not effective" },
] as const;
const ERC_TABLE: Record<string, number[]> = { catastrophic: [50, 102, 502, 2500], major: [10, 21, 101, 500], minor: [2, 4, 20, 100], none: [1, 1, 1, 1] };
export function ercValue(outcome?: string | null, barriers?: string | null): number | null {
  const row = outcome ? ERC_TABLE[outcome] : undefined; const i = ERC_BARRIERS.findIndex((b) => b.id === barriers);
  return row && i >= 0 ? row[i] : null;
}
export const ercTone = (v: number | null) => (v == null ? "" : v >= 500 ? "red" : v >= 20 ? "amber" : "green");

/** Next report id: YYYY-NNN (one series for the group, as on the reporting form). */
export function nextReportId(existing: string[], year = new Date().getUTCFullYear()): string {
  const n = existing.map((id) => (id.startsWith(`${year}-`) ? Number(id.slice(5)) : 0)).filter((x) => Number.isFinite(x));
  return `${year}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0")}`;
}

export type Precision = { key: string; label: string; type: "choice" | "text" | "time"; options?: string[] };
/** Used when the assistant is not reachable: the usual missing facts. */
export const DEFAULT_PRECISIONS: Precision[] = [
  { key: "time_utc", label: "Time of the event (UTC)", type: "time" },
  { key: "phase", label: "Phase of flight", type: "choice", options: PHASES },
  { key: "alert", label: "What made you notice it?", type: "text" },
  { key: "consequence", label: "Any consequence (damage, injury, delay, go-around…)?", type: "text" },
];
