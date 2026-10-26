// SAF-01 · constants shared with the browser (no server import here).
export const PHASES = ["Parked / ground", "Taxi", "Take-off", "Initial climb", "Climb", "Cruise", "Descent", "Approach", "Landing", "After landing", "Training / simulator", "Maintenance", "Not in flight"];

export type Precision = { key: string; label: string; type: "choice" | "text" | "time"; options?: string[] };
/** Used when the assistant is not reachable: the usual missing facts. */
export const DEFAULT_PRECISIONS: Precision[] = [
  { key: "time_utc", label: "Time of the event (UTC)", type: "time" },
  { key: "phase", label: "Phase of flight", type: "choice", options: PHASES },
  { key: "alert", label: "What made you notice it?", type: "text" },
  { key: "consequence", label: "Any consequence (damage, injury, delay, go-around…)?", type: "text" },
];
