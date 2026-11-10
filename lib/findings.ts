import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action } from "@/lib/actions-shared";
import { today } from "@/lib/authority";
import { authorityStep } from "@/lib/authority-audit";

/* FND-03 · Compliance › Findings (30/10). The finding sheet, the NP's answer rounds, the corrective action plan (expected manual
 * changes FND-01/02 + actions), S.A.M.'s pre-reading of each answer (suggestions for Compliance, never a verdict shown to the NP),
 * and the Inbox tasks that follow the status. */

export type Finding = { id: string; entity: string; number: string; source: string; authority: string | null; audit_ref: string | null; level: string; requirement: string | null; title: string; description: string | null;
  owner_role: string | null; owner_person: string | null; notified: string | null; due: string | null; status: string; current_round: number; plan_round: number; authority_file_id: string | null;
  finding_type?: string | null; finding_type_by?: string | null; imported_from?: string | null; audit_id?: string | null;
  authority_ref?: string | null; authority_rca?: string | null; authority_pac?: string | null; authority_proof?: string | null; proof?: string | null; extension?: string | null; extension_reason?: string | null; finding_file?: string | null;
  draft_root_cause: string | null; draft_factors: string | null; draft_immediate: string | null; draft_comment: string | null; draft_step: number; rca_check: Assistant | null; plan_check: Assistant | null; effective_closed_on: string | null;
  closed_at: string | null; closed_by: string | null; closed_note: string | null; created_by: string | null; created_at: string; updated_at: string };
export type Point = { code: string; label: string; detail: string; part?: "rca" | "plan" };
export type Assistant = { verdict: "complete" | "incomplete" | "off_topic"; points: Point[]; model: string; at: string };
export type Stage = "rca" | "plan" | "full";
export type Round = { id: string; finding_id: string; stage: Stage; n: number; comment: string | null; root_cause: string | null; factors: string | null; immediate: string | null; answered_by: string | null; answered_at: string; via: string;
  assistant: Assistant | null; decision: "accepted" | "sent_back" | null; points: Point[] | null; decided_by: string | null; decided_at: string | null; note: string | null };
export type Change = { id: string; finding_id: string; manual_id: string | null; manual_code: string | null; section_ref: string | null; expected: string; status: string; revision_id: string | null; verified_at: string | null; verified_by: string | null; verified_note: string | null; created_at: string;
  route: string | null; authority_file_id: string | null; authority_ref: string | null; effective_on: string | null };

export const STATUS_LABEL: Record<string, string> = { open: "To analyse", review: "Analysis to review", back: "Sent back — to complete", accepted: "Plan in progress", closure_requested: "Closure requested", closed: "Closed", cancelled: "Cancelled" };
export const STATUS_TONE: Record<string, string> = { open: "amber", review: "", back: "amber", accepted: "", closure_requested: "", closed: "green", cancelled: "" };
/** The 5-step path shown on the sheet. Steps 1-2 are the NP's writing (draft_step), 3 the review, 4 the plan, 5 the closure. */
export const STEPS_PATH = ["Root cause", "Action plan", "Compliance review", "Plan in progress", "Closure"];
export function stepOf(f: Pick<Finding, "status" | "draft_step">): number {
  switch (f.status) { case "open": case "back": return Math.min(f.draft_step, 2); case "review": return 3; case "accepted": return 4; case "closure_requested": case "closed": return 5; default: return 0; }
}
export const NP_TURN = ["open", "back"];
export const CMM_TURN = ["review", "closure_requested"];
export const LEVEL_LABEL: Record<string, string> = { "1": "Level 1", "2": "Level 2", "3": "Level 3", obs: "Observation" };
export const SOURCE_LABEL: Record<string, string> = { authority: "Authority", internal_audit: "Internal audit", inspection: "Inspection", subcontractor: "Subcontractor", other: "Other" };
export const CHANGE_LABEL: Record<string, string> = { pending: "Waiting for a revision", included: "In a draft", deferred: "Deferred to a later revision", awaiting_authority: "Published — awaiting the authority's return", published: "Effective — to verify", verified: "Verified", removed: "Removed" };
/** FND-04 · what makes a manual change effective: the authority's approval / acknowledgement, or the publication (MSM §2.3). */
export const ROUTE_LABEL: Record<string, string> = { approval: "authority approval", notification: "authority acknowledgement", publication: "publication" };
export const needsAuthority = (c: Pick<Change, "route">) => c.route === "approval" || c.route === "notification";
export const OPEN_STATUSES = ["open", "review", "back", "accepted", "closure_requested"];

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

/** FND-04 · The regulatory closure date: the last approval / acknowledgement / publication of the plan (never the day the text was written). */
export function effectiveClosure(changes: Change[], actions: Action[]): string | null {
  const d = [...changes.filter((c) => c.status === "verified").map((c) => c.effective_on ?? c.verified_at?.slice(0, 10) ?? null), ...actions.filter((a) => a.status === "verified").map((a) => (a.verified_at ?? a.done_at)?.slice(0, 10) ?? null)].filter((x): x is string => !!x);
  return d.length ? d.sort().at(-1)! : null;
}

/** FND-04 · One glance at how far the work has gone — on the list, without opening the finding. */
export type Progress = { label: string; tone: "" | "amber" | "green" | "red"; detail: string[]; pct: number };
export function progress(f: Pick<Finding, "status" | "draft_step" | "current_round" | "effective_closed_on"> & { draft_root_cause?: string | null; imported_from?: string | null; source?: string; authority_rca?: string | null; authority_pac?: string | null; authority_proof?: string | null }, changes: Change[], actions: Action[]): Progress {
  const ch = changes.filter((c) => c.status !== "removed"), ac = actions.filter((a) => a.status !== "cancelled");
  const total = ch.length + ac.length;
  const n = (st: string[]) => ch.filter((c) => st.includes(c.status)).length;
  const drafting = n(["pending", "deferred", "included"]), waiting = n(["awaiting_authority"]), toVerify = n(["published"]), chDone = n(["verified"]);
  const acDone = ac.filter((a) => a.status === "verified").length, acClosed = ac.filter((a) => a.status === "done").length, acOpen = ac.length - acDone - acClosed;
  const done = chDone + acDone;
  const detail: string[] = [];
  if (drafting) detail.push(`${drafting} manual change${drafting > 1 ? "s" : ""} being written`);
  if (waiting) detail.push(`${waiting} with the authority`);
  if (toVerify) detail.push(`${toVerify} effective, to verify`);
  if (acOpen) detail.push(`${acOpen} action${acOpen > 1 ? "s" : ""} open`);
  if (acClosed) detail.push(`${acClosed} action${acClosed > 1 ? "s" : ""} done, to verify`);
  const pct = total ? Math.round((100 * done) / total) : 0;
  // 10/11 · an authority finding whose answer went to the authority: what the authority still has to decide comes first
  if (f.source === "authority" && !["closed", "cancelled"].includes(f.status) && (f.authority_rca || f.authority_pac)) { const st = authorityStep(f); return { label: st.label, tone: (st.tone as Progress["tone"]) || "", detail, pct }; }
  switch (f.status) {
    case "open": // 10/11 · nothing written yet is "not started", not "being written"
      if (f.draft_step >= 2) return { label: "Plan being written", tone: "amber", detail, pct };
      if (f.draft_root_cause?.trim()) return { label: "Root cause being written", tone: "amber", detail, pct };
      return { label: "Not started", tone: "", detail, pct };
    case "back": return { label: `Sent back — round ${f.current_round}`, tone: "amber", detail, pct };
    case "review": return { label: "Analysis with Compliance", tone: "", detail, pct };
    case "accepted":
      if (!total) return f.imported_from ? { label: "Plan in progress — Monday plan, actions not attached yet", tone: "amber", detail, pct } : { label: "Plan accepted — nothing attached", tone: "red", detail, pct };
      if (done === total) return { label: "Work done — closure to request", tone: "green", detail, pct: 100 };
      if (waiting && !drafting && !acOpen) return { label: `Work done — awaiting the authority (${waiting})`, tone: "amber", detail, pct };
      if (toVerify && !drafting && !waiting && !acOpen && !acClosed) return { label: "Work done — Compliance to verify", tone: "green", detail, pct };
      return { label: `Plan ${done}/${total}`, tone: "", detail, pct };
    case "closure_requested": return { label: "Closure requested — Compliance", tone: "green", detail, pct: 100 };
    case "closed": return { label: f.effective_closed_on ? `Closed · effective ${f.effective_closed_on}` : "Closed", tone: "green", detail: [], pct: 100 };
    case "cancelled": return { label: "Cancelled", tone: "", detail: [], pct: 0 };
    default: return { label: f.status, tone: "", detail, pct };
  }
}

/* ---------- pre-reading ---------- */
const words = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3));
const overlap = (a: Set<string>, b: Set<string>) => { if (!a.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / a.size; };
const ORG = /\b(procedure|process|training|workload|resource|staffing|supervision|communication|interface|planning|documentation|manual|checklist|tool|software|system|culture|handover|design|roster|fatigue|contract|subcontractor|audit|oversight|monitoring|organisation|organization|responsibilit|formation|procédure|processus|ressource|supervision|planification|outil)/i;
const PERSON = /\b(forgot|forgotten|oversight by|negligence|careless|did not pay attention|human error|error of the|mistake by|oubli|négligence|erreur humaine|inattention)\b/i;
const CAUSAL = /\b(because|due to|caused by|as a result|led to|resulting|since|root|origin|stems|parce que|car|à cause|dû à|origine|découle)\b/i;
const TRAINING_ONLY = /^(re)?(train|brief|remind|sensiti|inform|recall|formation|rappel|sensibilis)/i;

/** Rule-based reading of an answer: the points a compliance monitoring manager checks first. Suggestions, in neutral words. */
export function critique(f: Finding, r: Pick<Round, "root_cause" | "factors" | "immediate">, changes: Change[], actions: Action[], stage: Stage = "rca"): Assistant {
  const pts: Point[] = [];
  if (stage === "plan") return critiquePlan(f, r, changes, actions);
  if (stage === "full") { const a = critique(f, r, changes, actions, "rca"), b = critiquePlan(f, r, changes, actions); return { verdict: a.verdict !== "complete" ? a.verdict : b.verdict, points: [...a.points, ...b.points], model: "rules", at: a.at }; }
  const rc = (r.root_cause ?? "").trim(), fa = (r.factors ?? "").trim(), im = (r.immediate ?? "").trim();
  const rcW = words(rc), fW = words(`${f.title} ${f.description ?? ""}`);
  if (!rc) pts.push({ code: "RC_EMPTY", label: "Root cause missing", detail: "The answer does not say why the non-compliance happened." });
  else {
    if (rcW.size < 10) pts.push({ code: "RC_SHORT", label: "Root cause very short", detail: "A few words rarely explain why the system let this happen; say what was missing or not working." });
    if (overlap(rcW, fW) > 0.6) pts.push({ code: "RC_SYMPTOM", label: "Root cause restates the finding", detail: "The cause repeats what the auditor saw. Ask why it happened, then why that happened." });
    if (!CAUSAL.test(rc) && rcW.size < 40) pts.push({ code: "RC_NO_WHY", label: "No causal link", detail: "The text describes but does not explain: no “because”, “due to”, “as a result”." });
    if (PERSON.test(rc) && !ORG.test(`${rc} ${fa}`)) pts.push({ code: "RC_PERSON", label: "Cause placed on a person only", detail: "An individual error is the symptom; what in procedures, training, workload, tools or supervision allowed it?" });
  }
  // 10/11 · one root-cause field only (Guillaume): the organisational factor is looked for in the root cause itself
  if (rc && !ORG.test(`${rc} ${fa}`)) pts.push({ code: "RC_NO_SYSTEM", label: "No organisational cause named", detail: "Say what in the system let it happen: procedure, training, resources, supervision, interface, tools." });
  void im;
  const blocking = new Set(["RC_EMPTY", "RC_SYMPTOM"]);
  const offTopic = !!rc && rcW.size >= 6 && overlap(rcW, new Set([...fW, ...words(f.requirement)])) === 0;
  const verdict: Assistant["verdict"] = offTopic ? "off_topic" : pts.some((p) => blocking.has(p.code)) ? "incomplete" : "complete";
  return { verdict, points: pts.map((q) => ({ ...q, part: "rca" as const })), model: "rules", at: new Date().toISOString() };
}
/** Step 2: the plan against the accepted root cause. */
function critiquePlan(f: Finding, r: Pick<Round, "root_cause" | "factors" | "immediate">, changes: Change[], actions: Action[]): Assistant {
  const pts: Point[] = [];
  const live = actions.filter((a) => a.status !== "cancelled"), ch = changes.filter((c) => c.status !== "removed");
  if (!live.length && !ch.length) pts.push({ code: "CAP_EMPTY", label: "No corrective action plan", detail: "Neither an expected manual change nor an action is attached." });
  else {
    if (live.length && live.every((a) => TRAINING_ONLY.test(a.title)) && !ch.length) pts.push({ code: "CAP_TRAINING_ONLY", label: "Plan limited to training / reminders", detail: "Reminding people rarely removes a cause; is a procedure, a tool or a check to change?" });
    const noDate = live.filter((a) => !a.due), noOwner = live.filter((a) => !a.owner_role && !a.owner_person);
    if (noDate.length) pts.push({ code: "ACTION_NO_DATE", label: `${noDate.length} action${noDate.length > 1 ? "s" : ""} without a date`, detail: noDate.map((a) => a.number).join(", ") });
    if (noOwner.length) pts.push({ code: "ACTION_NO_OWNER", label: `${noOwner.length} action${noOwner.length > 1 ? "s" : ""} without an owner`, detail: noOwner.map((a) => a.number).join(", ") });
    if (/\b(manual|procedure|OM|CAME|MSM|MOE|CAE|SMS)\b/i.test(`${f.requirement ?? ""} ${f.description ?? ""}`) && !ch.length) pts.push({ code: "CAP_NO_MANUAL", label: "No manual change planned", detail: "The finding refers to a documented procedure; is a manual to amend?" });
  }
  const rcW = words(r.root_cause), planW = words([...ch.map((c) => c.expected), ...live.map((a) => `${a.title} ${a.description ?? ""}`)].join(" "));
  if (rcW.size >= 8 && planW.size >= 8 && overlap(rcW, planW) < 0.08) pts.push({ code: "CAP_OFF_CAUSE", label: "Plan does not echo the cause", detail: "The actions share no term with the accepted root cause; check each one answers it." });
  const verdict: Assistant["verdict"] = pts.some((p) => p.code === "CAP_EMPTY") ? "incomplete" : "complete";
  void f;
  return { verdict, points: pts.map((q) => ({ ...q, part: "plan" as const })), model: "rules", at: new Date().toISOString() };
}

const PREREAD_SYSTEM = (stage: Stage, forNp: boolean) => `You are the assistant of a Compliance Monitoring Manager (EASA AOC / ATO / CAMO). You read a nominated person's answer to an audit finding${forNp ? ", BEFORE it is sent, to help the nominated person strengthen it" : ", for the compliance manager who decides"}.
Scope: ${stage === "rca" ? "the root cause only (one text). Do not comment on the plan, do not ask for separate contributing factors or immediate action" : stage === "plan" ? "the corrective action plan only (expected manual changes, actions), against the root cause given. Do not re-judge the root cause" : "both the root cause analysis and the corrective action plan"}.
Judge the ANALYSIS, never the person. Neutral, short, professional English, addressed ${forNp ? "to the author (\"you\")" : "to the compliance manager"}. Suggestions only.
Root cause checks: a cause (why the system allowed it) or a restatement of the symptom? why-chain followed far enough? organisational factor present in the text (procedure, training, resources, supervision, interface, tools)? cause placed on a person only? about this finding? Use the finding type, when given, to suggest where to look.
Plan checks: does each action address the cause (not only training / reminders)? manual or procedure change needed and planned? owner and realistic date on each action? part of the cause left without an action? a way to verify effectiveness?
Answer ONLY with JSON: {"verdict":"complete|incomplete|off_topic","points":[{"part":"rca|plan","code":"SHORT_CODE","label":"≤ 8 words","detail":"one sentence the author can act on"}]} — at most 6 points, none if the answer is sound.`;

/** Pre-reads a round with Claude when the key is there, otherwise with the rules; always returns something. */
export async function preRead(f: Finding, r: Pick<Round, "root_cause" | "factors" | "immediate" | "comment" | "n">, changes: Change[], actions: Action[], stage: Stage, forNp = false): Promise<Assistant> {
  const rules = critique(f, r, changes, actions, stage);
  if (!process.env.ANTHROPIC_API_KEY) return rules;
  try {
    const { callClaude } = await import("@/lib/ai");
    const user = `FINDING ${f.number} (${LEVEL_LABEL[f.level] ?? f.level}, ${f.requirement ?? "no reference"}${f.finding_type ? `, type ${TYPE_LABEL[f.finding_type] ?? f.finding_type}` : ""})\nTitle: ${f.title}\nText: ${f.description ?? "—"}\n\nROOT CAUSE ANALYSIS\nRoot cause: ${r.root_cause ?? "—"}\nContributing factors: ${r.factors ?? "—"}\nImmediate action: ${r.immediate ?? "—"}\n\nPLAN${stage === "rca" ? " (out of scope)" : r.comment ? ` — author's note: ${r.comment}` : ""}\nExpected manual changes: ${changes.length ? changes.map((c) => `${c.manual_code ?? "?"} ${c.section_ref ?? ""}: ${c.expected}`).join(" | ") : "none"}\nActions: ${actions.length ? actions.map((a) => `${a.number} ${a.title} (owner ${a.owner_role ?? a.owner_person ?? "none"}, due ${a.due ?? "none"})`).join(" | ") : "none"}`;
    const { text, model } = await callClaude({ agent: "check", personId: null, entity: f.entity, system: PREREAD_SYSTEM(stage, forNp), user, maxTokens: 1200 });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) return rules;
    const j = JSON.parse(m[0]) as { verdict?: string; points?: Point[] };
    const verdict = (["complete", "incomplete", "off_topic"].includes(j.verdict ?? "") ? j.verdict : rules.verdict) as Assistant["verdict"];
    return { verdict, points: (j.points ?? []).slice(0, 6).map((p) => ({ code: String(p.code ?? "NOTE").slice(0, 32), label: String(p.label ?? "").slice(0, 80), detail: String(p.detail ?? "").slice(0, 300), part: (p.part === "plan" ? "plan" : "rca") as "rca" | "plan" })), model, at: new Date().toISOString() };
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
  const n = extra?.points?.length;
  if (f.status === "open") want.push({ kind: "finding", title: `Answer ${head}`, detail: `${LEVEL_LABEL[f.level] ?? f.level}${f.requirement ? ` · ${f.requirement}` : ""}. Root cause (why the organisation let this happen), then the corrective action plan, then send both to Compliance. S.A.M. reads each part with you before sending.`, ...owner, due: f.due });
  if (f.status === "back") want.push({ kind: "finding", title: `Analysis sent back, ${n ?? "some"} point${(n ?? 2) === 1 ? "" : "s"} to address · ${head}`.slice(0, 200), detail: (extra?.points ?? []).map((p) => `• ${p.label}`).join("\n") || "Compliance asked for a complement; see the finding.", ...owner, due: f.due });
  if (f.status === "review") want.push({ kind: "finding_review", title: `Read the analysis · ${head}`, detail: "Root cause and corrective action plan received: accept both (the plan starts), or send back with the points to address.", ...cmm, due: today() });
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
    await db.from("tasks").insert({ entity: f.entity, kind: "finding_closure", title: `Closure proposed · ${f.number}, ${f.title}`.slice(0, 200), detail: "Every expected change is published and verified, every action is verified: request the closure from the finding.", ...owner, due: today(), status: "open", link: `/comp/find/${f.id}`, ref_id: f.id });
    n++;
  }
  return n;
}

/* ---------- FND-05 · the short answer from the Teams card ---------- */
export type TeamsAnswer = { root_cause: string | null; factors: string | null; immediate: string | null; plan: string | null };
/** The NP answers from the card: the root cause draft is saved and read by S.A.M. for the author; each line of the plan becomes a
 * corrective action of the finding (owner = the finding's owner, due = the finding's due date); "send" files the round for Compliance
 * exactly as the app does. Returns S.A.M.'s reading and what was created. */
export async function answerFromTeams(db: SupabaseClient, f: Finding, actor: { id: string; name: string }, a: TeamsAnswer, send: boolean): Promise<{ assistant: Assistant; actions: number; sent: boolean; error?: string }> {
  if (!["open", "back"].includes(f.status)) return { assistant: { verdict: "complete", points: [], model: "rules", at: new Date().toISOString() }, actions: 0, sent: false, error: "This finding is not being answered." };
  const draft = { draft_root_cause: a.root_cause ?? f.draft_root_cause, draft_factors: a.factors ?? f.draft_factors, draft_immediate: a.immediate ?? f.draft_immediate };
  if (!draft.draft_root_cause) return { assistant: { verdict: "incomplete", points: [{ code: "RC_EMPTY", label: "Root cause missing", detail: "Say why the organisation let this happen.", part: "rca" }], model: "rules", at: new Date().toISOString() }, actions: 0, sent: false, error: "Write the root cause." };
  let created = 0;
  const planLines = (a.plan ?? "").split(/\n+/).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter((x) => x.length > 3);
  for (const line of planLines) {
    const { nextActionNumber } = await import("@/lib/actions");
    const { ownerTaskRow } = await import("@/lib/actions-core");
    const number = await nextActionNumber(db, f.entity);
    const row = { entity: f.entity, number, module: "compliance", finding_id: f.id, kind: "corrective", title: line.slice(0, 300), owner_role: f.owner_person ? null : f.owner_role ?? "CMM", owner_person: f.owner_person, due: f.due, source_kind: "finding", created_by: actor.id };
    const { data } = await db.from("safety_actions").insert(row).select("*").single();
    if (data) { created++; await db.from("tasks").insert(ownerTaskRow(data as Action)); }
  }
  const [{ data: c }, { data: ac }] = await Promise.all([db.from("finding_changes").select("*").eq("finding_id", f.id).neq("status", "removed"), db.from("safety_actions").select("*").eq("finding_id", f.id).neq("status", "cancelled")]);
  const changes = (c ?? []) as Change[], actions = (ac ?? []) as Action[];
  const n = f.current_round + 1;
  const assistant = await preRead(f, { root_cause: draft.draft_root_cause, factors: draft.draft_factors, immediate: draft.draft_immediate, comment: null, n }, changes, actions, send ? "full" : "rca", !send);
  await db.from("findings").update({ ...draft, rca_check: send ? f.rca_check : assistant, draft_step: Math.max(f.draft_step, actions.length || changes.length ? 2 : 1), updated_at: new Date().toISOString() }).eq("id", f.id);
  if (!send) return { assistant, actions: created, sent: false };
  if (!changes.length && !actions.length) return { assistant, actions: created, sent: false, error: "Add at least one action (one per line in the plan) or an expected manual change before sending." };
  const { data: r } = await db.from("finding_rounds").insert({ finding_id: f.id, stage: "full", n, root_cause: draft.draft_root_cause, factors: draft.draft_factors, immediate: draft.draft_immediate, comment: null, answered_by: actor.id, via: "teams", assistant }).select("*").single();
  if (!r) return { assistant, actions: created, sent: false, error: "Answer not sent." };
  await db.from("findings").update({ status: "review", current_round: n, draft_step: 3, updated_at: new Date().toISOString() }).eq("id", f.id);
  const { data: nf } = await db.from("findings").select("*").eq("id", f.id).single();
  if (nf) await syncFindingTasks(db, nf as Finding);
  await db.from("audit_log").insert({ actor: actor.id, entity: f.entity, object_type: "finding", object_id: f.id, action: "finding_analysis_sent", after: { round: n, via: "teams", verdict: assistant.verdict, points: assistant.points.length, changes: changes.length, actions: actions.length } });
  return { assistant, actions: created, sent: true };
}

/* ---------- 10/11 · type of finding: S.A.M. proposes, the user changes; it steers the advice for writing the root cause ---------- */
export const TYPES = ["documentation", "procedure", "training", "records", "organisation", "oversight", "change", "subcontractor", "equipment"] as const;
export const TYPE_LABEL: Record<string, string> = {
  documentation: "Documentation (manual content)", procedure: "Procedure not applied", training: "Training & competence", records: "Records & traceability",
  organisation: "Organisation & resources", oversight: "Compliance monitoring & oversight", change: "Change & authority notification", subcontractor: "Subcontractor & contract", equipment: "Equipment, facilities, FSTD",
};
const TYPE_RULES: [string, RegExp][] = [
  ["change", /(?<![\p{L}\p{N}])(changement|modification au sein|notif|approbation|approval|change management|ORA\.GEN\.130|ORO\.GEN\.130|CAO\.A\.105|non soumis|soumettre|submitted|soumis à la DSAC|autorité)/iu],
  ["subcontractor", /(?<![\p{L}\p{N}])(sous[- ]?trait|subcontract|contrat|contract|prestataire|fournisseur|ORA\.GEN\.205|ORO\.GEN\.205)/iu],
  ["training", /(?<![\p{L}\p{N}])(formation|training|compétenc|competen|qualification|recyclage|instructeur|instructor|examinateur|FI(?![\p{L}])|FE(?![\p{L}])|connaissance par le personnel)/iu],
  ["records", /(?<![\p{L}\p{N}])(enregistrement|record|archiv|traçab|tracab|dossier|log ?book|carnet|signature|preuve|evidence)/iu],
  ["equipment", /(?<![\p{L}\p{N}])(FSTD|simulat|équipement|equipment|installation|facilit|outillage|tool|étalonnage|calibration|ORA\.FSTD)/iu],
  ["oversight", /(?<![\p{L}\p{N}])(surveillance|audit|conformité|compliance monitoring|programme d'audit|revue|review|ORA\.GEN\.200|ORO\.GEN\.200|management system|système de gestion|instances|comité)/iu],
  ["organisation", /(?<![\p{L}\p{N}])(organisation|organigramme|ressource|resource|effectif|staffing|responsable|nominated|personnel désigné|ORA\.GEN\.210|ORO\.GEN\.210)/iu],
  ["documentation", /(?<![\p{L}\p{N}])(manuel|manual|MSM|OM-?[A-D]|TM-|CAE|MOE|CAME|documentation|document|chapitre|section|incomplet|non à jour|not up to date|missing in the)/iu],
  ["procedure", /(?<![\p{L}\p{N}])(procédure|procedure|non respect|not followed|not applied|appliqu|process)/iu],
];
/** S.A.M.'s proposal: the first family whose words appear in the title, text or rule cited. A guess, shown as such. */
export function guessType(f: Pick<Finding, "title" | "description" | "requirement">): string {
  const t = `${f.title} ${f.description ?? ""} ${f.requirement ?? ""}`;
  let best = "procedure", n = 0;
  for (const [k, re] of TYPE_RULES) { const m = (t.match(new RegExp(re.source, "giu")) ?? []).length; if (m > n) { best = k; n = m; } }
  return best;
}
/** Where to look when writing the root cause, per type: questions, never an answer. */
export const TYPE_GUIDE: Record<string, { look: string[]; avoid: string }> = {
  documentation: { look: ["Who owns this part of the manual, and how is it kept up to date when the rule or the practice changes?", "Was the regulatory change seen (regulatory watch) and was the manual revision planned?", "Is the review of the manual before submission checking this content?"], avoid: "« The manual was not up to date » restates the finding: say why the revision process did not catch it." },
  procedure: { look: ["Is the procedure written, known, and workable in real conditions (time, roster, tools)?", "Who checks that it is applied, and how often?", "Did a recent change (people, organisation, tool) break the way it used to be done?"], avoid: "« The person did not follow the procedure » is the symptom: what made not following it possible or easier?" },
  training: { look: ["Is the training requirement defined for this function, with a recurrence?", "Who tracks the validity, and does a reminder exist before expiry?", "Was the content of the training adapted to this task?"], avoid: "« Lack of training » alone: say why the training was missing (not planned, not tracked, not defined)." },
  records: { look: ["Is the record defined (form, who fills it, where it is kept, for how long)?", "Is the record checked by someone after it is filled?", "Is the tool (paper, Centrik, Monday, S.A.M.) helping or making it easy to skip?"], avoid: "« Record missing » restates the finding: why does the process allow it to go missing?" },
  organisation: { look: ["Are the responsibilities written and known (job description, nominated person, deputy)?", "Are the resources sized for the workload, including absences?", "Is the interface between the departments involved defined?"], avoid: "Pointing at a person or a vacancy alone: say what in the organisation left the gap open." },
  oversight: { look: ["Is this area in the audit / compliance-check programme, with the right frequency?", "Were earlier signals (previous findings, checks) followed up?", "Do the management system meetings (CODIR, SRB, reviews) look at it?"], avoid: "« Not audited » restates the finding: why was it out of the programme or the review?" },
  change: { look: ["Was the change identified as a change (management of change procedure)?", "Who decides whether the authority must approve or be notified, and on what basis?", "Is there a checklist / tracking of the documents to submit before the change takes effect?"], avoid: "« Forgot to notify » is the symptom: why did the process not stop the change until the authority was involved?" },
  subcontractor: { look: ["Is there a contract, and does it cover the requirement (access for the authority, Part-IS, quality)?", "Is the subcontractor in the control plan, and was it controlled?", "Who in the organisation follows the subcontractor day to day?"], avoid: "Blaming the subcontractor alone: our oversight of the subcontractor is the cause to examine." },
  equipment: { look: ["Is the maintenance / qualification plan of the equipment defined and followed?", "Who monitors the due dates (calibration, FSTD recurrent evaluation)?", "Was a deviation known and accepted without a decision traced?"], avoid: "« The equipment was out of date » restates the finding: why did the follow-up not catch it?" },
};
