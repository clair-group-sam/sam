import { today } from "@/lib/authority";

/* 10/11 · a deadline you read at a glance (Guillaume): colour + countdown. Past due = red « 3 d late »; ≤ 7 d = red « D-5 »; ≤ 30 d = amber; later = green.
 * done = the item is closed: the date is shown plain. */
export function dueTone(due: string | null | undefined, t0 = today()): { tone: "late" | "soon" | "near" | "far" | "none"; days: number | null } {
  if (!due) return { tone: "none", days: null };
  const d = Math.round((Date.parse(due) - Date.parse(t0)) / 86_400_000);
  return { tone: d < 0 ? "late" : d <= 7 ? "soon" : d <= 30 ? "near" : "far", days: d };
}
export function DueChip({ due, done = false, t0, compact = false }: { due: string | null | undefined; done?: boolean; t0?: string; compact?: boolean }) {
  if (!due) return <span className="mini">—</span>;
  if (done) return <span className="mono mini">{due}</span>;
  const { tone, days } = dueTone(due, t0);
  const count = days === null ? "" : days < 0 ? `${-days} d late` : days === 0 ? "today" : `D-${days}`;
  return <span className={"duechip " + tone} title={`${due}, ${count}`}><b>{count}</b>{!compact && <span className="mono">{due}</span>}</span>;
}
