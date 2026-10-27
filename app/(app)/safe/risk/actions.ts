"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { findDuplicates, logHazards, matchPending, matchReport } from "@/lib/risk-match";
import { addMonths, mayAccept, mayEditRisk, mayValidate, nextAssessmentNumber, nextHazardRef, postOf, schemeOf, tolerability, KINDS } from "@/lib/risk";

const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
const db = () => supabaseAdmin();
async function who(entity?: string, check: (s: Session) => boolean = mayEditRisk, msg = "Reserved to the Safety Manager, Compliance, the AM and the nominated persons.") {
  const s = await getSession();
  if (!s || !check(s)) throw new Error(msg);
  if (entity && !s.entities.includes(entity)) throw new Error("Entity outside your scope.");
  return s;
}
const log = (x: { hazard_id?: string | null; assessment_id?: string | null; kind: string; actor: string | null; note: string }) => db().from("risk_events").insert(x);
type HRow = { id: string; entity: string; assessment_id: string | null; proposed: boolean; report_id: string | null; ref: string; title: string };
async function hazardOf(id: string): Promise<HRow> {
  const { data } = await db().from("hazards").select("id,entity,assessment_id,proposed,report_id,ref,title").eq("id", id).maybeSingle();
  if (!data) throw new Error("Hazard not found.");
  return data as HRow;
}
type ARow = { id: string; entity: string; kind: string; number: string; name: string; status: string; moc_status: string | null; project_id: string | null; project_task_id: string | null; owner_role: string | null; decision: string | null; participants: unknown[] };
async function raOf(id: string): Promise<ARow> {
  const { data } = await db().from("risk_assessments").select("id,entity,kind,number,name,status,moc_status,project_id,project_task_id,owner_role,decision,participants").eq("id", id).maybeSingle();
  if (!data) throw new Error("Risk assessment not found.");
  return data as ARow;
}
const touchRa = (id: string | null) => { if (id) revalidatePath(`/safe/risk/a/${id}`); revalidatePath("/safe/risk"); revalidatePath("/safe/moc"); };
const touchH = (h: { id: string; assessment_id: string | null }) => { revalidatePath(`/safe/risk/${h.id}`); touchRa(h.assessment_id); };
const parseParticipants = (t: string | null) => (t ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [name, ...r] = l.split(/\s+[—–-]\s+|\s*,\s*/); return { name: name.trim(), role: r.join(" ").trim() }; });

// ── Risk assessments (hazard log entries, MOC, one-off RA) ────────────────
export async function createAssessment(fd: FormData) {
  const entity = str(fd, "entity") ?? ""; const s = await who(entity);
  const name = str(fd, "name"); if (!name) return;
  const kind = ["hazard_log", "moc", "ra"].includes(str(fd, "kind") ?? "") ? str(fd, "kind")! : "ra";
  const domain = str(fd, "domain");
  const number = str(fd, "number") ?? await nextAssessmentNumber(db(), entity, kind, domain);
  const project = str(fd, "project_id"); const task = str(fd, "project_task_id");
  const row = { entity, kind, number, name, domain, description: str(fd, "description"), owner_role: str(fd, "owner_role") ?? (kind === "moc" ? "SM" : null), next_due: kind === "moc" ? null : addMonths(12), conducted_on: new Date().toISOString().slice(0, 10),
    participants: parseParticipants(str(fd, "participants")), moc_status: kind === "moc" ? "assessment" : null, category: str(fd, "category"), change_type: str(fd, "change_type"), start_date: str(fd, "start_date"), reason: str(fd, "reason"), requestor: str(fd, "requestor"),
    project_id: project, project_task_id: task, authority_file_id: str(fd, "authority_file_id"), created_by: s.person?.id ?? null };
  const { data, error } = await db().from("risk_assessments").insert(row).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "not created");
  const id = (data as { id: string }).id;
  if (task) await db().from("project_tasks").update({ link_kind: "moc", link_id: id, status: "in_progress", updated_at: new Date().toISOString() }).eq("id", task);
  await log({ assessment_id: id, kind: "created", actor: s.person?.id ?? null, note: `${number} opened (${KINDS[kind]})` });
  // created from a safety report: the hazard comes with it
  const report = str(fd, "report_id"); const hz = str(fd, "hazard_title");
  if (report && hz) await insertHazard(s, { entity, assessment_id: id, title: hz, report_id: report });
  touchRa(null); if (project) revalidatePath(`/proj/boards/${project}`);
  redirect(`/safe/risk/a/${id}`);
}

const FIELDS = ["name", "description", "domain", "owner_role", "next_due", "decision", "decision_comment", "category", "change_type", "start_date", "end_date", "reason", "requestor", "affected", "criticality", "prior_assessments", "actions_in_place", "authority_route"];
export async function updateAssessment(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  if (ra.status !== "draft") throw new Error("Reopen the assessment (new version) before changing it.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of FIELDS) if (fd.has(k)) patch[k] = str(fd, k);
  if (fd.has("participants")) patch.participants = parseParticipants(str(fd, "participants"));
  if (fd.has("top_risk")) patch.top_risk = fd.get("top_risk") === "1";
  if (!patch.name) delete patch.name;
  await db().from("risk_assessments").update(patch).eq("id", ra.id);
  await log({ assessment_id: ra.id, kind: "updated", actor: s.person?.id ?? null, note: "Details updated" });
  touchRa(ra.id);
}

/** Accepted: MOC approved (or cancelled on Stop), linked project task done, AM task closed. */
async function finalise(ra: ARow, decision: string, patch: Record<string, unknown>) {
  const p: Record<string, unknown> = { ...patch, status: "accepted", decision, updated_at: new Date().toISOString() };
  if (ra.kind === "moc") p.moc_status = decision === "stop" ? "cancelled" : "approved";
  await db().from("risk_assessments").update(p).eq("id", ra.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "risk_acceptance").eq("ref_id", ra.id).eq("status", "open");
  if (ra.project_task_id && decision !== "stop") await db().from("project_tasks").update({ status: "done", done_at: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq("id", ra.project_task_id).neq("status", "done");
  if (ra.project_id) revalidatePath(`/proj/boards/${ra.project_id}`);
  if (decision !== "stop" && ra.kind !== "hazard_log") await pushToLog(ra);
}

/** A MOC / RA accepted: each log hazard it is linked to gets a reassessment (its rating in the log stays signed until its own new version). */
async function pushToLog(ra: ARow) {
  const { data } = await db().from("hazards").select("id,ref,title,lik_after,sev_after,log_hazard_id").eq("assessment_id", ra.id).eq("proposed", false).not("log_hazard_id", "is", null);
  for (const h of (data ?? []) as { id: string; ref: string; title: string; lik_after: number | null; sev_after: string | null; log_hazard_id: string }[]) {
    const { data: lh } = await db().from("hazards").select("id,ref,title,entity,assessment_id,lik_after,sev_after").eq("id", h.log_hazard_id).maybeSingle();
    const L = lh as { id: string; ref: string; title: string; entity: string; assessment_id: string | null; lik_after: number | null; sev_after: string | null } | null; if (!L) continue;
    const same = L.lik_after === h.lik_after && L.sev_after === h.sev_after;
    const note = `${KINDS[ra.kind]} ${ra.number} accepted — its residual rating ${h.lik_after ?? "?"}${h.sev_after ?? "?"} vs ${L.lik_after ?? "?"}${L.sev_after ?? "?"} in the log${same ? " (same)" : ""}`;
    await log({ hazard_id: L.id, assessment_id: L.assessment_id, kind: "study", actor: null, note });
    if (same) continue;
    await db().from("hazards").update({ needs_review: true }).eq("id", L.id);
    await db().from("tasks").insert({ entity: L.entity, kind: "risk_review", title: `Reassess ${L.ref} after ${ra.number}`.slice(0, 200), detail: note, owner_role: "SM", status: "open", link: `/safe/risk/${L.id}`, ref_id: L.id });
    revalidatePath(`/safe/risk/${L.id}`);
  }
}

/** Electronic sign-off by the most relevant NP (or deputy / SM) — MSM rule: green / yellow residual risks are accepted by this sign-off;
 *  a residual risk that stays red goes to the Accountable Manager, unless the decision is Stop. */
export async function validateAssessment(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity, mayValidate, "Validation is made by the most relevant nominated person, his/her deputy or the Safety Manager.");
  const decision = str(fd, "decision") ?? ra.decision;
  const { data: hz } = await db().from("hazards").select("proposed,lik_after,sev_after,status").eq("assessment_id", ra.id);
  const hs = ((hz ?? []) as { proposed: boolean; lik_after: number | null; sev_after: string | null; status: string }[]).filter((h) => h.status !== "closed");
  if (!hs.length || hs.some((h) => h.proposed || !h.lik_after || !h.sev_after)) throw new Error("Every hazard must be kept and rated after mitigation before the sign-off.");
  if (!decision) throw new Error("Choose the decision (continue / continue with conditions / stop).");
  const red = hs.some((h) => tolerability(h.lik_after, h.sev_after, schemeOf(ra.entity)) === "intolerable");
  const signed = { decision_comment: str(fd, "decision_comment"), validated_by: s.person?.id ?? null, validated_name: s.name, validated_role: postOf(s), validated_at: new Date().toISOString(), accepted_by: null, accepted_name: null, accepted_at: null };
  if (red && decision !== "stop") {
    await db().from("risk_assessments").update({ ...signed, status: "validated", decision, updated_at: new Date().toISOString() }).eq("id", ra.id);
    await log({ assessment_id: ra.id, kind: "validated", actor: s.person?.id ?? null, note: `Signed off by ${s.name} (${postOf(s)}) — ${decision.replace(/_/g, " ")} — residual risk red: referred to the Accountable Manager` });
    await db().from("tasks").insert({ entity: ra.entity, kind: "risk_acceptance", title: `Red residual risk — decide on ${ra.number} ${ra.name}`.slice(0, 200), detail: "The residual risk stays red: approve the activity anyway (with justification) or stop it (MSM §3.5.3 / §3.4).", owner_role: "AM", status: "open", link: `/safe/risk/a/${ra.id}`, ref_id: ra.id });
  } else {
    await finalise(ra, decision, signed);
    await log({ assessment_id: ra.id, kind: "accepted", actor: s.person?.id ?? null, note: `Signed off and accepted by ${s.name} (${postOf(s)}) — ${decision.replace(/_/g, " ")}` });
  }
  touchRa(ra.id);
}

/** Accountable Manager's decision on a red residual risk: forced approval (justification required) or stop. */
export async function acceptAssessment(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity, mayAccept, "The decision on a red residual risk rests with the Accountable Manager.");
  if (ra.status !== "validated") throw new Error("Only an assessment whose residual risk stays red waits for the Accountable Manager.");
  const stop = fd.get("verdict") === "stop"; const comment = str(fd, "comment");
  if (!stop && !comment) throw new Error("Give the justification for approving a red residual risk.");
  await finalise(ra, stop ? "stop" : (ra.decision ?? "continue_with_conditions"), { accepted_by: s.person?.id ?? null, accepted_name: s.name, accepted_at: new Date().toISOString() });
  await log({ assessment_id: ra.id, kind: "accepted", actor: s.person?.id ?? null, note: stop ? `Stopped by the AM (${s.name})${comment ? " — " + comment : ""}` : `Red residual risk approved by the AM (${s.name}) — ${comment}` });
  touchRa(ra.id);
}

/** Reopen = new version (Centrik "Copy new version"): back to draft, sign-offs cleared, history kept in the journal. */
export async function reopenAssessment(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  const { data } = await db().from("risk_assessments").select("version").eq("id", ra.id).single();
  const v = ((data as { version: number } | null)?.version ?? 1) + 1;
  await db().from("risk_assessments").update({ status: "draft", version: v, validated_by: null, validated_name: null, validated_role: null, validated_at: null, accepted_by: null, accepted_name: null, accepted_at: null, conducted_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq("id", ra.id);
  const why = str(fd, "comment");
  await log({ assessment_id: ra.id, kind: "new_version", actor: s.person?.id ?? null, note: `Version ${v} opened for review${mayAccept(s) ? " by the AM" : ""}${why ? " — " + why : ""}` });
  touchRa(ra.id);
}

export async function mocStep(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  const to = String(fd.get("to"));
  if (!["implemented", "closed", "cancelled"].includes(to) || ra.kind !== "moc") return;
  if (to === "implemented" && ra.status !== "accepted") throw new Error("The MOC must be completed and accepted before the change is implemented (MSM §3.4).");
  await db().from("risk_assessments").update({ moc_status: to, status: to === "cancelled" ? "cancelled" : ra.status, updated_at: new Date().toISOString() }).eq("id", ra.id);
  await log({ assessment_id: ra.id, kind: "status", actor: s.person?.id ?? null, note: { implemented: "Change implemented", closed: "MOC closed", cancelled: "MOC cancelled" }[to]! });
  touchRa(ra.id);
}

// ── Hazards ──────────────────────────────────────────────────────────────
async function insertHazard(s: Session, x: { entity: string; assessment_id: string; title: string; consequence?: string | null; description?: string | null; owner_role?: string | null; report_id?: string | null }) {
  const ref = await nextHazardRef(db(), x.entity);
  const { data } = await db().from("hazards").insert({ entity: x.entity, ref, title: x.title, consequence: x.consequence ?? null, description: x.description ?? null, owner_role: x.owner_role ?? null, assessment_id: x.assessment_id, source: x.report_id ? "report" : "other", report_id: x.report_id ?? null, review_date: addMonths(12), created_by: s.person?.id ?? null }).select("id").single();
  const id = (data as { id: string } | null)?.id;
  if (id && x.report_id) {
    await db().from("hazard_reports").upsert({ hazard_id: id, report_id: x.report_id });
    await db().from("report_events").insert({ report_id: x.report_id, kind: "risk", actor: s.person?.id ?? null, note: `Added to the risk register as ${ref}` });
  }
  if (id) await log({ hazard_id: id, assessment_id: x.assessment_id, kind: "created", actor: s.person?.id ?? null, note: `${ref} added` });
  return id;
}
export async function createHazard(fd: FormData) {
  const raId = str(fd, "assessment_id"); if (!raId) return;
  const ra = await raOf(raId); const s = await who(ra.entity);
  const title = str(fd, "title"); if (!title) return;
  const id = await insertHazard(s, { entity: ra.entity, assessment_id: ra.id, title, consequence: str(fd, "consequence"), description: str(fd, "description"), owner_role: str(fd, "owner_role"), report_id: str(fd, "report_id") });
  if (id && ra.kind !== "hazard_log") after(() => matchPending(ra.entity, s.person?.id ?? null, { hazardIds: [id] }).then(() => {}, () => {})); // is it already in the hazard log?
  touchRa(ra.id);
  if (fd.get("stay")) return;
  if (id) redirect(`/safe/risk/${id}`);
}

/** A safety report is linked to an existing hazard: the hazard must be reassessed (MSM §3.5.1). */
export async function linkReport(fd: FormData) {
  const h = await hazardOf(String(fd.get("hazard_id"))); const s = await who(h.entity);
  const report = String(fd.get("report_id"));
  await db().from("hazard_reports").upsert({ hazard_id: h.id, report_id: report });
  await db().from("hazards").update({ needs_review: true }).eq("id", h.id);
  await db().from("report_events").insert({ report_id: report, kind: "risk", actor: s.person?.id ?? null, note: `Linked to hazard ${h.ref} — ${h.title}` });
  await db().from("tasks").insert({ entity: h.entity, kind: "risk_review", title: `Reassess ${h.ref} after safety report ${report}`, detail: h.title, owner_role: "SM", status: "open", link: `/safe/risk/${h.id}`, ref_id: h.id });
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "occurrence", actor: s.person?.id ?? null, note: `Safety report ${report} linked — reassessment due` });
  touchH(h); revalidatePath(`/safe/reports/${report}`);
}
export async function reviewedNoChange(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  await db().from("hazards").update({ needs_review: false, updated_at: new Date().toISOString() }).eq("id", h.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "risk_review").eq("ref_id", h.id).eq("status", "open");
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "reviewed", actor: s.person?.id ?? null, note: `Reassessed: ${str(fd, "note") ?? "no change to the risk values"}` });
  touchH(h);
}

export async function updateHazard(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "description", "consequence", "main_impact", "owner_role", "review_date"]) if (fd.has(k)) patch[k] = str(fd, k);
  if (fd.has("status")) { const st = str(fd, "status"); if (st && ["open", "monitoring", "closed"].includes(st)) patch.status = st; }
  if (fd.has("title") && !patch.title) delete patch.title;
  await db().from("hazards").update({ ...patch, proposed: false }).eq("id", h.id);
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "updated", actor: s.person?.id ?? null, note: fd.has("status") ? `Status: ${patch.status}` : "Details updated" });
  touchH(h);
}

export async function setRating(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  const which = fd.get("which") === "after" ? "after" : "before"; const lik = Number(fd.get("lik")); const sev = String(fd.get("sev"));
  if (!(lik >= 1 && lik <= 5) || !/^[A-E]$/.test(sev)) return;
  await db().from("hazards").update({ [`lik_${which}`]: lik, [`sev_${which}`]: sev, proposed: false, needs_review: false, updated_at: new Date().toISOString() }).eq("id", h.id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "risk_review").eq("ref_id", h.id).eq("status", "open");
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "rating", actor: s.person?.id ?? null, note: `${which === "before" ? "Pre-mitigation" : "Post-mitigation"} risk set to ${lik}${sev} (${tolerability(lik, sev, schemeOf(h.entity))})` });
  touchH(h);
}

export async function keepHazard(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  await db().from("hazards").update({ proposed: false }).eq("id", h.id);
  const { data: ms } = await db().from("hazard_mitigations").select("text,owner_role,due").eq("hazard_id", h.id).eq("existing", false).is("done_at", null).not("owner_role", "is", null);
  for (const x of (ms ?? []) as { text: string; owner_role: string; due: string | null }[])
    await db().from("tasks").insert({ entity: h.entity, kind: "mitigation", title: `Mitigation — ${x.text.slice(0, 120)}`, detail: `${h.ref} · ${h.title}`, due: x.due, owner_role: x.owner_role, status: "open", link: `/safe/risk/${h.id}`, ref_id: h.id });
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "kept", actor: s.person?.id ?? null, note: "Proposed hazard kept" });
  touchH(h);
}
/** Only a hazard proposed by SAM and not kept yet can be discarded; anything else is closed, never deleted. */
export async function discardHazard(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); await who(h.entity);
  if (!h.proposed) return;
  await db().from("hazards").delete().eq("id", h.id);
  touchH(h);
}

export async function addMitigation(fd: FormData) {
  const h = await hazardOf(String(fd.get("hazard_id"))); const s = await who(h.entity);
  const text = str(fd, "text"); if (!text) return;
  const existing = fd.get("existing") === "1"; const owner = str(fd, "owner_role"); const due = str(fd, "due");
  await db().from("hazard_mitigations").insert({ hazard_id: h.id, text, existing, owner_role: owner, due });
  if (!existing && owner) await db().from("tasks").insert({ entity: h.entity, kind: "mitigation", title: `Mitigation — ${text.slice(0, 120)}`, detail: `${h.ref} · ${h.title}`, due, owner_role: owner, status: "open", link: `/safe/risk/${h.id}`, ref_id: h.id });
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "mitigation", actor: s.person?.id ?? null, note: `${existing ? "Current mitigation" : "Planned mitigation"}: ${text}${owner ? ` (${owner}${due ? `, by ${due}` : ""})` : ""}` });
  touchH(h);
}
export async function doneMitigation(fd: FormData) {
  const id = String(fd.get("id"));
  const { data } = await db().from("hazard_mitigations").select("id,hazard_id,text").eq("id", id).maybeSingle();
  const m = data as { id: string; hazard_id: string; text: string } | null; if (!m) return;
  const h = await hazardOf(m.hazard_id); const s = await who(h.entity);
  await db().from("hazard_mitigations").update({ done_at: new Date().toISOString() }).eq("id", id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "mitigation").eq("ref_id", h.id).eq("status", "open").like("title", `%${m.text.slice(0, 60).replace(/[%_]/g, "")}%`);
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "mitigation_done", actor: s.person?.id ?? null, note: `In place: ${m.text}` });
  touchH(h);
}

/** SAM proposes the hazards of an assessment (change or activity), rated before / after with mitigations; each stays "proposed" until kept. */
export async function proposeHazards(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  const { data: full } = await db().from("risk_assessments").select("description,reason,affected,category,domain").eq("id", ra.id).single();
  const f = full as { description: string | null; reason: string | null; affected: string | null; category: string | null; domain: string | null };
  const { data: ex } = await db().from("hazards").select("title").eq("assessment_id", ra.id);
  const sch = schemeOf(ra.entity);
  const lg = ra.kind === "hazard_log" ? [] : await logHazards(ra.entity);
  const { text } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity: ra.entity, maxTokens: 3500,
    system: `You help the Safety Manager of an EASA organisation (${ra.entity}) write a risk assessment (${KINDS[ra.kind]}) with the hazard–consequence method of its MSM: severity A Catastrophic, B Hazardous, C Major, D Minor, E Negligible; likelihood 5 Frequent, 4 Occasional, 3 Remote, 2 Improbable, 1 Extremely improbable; consider the "reasonably worst case", not systematically the extreme one. ${sch === "centrik" ? "Scores: green 1–10 acceptable, yellow 20–100 tolerable, red 300–2500 intolerable." : "ICAO tolerability table."} Propose 3 to 6 hazards SPECIFIC to this subject (not generic), each with its consequence, the initial rating, current mitigations (barriers already in place), planned mitigations with the post that owns them (AM, NPFO, NPCT, NPGO, NPCA, CMM, SM, HT, CFI, ISM…), and the residual rating. Prefer hard mitigations (engineering, control) over personnel ones when realistic.${lg.length ? " The organisation's hazard log is given: when a hazard you propose IS one of the log (same hazard, same context), give its ref in log_ref and start from its wording; otherwise leave log_ref empty." : ""} Plain English, no markdown. Answer ONLY JSON: {"hazards":[{"log_ref":"","title":"…","consequence":"…","lik_before":4,"sev_before":"C","existing":["…"],"mitigations":[{"text":"…","owner_role":"NPFO"}],"lik_after":2,"sev_after":"C"}]}`,
    user: JSON.stringify({ subject: ra.name, description: f.description, reason: f.reason, affected: f.affected, category: f.category, domain: f.domain, already_listed: ((ex ?? []) as { title: string }[]).map((x) => x.title), hazard_log: lg.length ? lg.map((h) => ({ ref: h.ref, hazard: h.title, consequence: h.consequence ?? undefined })) : undefined }) });
  const j = /\{[\s\S]*\}/.exec(text); if (!j) throw new Error("SAM did not return hazards.");
  const logRef = new Map(lg.map((h) => [h.ref, h.id]));
  type P = { log_ref?: string; title: string; consequence?: string; lik_before?: number; sev_before?: string; existing?: string[]; mitigations?: { text: string; owner_role?: string }[]; lik_after?: number; sev_after?: string };
  const list = ((JSON.parse(j[0]) as { hazards?: P[] }).hazards ?? []).slice(0, 6);
  const okL = (x?: number) => (x && x >= 1 && x <= 5 ? Math.round(x) : null); const okS = (x?: string) => (x && /^[A-E]$/.test(x) ? x : null);
  for (const p of list) {
    if (!p?.title) continue;
    const ref = await nextHazardRef(db(), ra.entity);
    const { data: h } = await db().from("hazards").insert({ entity: ra.entity, ref, title: p.title.slice(0, 200), consequence: p.consequence ?? null, source: ra.kind === "moc" ? "moc" : "other", assessment_id: ra.id, proposed: true, lik_before: okL(p.lik_before), sev_before: okS(p.sev_before), lik_after: okL(p.lik_after), sev_after: okS(p.sev_after), review_date: addMonths(12), created_by: s.person?.id ?? null, log_hazard_id: (p.log_ref && logRef.get(p.log_ref)) || null }).select("id").single();
    const hid = (h as { id: string } | null)?.id; if (!hid) continue;
    const rows = [...(p.existing ?? []).map((t) => ({ hazard_id: hid, text: t, existing: true })), ...(p.mitigations ?? []).map((x) => ({ hazard_id: hid, text: x.text, existing: false, owner_role: x.owner_role ?? null }))].filter((r) => r.text);
    if (rows.length) await db().from("hazard_mitigations").insert(rows);
  }
  await log({ assessment_id: ra.id, kind: "proposal", actor: s.person?.id ?? null, note: `${list.length} hazards proposed by SAM — to keep or discard` });
  touchRa(ra.id);
}

/** Settings › Integrations: a one-time import key (30 min) for the Centrik / FlightLogger export scripts. Shown once, stored hashed. */
export async function createImportToken(): Promise<{ token: string; expires: string }> {
  const s = await getSession();
  if (!s || s.role !== "cmm") throw new Error("Reserved to Compliance.");
  const { randomBytes, createHash } = await import("crypto");
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 30 * 60e3).toISOString();
  await db().from("import_tokens").insert({ token_hash: createHash("sha256").update(token).digest("hex"), purpose: "risk", created_by: s.person?.id ?? null, expires_at: expires });
  return { token, expires };
}


// ── Hazard log ⇄ studies (MOC / RA): link, keep local, add to the log; SAM suggestions ──────────────────────────────
const touchMatch = () => { revalidatePath("/safe/risk/match"); revalidatePath("/safe/risk"); revalidatePath("/safe/ra"); revalidatePath("/safe/moc"); };

export async function linkToLog(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  const L = await hazardOf(String(fd.get("log_id")));
  if (L.entity !== h.entity) throw new Error("The log hazard belongs to another entity.");
  await db().from("hazards").update({ log_hazard_id: L.id, local_only: false, updated_at: new Date().toISOString() }).eq("id", h.id);
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "linked", actor: s.person?.id ?? null, note: `Linked to the hazard log: ${L.ref} — ${L.title}` });
  await log({ hazard_id: L.id, assessment_id: L.assessment_id, kind: "linked", actor: s.person?.id ?? null, note: `Referenced by ${h.ref} — ${h.title}` });
  touchH(h); touchH(L); touchMatch();
}
export async function unlinkLog(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  await db().from("hazards").update({ log_hazard_id: null, local_only: false }).eq("id", h.id);
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "unlinked", actor: s.person?.id ?? null, note: "Link to the hazard log removed" });
  touchH(h); touchMatch();
}
export async function keepLocal(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  await db().from("hazards").update({ local_only: true, log_hazard_id: null }).eq("id", h.id);
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "local", actor: s.person?.id ?? null, note: "Kept local to this study (temporary hazard, not in the hazard log)" });
  touchH(h); touchMatch();
}
/** A study hazard that is lasting → new hazard log entry (draft) with the same rating and mitigations; the study hazard links to it. */
export async function promoteToLog(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  const { data: full } = await db().from("hazards").select("*,hazard_mitigations(text,existing,owner_role,due)").eq("id", h.id).single();
  const f = full as Record<string, unknown> & { hazard_mitigations: { text: string; existing: boolean; owner_role: string | null; due: string | null }[] };
  const { data: st } = h.assessment_id ? await db().from("risk_assessments").select("number,domain").eq("id", h.assessment_id).single() : { data: null };
  const study = st as { number: string; domain: string | null } | null;
  const number = await nextAssessmentNumber(db(), h.entity, "hazard_log", study?.domain);
  const { data: ra } = await db().from("risk_assessments").insert({ entity: h.entity, kind: "hazard_log", number, name: `HZ - ${h.title}`.slice(0, 160), domain: study?.domain ?? null, owner_role: (f.owner_role as string | null) ?? "SM", next_due: addMonths(12), conducted_on: new Date().toISOString().slice(0, 10), created_by: s.person?.id ?? null, description: study ? `Added to the hazard log from ${study.number}.` : null }).select("id").single();
  const raId = (ra as { id: string }).id;
  const ref = await nextHazardRef(db(), h.entity);
  const { data: nh } = await db().from("hazards").insert({ entity: h.entity, ref, title: h.title, consequence: f.consequence ?? null, description: f.description ?? null, main_impact: f.main_impact ?? null, owner_role: f.owner_role ?? null, assessment_id: raId, source: f.source ?? "other", lik_before: f.lik_before ?? null, sev_before: f.sev_before ?? null, lik_after: f.lik_after ?? null, sev_after: f.sev_after ?? null, review_date: addMonths(12), created_by: s.person?.id ?? null }).select("id").single();
  const nid = (nh as { id: string }).id;
  if (f.hazard_mitigations?.length) await db().from("hazard_mitigations").insert(f.hazard_mitigations.map((m) => ({ hazard_id: nid, text: m.text, existing: m.existing, owner_role: m.owner_role, due: m.due })));
  await db().from("hazards").update({ log_hazard_id: nid, local_only: false }).eq("id", h.id);
  await log({ assessment_id: raId, kind: "created", actor: s.person?.id ?? null, note: `${number} opened from ${study?.number ?? "a study"} (${h.ref})` });
  await log({ hazard_id: h.id, assessment_id: h.assessment_id, kind: "linked", actor: s.person?.id ?? null, note: `Added to the hazard log as ${ref} (${number}) — to be signed off` });
  touchH(h); touchMatch();
}
export async function suggestMatches(fd: FormData) {
  const s = await who(); const ents = str(fd, "entity") ? [str(fd, "entity")!] : (s.entity === "ALL" ? s.entities : [s.entity]);
  const only = str(fd, "hazard_id");
  for (const e of ents) await matchPending(e, s.person?.id ?? null, { force: fd.get("force") === "1", hazardIds: only ? [only] : undefined });
  if (str(fd, "assessment_id")) revalidatePath(`/safe/risk/a/${str(fd, "assessment_id")}`);
  touchMatch();
}
export async function checkDuplicates(fd: FormData) {
  const s = await who(); const ents = str(fd, "entity") ? [str(fd, "entity")!] : (s.entity === "ALL" ? s.entities : [s.entity]);
  for (const e of ents) await findDuplicates(e, s.person?.id ?? null);
  touchMatch();
}
export async function suggestForReport(fd: FormData) {
  const id = String(fd.get("report_id"));
  const { data } = await db().from("reports").select("id,entity,headline,headline_en,narrative,narrative_en,report_analysis(primary_hazard)").eq("id", id).single();
  const r = data as { id: string; entity: string; headline: string; headline_en: string | null; narrative: string; narrative_en: string | null; report_analysis: { primary_hazard: string | null } | { primary_hazard: string | null }[] | null };
  const s = await who(r.entity);
  const an = Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis;
  await matchReport({ id: r.id, entity: r.entity, headline: r.headline_en ?? r.headline, narrative: r.narrative_en ?? r.narrative, primary_hazard: an?.primary_hazard ?? null }, s.person?.id ?? null);
  revalidatePath(`/safe/reports/${id}`);
}
/** Drop one suggestion ("not the same hazard" / "not a duplicate"). */
export async function dismissMatch(fd: FormData) {
  const kind = String(fd.get("kind")); const subject = String(fd.get("subject")); const other = String(fd.get("other"));
  const { data } = await db().from("risk_matches").select("entity,suggestions").eq("subject_kind", kind).eq("subject_id", subject).maybeSingle();
  const m = data as { entity: string; suggestions: { id: string }[] } | null; if (!m) return;
  await who(m.entity);
  await db().from("risk_matches").update({ suggestions: m.suggestions.filter((x) => x.id !== other) }).eq("subject_kind", kind).eq("subject_id", subject);
  if (kind === "report") revalidatePath(`/safe/reports/${subject}`);
  touchMatch();
}
