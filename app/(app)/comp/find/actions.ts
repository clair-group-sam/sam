"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadFinding, nextFindingNumber, preRead, syncFindingTasks, type Finding, type Point } from "@/lib/findings";
import { createAuthorityFile } from "@/lib/authority-create";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const isCompliance = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
const isOwner = (s: Session, f: Finding) => (!!f.owner_person && f.owner_person === s.person?.id) || (!!f.owner_role && s.entities.includes(f.entity) && s.roles.map(basePost).includes(basePost(f.owner_role)));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
async function load(id: string) { const x = await loadFinding(db(), id); if (!x) throw new Error("Finding not found"); return x; }
const log = (f: Finding, action: string, actor: string | null, after: unknown) => db().from("audit_log").insert({ actor, entity: f.entity, object_type: "finding", object_id: f.id, action, after });
const touch = (id: string) => { revalidatePath(`/comp/find/${id}`); revalidatePath("/comp/find"); revalidatePath("/home/tasks"); };

/** Compliance raises a finding (from an authority letter, an internal audit, an inspection). The owner gets the Inbox task at once. */
export async function createFinding(fd: FormData) {
  const s = await me(); if (!isCompliance(s)) throw new Error("Compliance department only.");
  const entity = str(fd, "entity") ?? ""; if (!entity) throw new Error("Choose the entity.");
  const title = str(fd, "title"); if (!title) throw new Error("Give the finding a title.");
  if (!str(fd, "owner_role") && !str(fd, "owner_person")) throw new Error("Name the nominated person who answers (post or person).");
  const number = await nextFindingNumber(db(), entity);
  const row = { entity, number, source: str(fd, "source") ?? "authority", authority: str(fd, "authority"), audit_ref: str(fd, "audit_ref"), level: str(fd, "level") ?? "2", requirement: str(fd, "requirement"), title: title.slice(0, 300), description: str(fd, "description"),
    owner_role: str(fd, "owner_role")?.toUpperCase() ?? null, owner_person: str(fd, "owner_person"), notified: str(fd, "notified"), due: str(fd, "due"), status: "open", created_by: s.person?.id ?? null };
  const { data, error } = await db().from("findings").insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Finding not created.");
  const f = data as Finding;
  await syncFindingTasks(db(), f);
  await log(f, "finding_created", s.person?.id ?? null, row);
  touch(f.id);
  redirect(`/comp/find/${f.id}`);
}

const EDIT = ["title", "description", "requirement", "level", "source", "authority", "audit_ref", "notified", "due", "owner_role", "owner_person"] as const;
export async function updateFinding(fd: FormData) {
  const { f } = await load(String(fd.get("id"))); const s = await me(); if (!isCompliance(s)) throw new Error("Compliance department only.");
  const patch: Record<string, string | null> = {}; for (const k of EDIT) if (fd.has(k)) patch[k] = str(fd, k);
  if (patch.owner_role) patch.owner_role = patch.owner_role.toUpperCase();
  await db().from("findings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", f.id);
  const { f: nf } = await load(f.id); await syncFindingTasks(db(), nf);
  await log(f, "finding_updated", s.person?.id ?? null, patch); touch(f.id);
}

/** The NP answers (or completes after a send-back): a new round, pre-read by S.A.M. for Compliance. */
export async function answerFinding(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me();
  if (!isOwner(s, x.f) && !isCompliance(s)) throw new Error("Reserved to the owner of the finding.");
  if (!["open", "sent_back"].includes(x.f.status)) throw new Error("This finding is not waiting for an answer.");
  const n = x.f.current_round + 1;
  const row = { finding_id: x.f.id, n, root_cause: str(fd, "root_cause"), factors: str(fd, "factors"), immediate: str(fd, "immediate"), answered_by: s.person?.id ?? null, via: "app" };
  if (!row.root_cause) throw new Error("Write the root cause.");
  const { data, error } = await db().from("finding_rounds").insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Answer not saved.");
  const r = data as import("@/lib/findings").Round;
  const assistant = await preRead(x.f, r, x.changes, x.actions);
  await db().from("finding_rounds").update({ assistant }).eq("id", r.id);
  await db().from("findings").update({ status: "answered", current_round: n, updated_at: new Date().toISOString() }).eq("id", x.f.id);
  const { f } = await load(x.f.id); await syncFindingTasks(db(), f);
  await log(f, "finding_answered", s.person?.id ?? null, { round: n, verdict: assistant.verdict, points: assistant.points.length }); touch(f.id);
}

/** Compliance reads the answer: accept (plan starts) or send back with the points to address (ticked among S.A.M.'s suggestions + free note). */
export async function reviewAnswer(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me(); if (!isCompliance(s)) throw new Error("Compliance department only.");
  if (x.f.status !== "answered") throw new Error("Nothing to review.");
  const r = x.rounds.find((q) => q.n === x.f.current_round); if (!r) throw new Error("Round not found");
  const decision = str(fd, "decision") === "accept" ? "accepted" : "sent_back";
  const picked = fd.getAll("point").map(String);
  const points: Point[] = (r.assistant?.points ?? []).filter((p) => picked.includes(p.code));
  const note = str(fd, "note");
  if (note) points.push({ code: "NOTE", label: note.slice(0, 80), detail: note });
  if (decision === "sent_back" && !points.length) throw new Error("Say what is to be completed: tick at least one point or write a note.");
  await db().from("finding_rounds").update({ decision, points: decision === "sent_back" ? points : null, decided_by: s.person?.id ?? null, decided_at: new Date().toISOString(), note }).eq("id", r.id);
  await db().from("findings").update({ status: decision === "accepted" ? "accepted" : "sent_back", updated_at: new Date().toISOString() }).eq("id", x.f.id);
  const { f } = await load(x.f.id); await syncFindingTasks(db(), f, { points });
  await log(f, decision === "accepted" ? "finding_answer_accepted" : "finding_answer_sent_back", s.person?.id ?? null, { round: r.n, points }); touch(f.id);
}

/* ---------- the plan ---------- */
export async function addChange(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me();
  if (!isOwner(s, x.f) && !isCompliance(s)) throw new Error("Reserved to the owner of the finding.");
  const expected = str(fd, "expected"); if (!expected) throw new Error("Say what must change in the manual.");
  const manual = str(fd, "manual_id");
  let code = str(fd, "manual_code");
  if (manual) { const { data } = await db().from("manuals").select("code").eq("id", manual).maybeSingle(); code = (data as { code: string } | null)?.code ?? code; }
  await db().from("finding_changes").insert({ finding_id: x.f.id, manual_id: manual, manual_code: code, section_ref: str(fd, "section_ref"), expected });
  touch(x.f.id);
}
export async function removeChange(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me();
  if (!isOwner(s, x.f) && !isCompliance(s)) throw new Error("Not allowed");
  await db().from("finding_changes").update({ status: "removed" }).eq("id", String(fd.get("change"))).eq("finding_id", x.f.id).in("status", ["pending", "deferred"]);
  touch(x.f.id);
}
/** Compliance verifies a published change against the published text (FND-01). */
export async function verifyChange(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me(); if (!isCompliance(s)) throw new Error("Compliance department only.");
  const ok = str(fd, "verdict") === "ok";
  await db().from("finding_changes").update(ok ? { status: "verified", verified_at: new Date().toISOString(), verified_by: s.person?.id ?? null, verified_note: str(fd, "note") } : { status: "pending", revision_id: null, verified_note: str(fd, "note") }).eq("id", String(fd.get("change"))).eq("finding_id", x.f.id);
  touch(x.f.id);
}

/** The NP asks for the closure once the plan is done. */
export async function requestClosure(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me();
  if (!isOwner(s, x.f) && !isCompliance(s)) throw new Error("Reserved to the owner of the finding.");
  if (x.f.status !== "accepted") throw new Error("The plan must be accepted first.");
  await db().from("findings").update({ status: "closure_requested", updated_at: new Date().toISOString() }).eq("id", x.f.id);
  await db().from("tasks").update({ status: "done" }).eq("ref_id", x.f.id).eq("kind", "finding_closure").eq("status", "open");
  const { f } = await load(x.f.id); await syncFindingTasks(db(), f);
  await log(f, "finding_closure_requested", s.person?.id ?? null, null); touch(f.id);
}
/** Compliance closes (evidence checked), reopens the plan, or cancels. */
export async function decideClosure(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me(); if (!isCompliance(s)) throw new Error("Compliance department only.");
  const what = str(fd, "what"); const note = str(fd, "note");
  const now = new Date().toISOString();
  if (what === "close") await db().from("findings").update({ status: "closed", closed_at: now, closed_by: s.person?.id ?? null, closed_note: note, updated_at: now }).eq("id", x.f.id);
  else if (what === "cancel") { if (!s.roles.includes("SUPERADMIN") && !s.roles.includes("CMM")) throw new Error("Not allowed"); await db().from("findings").update({ status: "cancelled", closed_at: now, closed_by: s.person?.id ?? null, closed_note: note, updated_at: now }).eq("id", x.f.id); }
  else await db().from("findings").update({ status: "accepted", updated_at: now }).eq("id", x.f.id);
  const { f } = await load(x.f.id); await syncFindingTasks(db(), f);
  await log(f, `finding_${what ?? "reopened"}`, s.person?.id ?? null, { note }); touch(f.id);
}

/** Opens the OM-FND dossier (manual revision for finding closure) linked to this finding. */
export async function openDossier(fd: FormData) {
  const x = await load(String(fd.get("id"))); const s = await me(); if (!isCompliance(s)) throw new Error("Compliance department only.");
  if (x.f.authority_file_id) redirect(`/proj/auth/${x.f.authority_file_id}`);
  const f = await createAuthorityFile(db(), { personId: s.person?.id ?? null, name: s.name }, { entity: x.f.entity, type_code: "OM-FND", title: `${x.f.number} — ${x.f.title}`.slice(0, 200), trigger_kind: "finding", trigger_note: `${x.f.number} · ${x.f.requirement ?? ""}`.trim(), finding_ref: x.f.number, target_date: x.f.due });
  await db().from("findings").update({ authority_file_id: f.id, updated_at: new Date().toISOString() }).eq("id", x.f.id);
  touch(x.f.id);
  redirect(`/proj/auth/${f.id}`);
}
