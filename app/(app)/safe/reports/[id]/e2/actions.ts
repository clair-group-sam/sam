"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { changeOccurrenceStatus, createOccurrence, eccairsConfig, eccairsEnv, editOccurrence, type TaxonomyCodes } from "@/lib/eccairs";
import { buildTaxonomyCodes, e2Context, proposeFields, type AnalysisForE2, type ReportForE2 } from "@/lib/eccairs-map";
import { markMorFiled } from "@/lib/mor-filed";

/* ECC-02 · the safety desk reviews the E2 report S.A.M. proposes, then saves it as DRAFT in E2 or sends it (SENT = the authority receives it).
 * Every attempt is kept in eccairs_submissions with the payload and E2's answer. */
const db = () => supabaseAdmin();
async function load(id: string) {
  const s = await getSession(); if (!s || !isSafetyDesk(s)) throw new Error("Reserved to the safety desk.");
  const { data } = await db().from("reports").select("*").eq("id", id).maybeSingle();
  const r = data as (ReportForE2 & { entity: string; mor_filed_at: string | null }) | null;
  if (!r || !s.entities.includes(r.entity)) throw new Error("Report not found in your scope.");
  if (!eccairsConfig(r.entity)) throw new Error(`ECCAIRS is not connected for ${r.entity}.`);
  const { data: an } = await db().from("report_analysis").select("mor_draft,adrep,mor_status").eq("report_id", id).maybeSingle();
  return { s, r, a: an as AnalysisForE2 };
}
/** Reads the reviewed form back into fields: the proposal gives the shape, the form the values. */
async function fieldsFrom(fd: FormData, r: ReportForE2, a: AnalysisForE2) {
  const ctx = await e2Context(db(), r.entity);
  if (!ctx.taxonomy) throw new Error("Load the taxonomy first (Safety › MOR / ECCAIRS).");
  const { data: ac } = r.aircraft ? await db().from("aircraft").select("registration,type_code,model,msn").ilike("registration", r.aircraft.trim()).maybeSingle() : { data: null };
  const fields = proposeFields(r, a, ctx, { registry: ac as { registration: string; type_code: string | null; model: string | null; msn: string | null } | null });
  for (const f of fields) {
    if (f.kind === "lists") f.value = fd.getAll(`f_${f.key}`).map(String).filter(Boolean);
    else { const v = String(fd.get(`f_${f.key}`) ?? "").trim(); f.value = v || null; }
  }
  return fields;
}
export async function sendToE2(fd: FormData) {
  const id = String(fd.get("id")); const want = fd.get("status") === "SENT" ? "SENT" : "DRAFT";
  const { s, r, a } = await load(id);
  if (want === "SENT" && fd.get("confirm") !== "on") throw new Error("Tick the confirmation before sending to the authority.");
  const fields = await fieldsFrom(fd, r, a);
  const { codes, missing } = buildTaxonomyCodes(fields);
  if (want === "SENT" && missing.length) throw new Error(`Required before sending: ${missing.join(", ")}.`);
  const env = eccairsEnv(r.entity); const by = s.person?.id ?? null;
  try {
    let res;
    if (r.e2_id) { res = await editOccurrence(r.entity, r.e2_id, codes, want === "DRAFT" && r.e2_payload == null ? "DRAFT" : "MINOR"); if (want === "SENT" && res.status !== "SENT") res = await changeOccurrenceStatus(r.entity, r.e2_id, "SENT"); }
    else res = await createOccurrence(r.entity, codes, want);
    await db().from("eccairs_submissions").insert({ entity: r.entity, report_id: id, env, kind: r.e2_id ? "edit" : "create", requested_status: want, payload: codes, response: res, ok: true, e2_id: res.e2Id, e2_version: res.version, e2_status: res.status, by_person: by });
    const sent = res.status === "SENT";
    await db().from("reports").update({ e2_id: res.e2Id, e2_status: res.status, e2_version: res.version, e2_payload: codes, e2_sent_at: sent ? new Date().toISOString() : null, e2_synced_at: new Date().toISOString(), mor_authority: r.entity === "ASJMT" ? "TM-CAD" : "DGAC (DSAC)" }).eq("id", id);
    await db().from("report_events").insert({ report_id: id, kind: "mor", actor: by, note: sent ? `Sent to the authority through ECCAIRS 2 (${env}) — ${res.e2Id} v${res.version}` : `Saved as DRAFT in ECCAIRS 2 (${env}) — ${res.e2Id} v${res.version}`, to_reporter: false });
    if (sent) await markMorFiled(db(), id, res.e2Id, by, "e2");
  } catch (e) {
    const msg = (e as Error).message.slice(0, 600);
    await db().from("eccairs_submissions").insert({ entity: r.entity, report_id: id, env, kind: r.e2_id ? "edit" : "create", requested_status: want, payload: codes as unknown as TaxonomyCodes, ok: false, error: msg, by_person: by });
    revalidatePath(`/safe/reports/${id}/e2`);
    redirect(`/safe/reports/${id}/e2?err=${encodeURIComponent(`ECCAIRS refused: ${msg}`)}`);
  }
  revalidatePath(`/safe/reports/${id}`); revalidatePath(`/safe/reports/${id}/e2`); revalidatePath("/safe/mor");
  redirect(`/safe/reports/${id}`);
}
