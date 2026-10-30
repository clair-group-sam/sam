import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTasks, type TaskRow } from "@/lib/teams";
import { addDays, today } from "@/lib/authority";

/* SOC-02 · one reminder / escalation engine (roadmap item 1, 30/10).
 * Every open Inbox task with a due date goes through the same ladder, driven by Settings › Notification rules:
 *   remind   → the owner gets the card again on the due date
 *   chase    → again at J+chase, flagged overdue
 *   escalate → a new task for the department head (CMM compliance side, SM safety side), pointing at the same object
 *   am       → a new task for the Accountable Manager
 * Each step runs once per task (tasks.escalation). Escalation tasks close themselves when the original closes. */

export type Rule = { kind: string; label: string; remind_days: number | null; chase_days: number | null; escalate_days: number | null; escalate_to: string | null; am_days: number | null; active: boolean };
export const STEPS = ["remind", "chase", "escalate", "am"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = { remind: "Reminder", chase: "Chase", escalate: "Escalated", am: "AM informed" };
/** Kinds the engine never touches: its own rows, and tasks that are not somebody's to-do. */
const SKIP = new Set(["escalation", "status_review"]);

export async function loadRules(db: SupabaseClient): Promise<Rule[]> {
  const { data } = await db.from("notification_rules").select("*").order("kind");
  return (data ?? []) as Rule[];
}
export const ruleFor = (rules: Rule[], kind: string): Rule | undefined => rules.find((r) => r.kind === kind && r.active) ?? rules.find((r) => r.kind === "*" && r.active);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** The step a task has reached today, given its rule: the deepest step whose day count is passed. */
export function stepsDue(rule: Rule, overdue: number): Step[] {
  const out: Step[] = [];
  if (rule.remind_days != null && overdue >= rule.remind_days) out.push("remind");
  if (rule.chase_days != null && overdue >= rule.chase_days) out.push("chase");
  if (rule.escalate_days != null && rule.escalate_to && overdue >= rule.escalate_days) out.push("escalate");
  if (rule.am_days != null && overdue >= rule.am_days) out.push("am");
  return out;
}

type Esc = Partial<Record<Step, string>>;
type Row = TaskRow & { escalation: Esc | null };

export async function runEscalations(db: SupabaseClient): Promise<Record<string, number>> {
  const t0 = today();
  const out = { reminded: 0, chased: 0, escalated: 0, am: 0, closed: 0 };
  const rules = await loadRules(db);
  if (!rules.length) return out;
  const { data: people } = await db.from("people").select("id,display_name").limit(500);
  const nameOf = (id: string | null) => (people ?? []).find((p: { id: string }) => p.id === id)?.display_name as string | undefined;
  // 1 · the ladder
  const { data } = await db.from("tasks").select("*").eq("status", "open").not("due", "is", null).lte("due", t0).order("due").limit(500);
  const resend: TaskRow[] = [];
  for (const t of (data ?? []) as Row[]) {
    if (SKIP.has(t.kind)) continue;
    const rule = ruleFor(rules, t.kind);
    if (!rule) continue;
    const overdue = daysBetween(t.due!, t0);
    const done: Esc = t.escalation ?? {};
    const todo = stepsDue(rule, overdue).filter((s) => !done[s]);
    if (!todo.length) continue;
    // only the deepest new step is acted on (a task found at J+20 gets one escalation, not four messages)
    const step = todo[todo.length - 1];
    const owner = t.owner_person ? nameOf(t.owner_person) ?? "the owner" : t.owner_role ?? "nobody";
    if (step === "remind" || step === "chase") {
      resend.push({ ...t, title: `${step === "remind" ? "Due today" : `Overdue ${overdue} day${overdue === 1 ? "" : "s"}`} · ${t.title}`.slice(0, 200) });
      if (step === "remind") out.reminded++; else out.chased++;
    } else {
      const role = step === "am" ? "AM" : rule.escalate_to!;
      const { data: ex } = await db.from("tasks").select("id").eq("kind", "escalation").eq("ref_id", t.id).eq("owner_role", role).eq("status", "open").limit(1);
      if (!ex?.length) {
        await db.from("tasks").insert({ entity: t.entity, kind: "escalation", title: `Overdue ${overdue} days — ${t.title}`.slice(0, 200), detail: `${rule.label} · for ${owner} · due ${t.due}. ${step === "am" ? "The department head was informed and the item is still open: decide what happens." : "Nobody closed it: chase the owner or take it over."}`, due: t0, owner_role: role, status: "open", link: t.link, ref_id: t.id });
      }
      if (step === "am") out.am++; else out.escalated++;
    }
    for (const s of todo) done[s] = t0; // the lower steps are considered covered by the deeper one
    await db.from("tasks").update({ escalation: done }).eq("id", t.id);
  }
  if (resend.length) await notifyTasks(db, resend);
  // 2 · escalation rows whose original is no longer open close by themselves
  const { data: esc } = await db.from("tasks").select("id,ref_id").eq("kind", "escalation").eq("status", "open").limit(500);
  const refs = [...new Set(((esc ?? []) as { ref_id: string }[]).map((e) => e.ref_id).filter(Boolean))];
  if (refs.length) {
    const { data: orig } = await db.from("tasks").select("id,status").in("id", refs);
    const stillOpen = new Set(((orig ?? []) as { id: string; status: string }[]).filter((o) => o.status === "open").map((o) => o.id));
    const close = ((esc ?? []) as { id: string; ref_id: string }[]).filter((e) => !stillOpen.has(e.ref_id)).map((e) => e.id);
    if (close.length) { await db.from("tasks").update({ status: "superseded" }).in("id", close); out.closed = close.length; }
  }
  return out;
}

/** Overdue open tasks grouped by entity and owner (post or person), for the Compliance & Safety dashboard. */
export type OverdueGroup = { entity: string; owner: string; isPerson: boolean; count: number; worst: number; escalated: number; am: number; items: { id: string; title: string; kind: string; due: string; overdue: number; link: string | null; level: Step | null }[] };
export async function overdueByOwner(db: SupabaseClient, entities: string[] | null): Promise<OverdueGroup[]> {
  const t0 = today();
  let q = db.from("tasks").select("*").eq("status", "open").not("due", "is", null).lt("due", t0).neq("kind", "escalation").order("due").limit(1000);
  if (entities) q = q.in("entity", entities);
  const { data } = await q;
  const { data: people } = await db.from("people").select("id,display_name").limit(500);
  const nameOf = (id: string) => ((people ?? []) as { id: string; display_name: string }[]).find((p) => p.id === id)?.display_name ?? "?";
  const groups = new Map<string, OverdueGroup>();
  for (const t of (data ?? []) as Row[]) {
    const owner = t.owner_person ? nameOf(t.owner_person) : t.owner_role ?? "Unassigned";
    const key = `${t.entity}|${owner}`;
    const g = groups.get(key) ?? { entity: t.entity, owner, isPerson: !!t.owner_person, count: 0, worst: 0, escalated: 0, am: 0, items: [] };
    const overdue = daysBetween(t.due!, t0);
    const e = t.escalation ?? {};
    const level: Step | null = e.am ? "am" : e.escalate ? "escalate" : e.chase ? "chase" : e.remind ? "remind" : null;
    g.count++; g.worst = Math.max(g.worst, overdue); if (e.escalate) g.escalated++; if (e.am) g.am++;
    g.items.push({ id: t.id, title: t.title, kind: t.kind, due: t.due!, overdue, link: t.link, level });
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.worst - a.worst || b.count - a.count);
}
