"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ercValue, isSafetyDesk } from "@/lib/safety";
import { runAnalysis } from "@/lib/safety-analysis";

async function desk(id: string) {
  const s = await getSession();
  if (!s || !isSafetyDesk(s)) throw new Error("Reserved to the Safety Manager / FSO / Compliance.");
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("id,entity,status,reporter_person,anonymous").eq("id", id).maybeSingle();
  const r = data as { id: string; entity: string; status: string; reporter_person: string | null; anonymous: boolean } | null;
  if (!r || !s.entities.includes(r.entity)) throw new Error("Report not found in your scope.");
  return { s, db, r };
}
const done = (id: string) => { revalidatePath(`/safe/reports/${id}`); revalidatePath("/safe/reports"); revalidatePath("/safe/mine"); revalidatePath("/home/tasks"); };
const ev = (db: ReturnType<typeof supabaseAdmin>, id: string, actor: string | null, kind: string, note: string, toReporter = false, meta: Record<string, unknown> | null = null) =>
  db.from("report_events").insert({ report_id: id, kind, actor, note, to_reporter: toReporter, meta });

/** Opening the report as SM / FSO acknowledges it (once). */
export async function acknowledge(id: string) {
  const { s, db, r } = await desk(id);
  if (r.status !== "received") return;
  await db.from("reports").update({ status: "acknowledged", acknowledged_at: new Date().toISOString() }).eq("id", id);
  await ev(db, id, s.person?.id ?? null, "acknowledged", "Acknowledged by the Safety Manager", true);
}

export async function setErc(fd: FormData) {
  const id = String(fd.get("id")); const outcome = String(fd.get("outcome")); const barriers = String(fd.get("barriers"));
  const { s, db } = await desk(id);
  const v = ercValue(outcome, barriers); if (v == null) return;
  await db.from("report_analysis").upsert({ report_id: id, erc_outcome: outcome, erc_barriers: barriers, erc_value: v, erc_override_by: s.person?.id ?? null }, { onConflict: "report_id" });
  await ev(db, id, s.person?.id ?? null, "erc", `ERC set to ${v} (${outcome} · barriers ${barriers.replace("_", " ")})`);
  done(id);
}

/** The SM confirms the classification: MOR decision (mandatory / voluntary) and ERC — the Inbox item closes. */
export async function classify(fd: FormData) {
  const id = String(fd.get("id")); const mor = String(fd.get("mor")); const basis = String(fd.get("basis") ?? "").trim();
  const { s, db } = await desk(id);
  if (!["mandatory", "voluntary"].includes(mor)) return;
  await db.from("report_analysis").upsert({ report_id: id, mor_status: mor, mor_basis: basis || null, confirmed_at: new Date().toISOString(), confirmed_by: s.person?.id ?? null }, { onConflict: "report_id" });
  await db.from("reports").update({ status: "classified", classified_at: new Date().toISOString() }).eq("id", id);
  await ev(db, id, s.person?.id ?? null, "status", mor === "mandatory" ? "Classified — mandatory occurrence report (MOR) to file" : "Classified — kept as a voluntary report (not a mandatory occurrence)", true);
  if (mor === "voluntary") await db.from("tasks").update({ status: "done" }).eq("kind", "safety_report").eq("link", `/safe/reports/${id}`).eq("status", "open");
  done(id);
}

export async function recordMor(fd: FormData) {
  const id = String(fd.get("id")); const ref = String(fd.get("ref") ?? "").trim();
  const { s, db } = await desk(id);
  if (!ref) return;
  await db.from("reports").update({ mor_ref: ref, mor_filed_at: new Date().toISOString() }).eq("id", id);
  await ev(db, id, s.person?.id ?? null, "mor", `MOR filed with the authority — ${ref}`, true);
  await db.from("tasks").update({ status: "done" }).eq("kind", "safety_report").eq("link", `/safe/reports/${id}`).eq("status", "open");
  done(id);
}

export async function askReporter(fd: FormData) {
  const id = String(fd.get("id")); const q = String(fd.get("question") ?? "").trim();
  const { s, db, r } = await desk(id);
  if (!q || !r.reporter_person) return;
  await ev(db, id, s.person?.id ?? null, "question", q, true);
  await db.from("tasks").insert({ entity: r.entity, kind: "safety_question", title: `Question from the Safety Manager on your report ${id}`, detail: q.slice(0, 200), owner_person: r.reporter_person, status: "open", link: "/safe/mine" });
  done(id);
}

/** Reporter side (My reports): answer a question of the SM. */
export async function answerQuestion(fd: FormData) {
  const id = String(fd.get("report")); const q = Number(fd.get("q")); const a = String(fd.get("answer") ?? "").trim();
  const s = await getSession(); if (!s?.person || !a) return;
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("reporter_person").eq("id", id).maybeSingle();
  if ((data as { reporter_person: string | null } | null)?.reporter_person !== s.person.id) return;
  await ev(db, id, s.person.id, "answer", a, true, { answered: q });
  await db.from("tasks").update({ status: "done" }).eq("kind", "safety_question").eq("owner_person", s.person.id).eq("link", "/safe/mine").eq("status", "open");
  done(id);
}

export async function sendFeedback(fd: FormData) {
  const id = String(fd.get("id")); const t = String(fd.get("feedback") ?? "").trim();
  const { s, db } = await desk(id);
  if (!t) return;
  await db.from("reports").update({ feedback: t, feedback_sent_at: new Date().toISOString() }).eq("id", id);
  await ev(db, id, s.person?.id ?? null, "feedback", t, true);
  done(id);
}

export async function setReportStatus(fd: FormData) {
  const id = String(fd.get("id")); const st = String(fd.get("status"));
  const { s, db } = await desk(id);
  if (!["investigation", "closed"].includes(st)) return;
  await db.from("reports").update({ status: st, closed_at: st === "closed" ? new Date().toISOString() : null }).eq("id", id);
  await ev(db, id, s.person?.id ?? null, st === "closed" ? "closed" : "status", st === "closed" ? "Closed" : "Under investigation", true);
  if (st === "closed") await db.from("tasks").update({ status: "done" }).eq("kind", "safety_report").eq("link", `/safe/reports/${id}`).eq("status", "open");
  done(id);
}

export async function rerunAnalysis(fd: FormData) {
  const id = String(fd.get("id"));
  await desk(id);
  await runAnalysis(id);
  done(id);
}
