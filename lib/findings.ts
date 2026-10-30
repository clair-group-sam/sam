import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action } from "@/lib/actions-shared";
import { today } from "@/lib/authority";

/* FND-03 · Compliance › Findings (30/10). The finding sheet, the NP's answer rounds, the corrective action plan (expected manual
 * changes FND-01/02 + actions), S.A.M.'s pre-reading of each answer (suggestions for Compliance, never a verdict shown to the NP),
 * and the Inbox tasks that follow the status. */

export type Finding = { id: string; entity: string; number: string; source: string; authority: string | null; audit_ref: string | null; level: string; requirement: string | null; title: string; description: string | null;
  owner_role: string | null; owner_person: string | null; notified: string | null; due: string | null; status: string; current_round: number; authority_file_id: string | null;
  closed_at: string | null; closed_by: string | null; closed_note: string | null; created_by: string | null; created_at: string; updated_at: string };
export type Point = { code: string; label: string; detail: string };
export type Assistant = { verdict: "complete" | "incomplete" | "off_topic"; points: Point[]; model: string; at: string };
export type Round = { id: string; finding_id: string; n: number; root_cause: string | null; factors: string | null; immediate: string | null; answered_by: string | null; answered_at: string; via: string;
  assistant: Assistant | null; decision: "accepted" | "sent_back" | null; points: Point[] | null; decided_by: string | null; decided_at: string | null; note: string | null };
export type Change = { id: string; finding_id: string; manual_id: string | null; manual_code: string | null; section_ref: string | null; expected: string; status: string; revision_id: string | null; verified_at: string | null; verified_by: string | null; verified_note: string | null; created_at: string };

export const STATUS_LABEL: Record<string, string> = { open: "Waiting for the answer", answered: "Answer to review", sent_back: "Sent back — to complete", accepted: "Plan accepted — in progress", closure_requested: "Closure requested", closed: "Closed", cancelled: "Cancelled" };
export const STATUS_TONE: Record<string, string> = { open: "amber", answered: "", sent_back: "amber", accepted: "", closure_requested: "", closed: "green", cancelled: "" };
export const LEVEL_LABEL: Record<string, string> = { "1": "Level 1", "2": "Level 2", "3": "Level 3", obs: "Observation" };
export const SOURCE_LABEL: Record<string, string> = { authority: "Authority", internal_audit: "Internal audit", inspection: "Inspection", subcontractor: "Subcontractor", other: "Other" };
export const CHANGE_LABEL: Record<string, string> = { pending: "Waiting for a revision", included: "In a draft", deferred: "Deferred to a later revision", published: "Published — to verify", verified: "Verified", removed: "Removed" };
export const OPEN_STATUSES = ["open", "answered", "sent_back", "accepted", "closure_requested"];

export async function nextFindingNumber(db: SupabaseClient, entity: string): Promise<string> {
  const y = new Date().getFullYear();
  const { data } = await db.from("findings").select("number").eq("entity", entity).like("number", `FND-${entity}-${y}-%`);
  const n = ((data ?? []) as { number: string }[]).map((r) => Number(r.number.split("-").pop())).filter(Number.isFinite);
  return `FND-${entity}-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0")}`;
}

export async function loadFinding(db: SupabaseClient, id: string): Promise<{ f: Finding; rounds: Round[]; changes: Change[]; actions: Action[] } | null> {
  const { data } = await db.from("findings").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [{ data: r }, { data: c }, { data: a }] = await Promise.all([
    db.from("finding_rounds").select("*").eq("finding_id", id).order("n"),
    db.from("finding_changes").select("*").eq("finding_id", id).neq("status", "removed").order("created_at"),
    db.from("safety_actions").select("*").eq("finding_id", id).neq("status", "cancelled").order("created_at"),
  ]);
  return { f: data as Finding, rounds: (r ?? []) as Round[], changes: (c ?? []) as Change[], actions: (a ?? []) as Action[] };
}

/** The plan: what is done, what remains (FND-01 state of play). */
export function plan(changes: Change[], actions: Action[]): { total: number; done: number; remaining: string[] } {
  const remaining: string[] = [];
  for (const c of changes) if (c.status !== "verified") remaining.push(`${c.manual_code ?? "manual"}${c.section_ref ? ` ${c.section_ref}` : ""}: ${CHANGE_LABEL[c.status] ?? c.status}`);
  for (const a of actions) if (a.status !== "verified") remaining.push(`${a.number} ${a.title}: ${a.status.replace("_", " ")}`);
  return { total: changes.length + actions.length, done: changes.length + actions.length - remaining.length, remaining };
}

/* ---------- pre-reading ---------- */
const words = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3));
const overlap = (a: Set<string>, b: Set<string>) => { if (!a.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / a.size; };
const ORG = /\b(procedure|process|training|workload|resource|staffing|supervision|communication|interface|planning|documentation|manual|checklist|tool|software|system|culture|handover|design|roster|fatigue|contract|subcontractor|audit|oversight|monitoring|organisation|organization|responsibilit|formation|procédure|processus|ressource|supervision|planification|outil)/i;
const PERSON = /\b(forgot|forgotten|oversight by|negligence|careless|did not pay attention|human error|error of the|mistake by|oubli|négligence|erreur humaine|inattention)\b/i;
const CAUSAL = /\b(because|due to|caused by|as a result|led to|resulting|since|root|origin|stems|parce que|car|à cause|dû à|origine|découle)\b/i;
const TRAINING_ONLY = /^(re)?(train|brief|remind|sensiti|inform|recall|formation|rappel|sensibilis)/i;

/** Rule-based reading of an answer: the points a compliance monitoring manager checks first. Suggestions, in neutral words. */
export function critique(f: Finding, r: Pick<Round, "root_cause" | "factors" | "immediate">, changes: Change[], actions: Action[]): Assistant {
  const pts: Point[] = [];
  const rc = (r.root_cause ?? "").trim(), fa = (r.factors ?? "").trim(), im = (r.immediate ?? "").trim();
  const rcW = words(rc), fW = words(`${f.title} ${f.description ?? ""}`);
  if (!rc) pts.push({ code: "RC_EMPTY", label: "Root cause missing", detail: "The answer does not say why the non-compliance happened." });
  else {
    if (rcW.size < 10) pts.push({ code: "RC_SHORT", label: "Root cause very short", detail: "A few words rarely explain why the system let this happen; say what was missing or not working." });
    if (overlap(rcW, fW) > 0.6) pts.push({ code: "RC_SYMPTOM", label: "Root cause restates the finding", detail: "The cause repeats what the auditor saw. Ask why it happened, then why that happened." });
    if (!CAUSAL.test(rc) && rcW.size < 40) pts.push({ code: "RC_NO_WHY", label: "No causal link", detail: "The text describes but does not explain: no “because”, “due to”, “as a result”." });
    if (PERSON.test(rc) && !ORG.test(`${rc} ${fa}`)) pts.push({ code: "RC_PERSON", label: "Cause placed on a person only", detail: "An individual error is the symptom; what in procedures, training, workload, tools or supervision allowed it?" });
  }
  if (!fa && !ORG.test(rc)) pts.push({ code: "FACTORS_NONE", label: "No organisational factor", detail: "Contributing factors (procedure, resources, communication, supervision, interface…) are not stated." });
  if (!im) pts.push({ code: "IMMEDIATE_NONE", label: "No immediate action", detail: "What was done right away to contain the non-compliance?" });
  const live = actions.filter((a) => a.status !== "cancelled"), ch = changes.filter((c) => c.status !== "removed");
  if (!live.length && !ch.length) pts.push({ code: "CAP_EMPTY", label: "No corrective action plan", detail: "Neither an expected manual change nor an action is attached." });
  else {
    if (live.length && live.every((a) => TRAINING_ONLY.test(a.title)) && !ch.length) pts.push({ code: "CAP_TRAINING_ONLY", label: "Plan limited to training / reminders", detail: "Reminding people rarely removes a cause; is a procedure, a tool or a check to change?" });
    const noDate = live.filter((a) => !a.due), noOwner = live.filter((a) => !a.owner_role && !a.owner_person);
    if (noDate.length) pts.push({ code: "ACTION_NO_DATE", label: `${noDate.length} action${noDate.length > 1 ? "s" : ""} without a date`, detail: noDate.map((a) => a.number).join(", ") });
    if (noOwner.length) pts.push({ code: "ACTION_NO_OWNER", label: `${noOwner.length} action${noOwner.length > 1 ? "s" : ""} without an owner`, detail: noOwner.map((a) => a.number).join(", ") });
    if (/\b(manual|procedure|OM|CAME|MSM|MOE|CAE|SMS)\b/i.test(`${f.requirement ?? ""} ${f.description ?? ""}`) && !ch.length) pts.push({ code: "CAP_NO_MANUAL", label: "No manual change planned", detail: "The finding refers to a documented procedure; is a manual to amend?" });
  }
  const blocking = new Set(["RC_EMPTY", "RC_SYMPTOM", "FACTORS_NONE", "CAP_EMPTY"]);
  const offTopic = !!rc && rcW.size >= 6 && overlap(rcW, new Set([...fW, ...words(f.requirement)])) === 0;
  const verdict: Assistant["verdict"] = offTopic ? "off_topic" : pts.some((p) => blocking.has(p.code)) ? "incomplete" : "complete";
  return { verdict, points: pts, model: "rules", at: new Date().toISOString() };
}

const PREREAD_SYSTEM = `You are the assistant of a Compliance Monitoring Manager (EASA AOC / ATO / CAMO). You pre-read a nominated person's answer to an audit finding: root cause, contributing factors, immediate action, corrective action plan.
Judge the ANALYSIS, never the person. Neutral, short, professional English. The output is a suggestion for the compliance manager, who decides.
Checks: is the root cause a cause (why the system allowed it) or a restatement of the symptom? Is there an organisational factor (procedure, training, resources, supervision, interface, tools)? Does the plan address the cause (not only training / reminders)? Does each action have an owner and a date? Is the answer about this finding?
Answer ONLY with JSON: {"verdict":"complete|incomplete|off_topic","points":[{"code":"SHORT_CODE","label":"≤ 8 words","detail":"one sentence the NP can act on"}]} — at most 6 points, none if the answer is sound.`;

/** Pre-reads a round with Claude when the key is there, otherwise with the rules; always returns something. */
export async function preRead(f: Finding, r: Round, changes: Change[], actions: Action[]): Promise<Assistant> {
  const rules = critique(f, r, changes, actions);
  if (!process.env.ANTHROPIC_API_KEY) return rules;
  try {
    const { callClaude } = await import("@/lib/ai");
    const user = `FINDING ${f.number} (${LEVEL_LABEL[f.level] ?? f.level}, ${f.requirement ?? "no reference"})\nTitle: ${f.title}\nText: ${f.description ?? "—"}\n\nANSWER (round ${r.n})\nRoot cause: ${r.root_cause ?? "—"}\nContributing factors: ${r.factors ?? "—"}\nImmediate action: ${r.immediate ?? "—"}\n\nPLAN\nExpected manual changes: ${changes.length ? changes.map((c) => `${c.manual_code ?? "?"} ${c.section_ref ?? ""}: ${c.expected}`).join(" | ") : "none"}\nActions: ${actions.length ? actions.map((a) => `${a.number} ${a.title} (owner ${a.owner_role ?? a.owner_person ?? "none"}, due ${a.due ?? "none"})`).join(" | ") : "none"}`;
    const { text, model } = await callClaude({ agent: "check", personId: null, entity: f.entity, system: PREREAD_SYSTEM, user, maxTokens: 1200 });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) return rules;
    const j = JSON.parse(m[0]) as { verdict?: string; points?: Point[] };
    const verdict = (["complete", "incomplete", "off_topic"].includes(j.verdict ?? "") ? j.verdict : rules.verdict) as Assistant["verdict"];
    return { verdict, points: (j.points ?? []).slice(0, 6).map((p) => ({ code: String(p.code ?? "NOTE").slice(0, 32), label: String(p.label ?? "").slice(0, 80), detail: String(p.detail ?? "").slice(0, 300) })), model, at: new Date().toISOString() };
  } catch { return rules; }
}

/* ---------- Inbox tasks that follow the status ---------- */
export async function syncFindingTasks(db: SupabaseClient, f: Finding, extra?: { points?: Point[] }): Promise<void> {
  const KINDS = ["finding", "finding_review", "finding_closure", "status_review"];
  const { data: open } = await db.from("tasks").select("id,kind,title").eq("ref_id", f.id).in("kind", KINDS).eq("status", "open");
  const openRows = (open ?? []) as { id: string; kind: string; title: string }[];
  const want: { kind: string; title: string; detail: string; owner_role: string | null; owner_person: string | null; due: string | null }[] = [];
  const owner = f.owner_person ? { owner_role: null, owner_person: f.owner_person } : { owner_role: f.owner_role ?? "CMM", owner_person: null };
  const cmm = { owner_role: "CMM", owner_person: null };
  const head = `${f.number} — ${f.title}`.slice(0, 160);
  if (f.status === "open") want.push({ kind: "finding", title: `Answer ${head}`, detail: `${LEVEL_LABEL[f.level] ?? f.level}${f.requirement ? ` · ${f.requirement}` : ""}. Root cause, contributing factors, immediate action and the corrective action plan.`, ...owner, due: f.due });
  if (f.status === "sent_back") want.push({ kind: "finding", title: `Analysis sent back — ${extra?.points?.length ?? "some"} point${(extra?.points?.length ?? 2) === 1 ? "" : "s"} to address · ${head}`.slice(0, 200), detail: (extra?.points ?? []).map((p) => `• ${p.label}`).join("\n") || "Compliance asked for a complement; see the finding.", ...owner, due: f.due });
  if (f.status === "answered") want.push({ kind: "finding_review", title: `Read the answer · ${head}`, detail: "The nominated person answered: accept the analysis and the plan, or send it back with the points to address.", ...cmm, due: today() });
  if (f.status === "closure_requested") want.push({ kind: "finding_review", title: `Closure requested · ${head}`, detail: "The plan is reported complete: check the evidence (published changes verified, actions verified) and close, or send back.", ...cmm, due: today() });
  const keep = new Set<string>();
  for (const w of want) { const ex = openRows.find((o) => o.kind === w.kind && o.title === w.title); if (ex) keep.add(ex.id); else await db.from("tasks").insert({ entity: f.entity, status: "open", link: `/comp/find/${f.id}`, ref_id: f.id, ...w }); }
  const drop = openRows.filter((o) => !keep.has(o.id) && o.kind !== "finding_closure").map((o) => o.id);
  if (drop.length) await db.from("tasks").update({ status: "done" }).in("id", drop);
  if (["closed", "cancelled"].includes(f.status)) await db.from("tasks").update({ status: "done" }).eq("ref_id", f.id).in("kind", KINDS).eq("status", "open");
}

/** Daily: accepted findings whose plan is complete → closure proposed to the NP (once), Compliance informed. */
export async function sweepFindings(db: SupabaseClient): Promise<number> {
  const { data } = await db.from("findings").select("*").eq("status", "accepted").limit(500);
  let n = 0;
  for (const f of (data ?? []) as Finding[]) {
    const [{ data: c }, { data: a }] = await Promise.all([db.from("finding_changes").select("*").eq("finding_id", f.id).neq("status", "removed"), db.from("safety_actions").select("*").eq("finding_id", f.id).neq("status", "cancelled")]);
    const p = plan((c ?? []) as Change[], (a ?? []) as Action[]);
    if (!p.total || p.remaining.length) continue;
    const { data: ex } = await db.from("tasks").select("id").eq("ref_id", f.id).eq("kind", "finding_closure").limit(1);
    if (ex?.length) continue;
    const owner = f.owner_person ? { owner_role: null, owner_person: f.owner_person } : { owner_role: f.owner_role ?? "CMM", owner_person: null };
    await db.from("tasks").insert({ entity: f.entity, kind: "finding_closure", title: `Closure proposed · ${f.number} — ${f.title}`.slice(0, 200), detail: "Every expected change is published and verified, every action is verified: request the closure from the finding.", ...owner, due: today(), status: "open", link: `/comp/find/${f.id}`, ref_id: f.id });
    n++;
  }
  return n;
}
