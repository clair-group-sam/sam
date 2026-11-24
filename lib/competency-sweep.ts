import type { SupabaseClient } from "@supabase/supabase-js";
import { today } from "@/lib/authority";

/** NP-03 · before the end of validity of a competency assessment (12 months, MSM 4-5): one alert at 60, 30 and 7 days and at expiry,
 *  for Compliance (the assessor) and for the person, each raised once. Only the last signed sheet of a person on a form counts, and
 *  nothing is raised while a newer sheet is already signed. */
export async function sweepCompetency(db: SupabaseClient): Promise<number> {
  const t0 = today();
  const { data } = await db.from("competency_assessments").select("id,entity,form,form_ref,person_id,person_name,status,next_due,alerts,created_at").order("created_at", { ascending: false });
  type R = { id: string; entity: string; form: string; form_ref: string; person_id: string | null; person_name: string; status: string; next_due: string | null; alerts: Record<string, string> | null };
  const seen = new Set<string>(); const renewing = new Set<string>(); let n = 0;
  for (const a of (data ?? []) as R[]) {
    const k = `${a.entity}|${a.form}|${a.person_name.toLowerCase()}`;
    if (a.status !== "signed") { if (!seen.has(k)) renewing.add(k); continue; }
    if (seen.has(k)) continue; seen.add(k);
    if (!a.next_due) continue;
    const left = Math.round((Date.parse(a.next_due) - Date.parse(t0)) / 86_400_000);
    if (left > 60) continue;
    const step = left < 0 ? "expired" : left <= 7 ? "7" : left <= 30 ? "30" : "60";
    const alerts = a.alerts ?? {}; if (alerts[step]) continue;
    await db.from("tasks").update({ status: "superseded" }).eq("ref_id", a.id).eq("kind", "competency_due").eq("status", "open");
    const when = left < 0 ? `expired ${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "ends today" : `ends in ${left} day${left === 1 ? "" : "s"}`;
    const prog = renewing.has(k) ? " A new sheet is already in progress: validate and sign it." : "";
    const base = { entity: a.entity, kind: "competency_due", due: a.next_due, status: "open", ref_id: a.id };
    await db.from("tasks").insert({ ...base, title: `Competency assessment of ${a.person_name}: validity ${when}`, detail: `${a.form_ref}, valid 12 months (MSM 4-5). Open a new sheet, have it pre-filled, then validate and sign.${prog}`, owner_role: "CMM", link: `/np/assess?entity=${a.entity}` });
    if (a.person_id) await db.from("tasks").insert({ ...base, title: `Your competency assessment: validity ${when}`, detail: `${a.form_ref}. Open your new sheet in NP management, pre-fill it and send it to Compliance.${prog}`, owner_person: a.person_id, link: `/np/assess?entity=${a.entity}` });
    await db.from("competency_assessments").update({ alerts: { ...alerts, [step]: t0 } }).eq("id", a.id);
    n++;
  }
  return n;
}
