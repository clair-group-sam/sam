"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { FORMS, isDesk, isForm, mayAssess, mayEdit, missingToSign, pointsFor, type Assessment, type Item } from "@/lib/competency";

const v = (fd: FormData, k: string) => { const x = String(fd.get(k) ?? "").trim(); return x || null; };
const log = (db: ReturnType<typeof supabaseAdmin>, actor: string | null, entity: string, id: string, action: string, after?: unknown) =>
  db.from("audit_log").insert({ actor, entity, object_type: "competency_assessment", object_id: id, action, after: after ?? null });

/** NP-03 · a new assessment: the person, the position, the form and the functions assessed. The points of the form are copied on it. */
export async function createAssessment(fd: FormData) {
  const s = await getSession(); if (!s || !mayAssess(s)) return;
  const entity = String(fd.get("entity") ?? ""); const form = String(fd.get("form") ?? "");
  if (!isForm(form) || (!s.group && !s.entities.includes(entity))) return;
  const functions = fd.getAll("functions").map(String).filter((c) => FORMS[form].functions.some((f) => f.code === c));
  const personId = v(fd, "person_id"); const kind = fd.get("kind") === "initial" ? "initial" : "recurrent";
  const db = supabaseAdmin();
  const { data: p } = personId ? await db.from("people").select("id,display_name,job_title").eq("id", personId).maybeSingle() : { data: null };
  const person = p as { id: string; display_name: string; job_title: string | null } | null;
  const name = person?.display_name ?? v(fd, "person_name");
  if (!name || !functions.length) redirect(`/np/assess?entity=${entity}&new=${form}&err=1`);
  // the date of the last assessment is the one S.A.M. holds for this person on this form
  const { data: prev } = await db.from("competency_assessments").select("assessed_on").eq("entity", entity).eq("form", form).eq("status", "signed").ilike("person_name", name!).order("assessed_on", { ascending: false }).limit(1);
  const last = ((prev ?? []) as { assessed_on: string | null }[])[0]?.assessed_on ?? null;
  const row = {
    entity, form, form_ref: FORMS[form].ref, form_edition: FORMS[form].edition, person_id: person?.id ?? null, person_name: name!, position: v(fd, "position") ?? person?.job_title ?? null,
    functions, kind, assessed_on: v(fd, "assessed_on"), last_assessed_on: last, assessor_id: s.person?.id ?? null, assessor_name: s.name,
    items: pointsFor(form, functions, kind, ENT[entity]?.name ?? entity), created_by: s.person?.id ?? null,
  };
  const { data: ins } = await db.from("competency_assessments").insert(row).select("id").single();
  const id = (ins as { id: string } | null)?.id; if (!id) return;
  await log(db, s.person?.id ?? null, entity, id, "assessment_created", { person: name, form: row.form_ref, functions });
  revalidatePath("/np/assess"); redirect(`/np/assess/${id}`);
}

async function load(id: string) { const db = supabaseAdmin(); const { data } = await db.from("competency_assessments").select("*").eq("id", id).maybeSingle(); return { db, a: data as Assessment | null }; }

/** Save the sheet: header, each level and remark, the outcome, page 3. With "sign", the assessor signs it when nothing is missing. */
export async function saveAssessment(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || !mayEdit(s, a)) return;
  const items: Item[] = a.items.map((i) => { const l = Number(fd.get(`l_${i.k}`) ?? 0); return { ...i, level: l >= 1 && l <= 4 ? l : null, remark: v(fd, `r_${i.k}`) }; });
  const outcome = v(fd, "outcome"); const assessorId = v(fd, "assessor_id");
  const { data: ap } = assessorId && assessorId !== a.assessor_id ? await db.from("people").select("id,display_name").eq("id", assessorId).maybeSingle() : { data: null };
  const assessor = ap as { id: string; display_name: string } | null;
  const row = {
    position: v(fd, "position"), assessed_on: v(fd, "assessed_on"), last_assessed_on: v(fd, "last_assessed_on"), org_changes: v(fd, "org_changes"), items,
    outcome: outcome && ["fit", "fit_training", "not_fit"].includes(outcome) ? outcome : null, training_required: v(fd, "training_required"),
    diplomas: v(fd, "diplomas"), trainings: v(fd, "trainings"), next_due: v(fd, "next_due"), updated_at: new Date().toISOString(),
    ...(assessor ? { assessor_id: assessor.id, assessor_name: assessor.display_name } : {}),
  };
  await db.from("competency_assessments").update(row).eq("id", id);
  if (fd.get("intent") === "sign") {
    const now = { ...a, ...row } as Assessment;
    if (now.assessor_id === s.person?.id && !missingToSign(now).length) {
      const at = new Date().toISOString();
      await db.from("competency_assessments").update({ status: "signed", signed_at: at, signed_by: s.person!.id }).eq("id", id);
      await log(db, s.person!.id, a.entity, id, "assessment_signed", { person: a.person_name, form: a.form_ref, outcome: now.outcome, assessed_on: now.assessed_on });
    }
  }
  revalidatePath(`/np/assess/${id}`); revalidatePath("/np/assess");
  redirect(`/np/assess/${id}${fd.get("intent") === "sign" ? "?signed=1" : "?saved=1"}`);
}

/** Compliance reopens a signed sheet (an error in it): the signature is removed and the reopening is written in the audit log. */
export async function reopenAssessment(fd: FormData) {
  const s = await getSession(); if (!s || !isDesk(s)) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || a.status !== "signed" || (!s.group && !s.entities.includes(a.entity))) return;
  await db.from("competency_assessments").update({ status: "draft", signed_at: null, signed_by: null, updated_at: new Date().toISOString() }).eq("id", id);
  await log(db, s.person?.id ?? null, a.entity, id, "assessment_reopened", { person: a.person_name, signed_at: a.signed_at, reason: v(fd, "reason") });
  revalidatePath(`/np/assess/${id}`); revalidatePath("/np/assess");
}

/** A draft started by mistake is removed (never a signed sheet). */
export async function deleteDraft(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || !mayEdit(s, a)) return;
  await db.from("competency_assessments").delete().eq("id", id);
  await log(db, s.person?.id ?? null, a.entity, id, "assessment_draft_deleted", { person: a.person_name, form: a.form_ref });
  revalidatePath("/np/assess"); redirect(`/np/assess?entity=${a.entity}`);
}
