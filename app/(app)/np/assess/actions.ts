"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { ASSESS_ENTITIES, FORMS, isDesk, isForm, mayPrefill, mayStartOwn, mayValidate, missingToSign, pointsFor, type Assessment, type Item } from "@/lib/competency";

const v = (fd: FormData, k: string) => { const x = String(fd.get(k) ?? "").trim(); return x || null; };
const log = (db: ReturnType<typeof supabaseAdmin>, actor: string | null, entity: string, id: string, action: string, after?: unknown) =>
  db.from("audit_log").insert({ actor, entity, object_type: "competency_assessment", object_id: id, action, after: after ?? null });
const lvl = (x: FormDataEntryValue | null) => { const l = Number(x ?? 0); return l >= 1 && l <= 4 ? l : null; };

/** NP-03 · a new sheet. Compliance opens it for anyone of the entity; a nominated person opens their own, to pre-fill it.
 *  The points of the form are copied on the sheet. */
export async function createAssessment(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const entity = String(fd.get("entity") ?? ""); const form = String(fd.get("form") ?? "");
  if (!isForm(form) || !ASSESS_ENTITIES.includes(entity) || (!s.group && !s.entities.includes(entity))) return;
  const desk = isDesk(s); const own = !desk || fd.get("own") === "1";
  if (own && !mayStartOwn(s)) return;
  const functions = fd.getAll("functions").map(String).filter((c) => FORMS[form].functions.some((f) => f.code === c));
  const personId = own ? s.person!.id : v(fd, "person_id"); const kind = fd.get("kind") === "initial" ? "initial" : "recurrent";
  const db = supabaseAdmin();
  const { data: p } = personId ? await db.from("people").select("id,display_name,job_title").eq("id", personId).maybeSingle() : { data: null };
  const person = p as { id: string; display_name: string; job_title: string | null } | null;
  const name = person?.display_name ?? (own ? null : v(fd, "person_name"));
  if (!name || !functions.length) redirect(`/np/assess?entity=${entity}&new=${form}${own ? "&own=1" : ""}&err=1`);
  // the date of the last assessment is the one S.A.M. holds for this person on this form
  const { data: prev } = await db.from("competency_assessments").select("assessed_on").eq("entity", entity).eq("form", form).eq("status", "signed").ilike("person_name", name!).order("assessed_on", { ascending: false }).limit(1);
  const last = ((prev ?? []) as { assessed_on: string | null }[])[0]?.assessed_on ?? null;
  const row = {
    entity, form, form_ref: FORMS[form].ref, form_edition: FORMS[form].edition, person_id: person?.id ?? null, person_name: name!, position: v(fd, "position") ?? person?.job_title ?? null,
    functions, kind, assessed_on: own ? null : v(fd, "assessed_on"), last_assessed_on: last,
    items: pointsFor(form, functions, kind, ENT[entity]?.name ?? entity), created_by: s.person?.id ?? null,
  };
  const { data: ins } = await db.from("competency_assessments").insert(row).select("id").single();
  const id = (ins as { id: string } | null)?.id; if (!id) return;
  await log(db, s.person?.id ?? null, entity, id, own ? "assessment_opened_by_person" : "assessment_created", { person: name, form: row.form_ref, functions });
  revalidatePath("/np/assess"); redirect(`/np/assess/${id}`);
}

async function load(id: string) { const db = supabaseAdmin(); const { data } = await db.from("competency_assessments").select("*").eq("id", id).maybeSingle(); return { db, a: data as Assessment | null }; }

/** The person pre-fills their own sheet: their level and comment on each point, page 3. "send" hands it to Compliance. */
export async function savePrefill(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || !mayPrefill(s, a)) return;
  const items: Item[] = a.items.map((i) => ({ ...i, self: lvl(fd.get(`s_${i.k}`)), self_remark: v(fd, `sr_${i.k}`) }));
  const send = fd.get("intent") === "send";
  const row = { items, org_changes: v(fd, "org_changes"), diplomas: v(fd, "diplomas"), trainings: v(fd, "trainings"), updated_at: new Date().toISOString(),
    ...(send ? { status: "submitted", submitted_at: new Date().toISOString() } : {}) };
  await db.from("competency_assessments").update(row).eq("id", id);
  if (send) await log(db, s.person!.id, a.entity, id, "assessment_prefilled_sent", { person: a.person_name, form: a.form_ref, points: items.filter((i) => i.self).length });
  revalidatePath(`/np/assess/${id}`); revalidatePath("/np/assess");
  redirect(`/np/assess/${id}?${send ? "sent" : "saved"}=1`);
}

/** Compliance validates: its level and remark on each point, the outcome, the training. "sign" signs when nothing is missing;
 *  "return" gives the sheet back to the person for completion. */
export async function saveAssessment(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || !mayValidate(s, a)) return;
  const intent = String(fd.get("intent") ?? "save");
  const items: Item[] = a.items.map((i) => ({ ...i, level: lvl(fd.get(`l_${i.k}`)), remark: v(fd, `r_${i.k}`) }));
  const outcome = v(fd, "outcome");
  const row: Record<string, unknown> = {
    position: v(fd, "position"), assessed_on: v(fd, "assessed_on"), last_assessed_on: v(fd, "last_assessed_on"), org_changes: v(fd, "org_changes"), items,
    outcome: outcome && ["fit", "fit_training", "not_fit"].includes(outcome) ? outcome : null, training_required: v(fd, "training_required"),
    diplomas: v(fd, "diplomas"), trainings: v(fd, "trainings"), next_due: v(fd, "next_due"), updated_at: new Date().toISOString(),
  };
  if (intent === "return" && a.person_id) { row.status = "draft"; row.submitted_at = null; }
  await db.from("competency_assessments").update(row).eq("id", id);
  if (intent === "return" && a.person_id) await log(db, s.person?.id ?? null, a.entity, id, "assessment_returned_to_person", { person: a.person_name });
  if (intent === "sign" && s.person && !missingToSign({ ...a, ...row } as Assessment).length) {
    const at = new Date().toISOString();
    await db.from("competency_assessments").update({ status: "signed", signed_at: at, signed_by: s.person.id, assessor_id: s.person.id, assessor_name: s.name }).eq("id", id);
    await log(db, s.person.id, a.entity, id, "assessment_signed", { person: a.person_name, form: a.form_ref, outcome: row.outcome, assessed_on: row.assessed_on });
  }
  revalidatePath(`/np/assess/${id}`); revalidatePath("/np/assess");
  redirect(`/np/assess/${id}?${intent === "sign" ? "signed" : intent === "return" ? "returned" : "saved"}=1`);
}

/** Compliance reopens a signed sheet (an error in it): the signature is removed and the reopening is written in the audit log. */
export async function reopenAssessment(fd: FormData) {
  const s = await getSession(); if (!s || !isDesk(s)) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || a.status !== "signed" || (!s.group && !s.entities.includes(a.entity))) return;
  await db.from("competency_assessments").update({ status: "submitted", signed_at: null, signed_by: null, updated_at: new Date().toISOString() }).eq("id", id);
  await log(db, s.person?.id ?? null, a.entity, id, "assessment_reopened", { person: a.person_name, signed_at: a.signed_at, reason: v(fd, "reason") });
  revalidatePath(`/np/assess/${id}`); revalidatePath("/np/assess");
}

/** A sheet opened by mistake is removed while it is not signed: by Compliance, or by the person while it is still their draft. */
export async function deleteDraft(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const id = String(fd.get("id") ?? ""); const { db, a } = await load(id);
  if (!a || !(mayValidate(s, a) || (mayPrefill(s, a) && a.created_by === s.person?.id))) return;
  await db.from("competency_assessments").delete().eq("id", id);
  await log(db, s.person?.id ?? null, a.entity, id, "assessment_draft_deleted", { person: a.person_name, form: a.form_ref });
  revalidatePath("/np/assess"); redirect(`/np/assess?entity=${a.entity}`);
}
