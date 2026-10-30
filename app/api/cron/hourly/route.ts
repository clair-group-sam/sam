import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addDays, today } from "@/lib/authority";
import { alertRoles } from "@/lib/cert";
import { morningDigest, notifyTasks, sweepTeams, type TaskRow } from "@/lib/teams";
import { runEscalations } from "@/lib/escalation";
import { sweepFindings } from "@/lib/findings";
// Daily (Hobby plan): CAA applications past their target date get a follow-up task for Compliance (PRJ-01 §6.2);
// step 4 will add 90/30/7-day certificate alerts, MOR 72 h clock (SAF-01), reading reminders.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  const db = supabaseAdmin();
  const t0 = today();
  const jobs: Record<string, number> = {};
  // 1 · files at the authority past the target date: one open follow-up task, renewed weekly
  const { data: late } = await db.from("authority_files").select("id,entity,title,authority,portal_ref,target_date,submitted_at").in("stage", ["submitted", "remarks"]).lt("target_date", t0);
  let n = 0;
  for (const f of (late ?? []) as { id: string; entity: string; title: string; authority: string | null; portal_ref: string | null; target_date: string; submitted_at: string | null }[]) {
    const { data: ex } = await db.from("tasks").select("id,created_at").eq("ref_id", f.id).eq("kind", "authority_followup").eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ex && (ex as { created_at: string }).created_at > addDays(t0, -7)) continue;
    if (ex) await db.from("tasks").update({ status: "superseded" }).eq("id", (ex as { id: string }).id);
    const { data: fu } = await db.from("tasks").insert({ entity: f.entity, kind: "authority_followup", title: `Follow up with ${f.authority ?? "the authority"} — ${f.title}`, detail: `${f.portal_ref ?? "no reference"} · submitted ${f.submitted_at ?? "?"} · target date ${f.target_date} passed. Send a polite follow-up to the inspector.`, due: t0, owner_role: "CMM", status: "open", link: `/proj/auth/${f.id}`, ref_id: f.id }).select("*");
    if (fu?.length) await notifyTasks(db, fu as TaskRow[]);
    await db.from("authority_file_events").insert({ file_id: f.id, kind: "task", who: "S.A.M.", note: "Target date passed: follow-up task created for Compliance" });
    n++;
  }
  jobs.authority_followups = n;
  // 2 · certificates & validities (DOC-10): one task per threshold 90 / 30 / 7 days and at expiry, for Compliance (+ CAMO for aircraft documents)
  const { data: certs } = await db.from("certificates").select("id,entity,scope,registration,kind,title,valid_until,alerts").is("archived_at", null).not("valid_until", "is", null).lte("valid_until", addDays(t0, 90));
  let c = 0;
  for (const x of (certs ?? []) as { id: string; entity: string; scope: string; registration: string | null; kind: string; title: string; valid_until: string; alerts: Record<string, string> | null }[]) {
    const left = Math.round((Date.parse(x.valid_until) - Date.parse(t0)) / 86_400_000);
    const step = left < 0 ? "expired" : left <= 7 ? "7" : left <= 30 ? "30" : "90";
    const alerts = x.alerts ?? {};
    if (alerts[step]) continue;
    await db.from("tasks").update({ status: "superseded" }).eq("ref_id", x.id).eq("kind", "certificate_validity").eq("status", "open");
    const what = `${x.title}${x.registration ? ` · ${x.registration}` : ""}`;
    for (const role of alertRoles(x.scope)) {
      await db.from("tasks").insert({ entity: x.entity, kind: "certificate_validity", title: left < 0 ? `Expired: ${what}` : `${what} expires in ${left} day${left === 1 ? "" : "s"}`, detail: `Valid until ${x.valid_until}. Renew it, then drop the new document in S.A.M. (Certificates & Validities › Drop a document): it replaces this one.`, due: x.valid_until, owner_role: role, status: "open", link: "/docs/files", ref_id: x.id });
    }
    await db.from("certificates").update({ alerts: { ...alerts, [step]: t0 } }).eq("id", x.id);
    c++;
  }
  jobs.certificate_alerts = c;
  // 3 · risk register (MSM §3.2.2 / 3.5): reviews past due, residual risk intolerable → SM (+ AM), one open task each, never duplicated
  const openTask = async (kind: string, ref: string) => { const { data } = await db.from("tasks").select("id").eq("kind", kind).eq("ref_id", ref).eq("status", "open").limit(1); return !!data?.length; };
  const { data: due } = await db.from("risk_assessments").select("id,entity,number,name,next_due,owner_role").in("status", ["draft", "validated", "accepted"]).eq("kind", "hazard_log").lt("next_due", t0); // periodic review = the hazard log; a one-off RA is closed when its case is over
  let rv = 0;
  for (const a of (due ?? []) as { id: string; entity: string; number: string; name: string; next_due: string; owner_role: string | null }[]) {
    if (await openTask("risk_review", a.id)) continue;
    await db.from("tasks").insert({ entity: a.entity, kind: "risk_review", title: `Review ${a.number} — ${a.name}`.slice(0, 200), detail: `Review date ${a.next_due} passed: reassess the hazards and sign a new version (hazard log kept current, reviewed at the SRB).`, due: t0, owner_role: a.owner_role ?? "SM", status: "open", link: `/safe/risk/a/${a.id}`, ref_id: a.id });
    rv++;
  }
  jobs.risk_reviews = rv;
  const { data: hz } = await db.from("hazards").select("id,entity,ref,title,lik_before,sev_before,lik_after,sev_after,assessment_id").eq("proposed", false).neq("status", "closed").not("assessment_id", "is", null);
  const { schemeOf, tolerability } = await import("@/lib/risk-shared");
  const ids = [...new Set(((hz ?? []) as { assessment_id: string }[]).map((h) => h.assessment_id))];
  const { data: decided } = ids.length ? await db.from("risk_assessments").select("id").in("id", ids).or("accepted_at.not.is.null,decision.eq.stop,status.in.(archived,cancelled)") : { data: [] }; // AM decided, stopped (no-go), closed
  const amDecided = new Set(((decided ?? []) as { id: string }[]).map((r) => r.id)); // nothing left to decide
  let ti = 0;
  for (const h of (hz ?? []) as { id: string; entity: string; ref: string; title: string; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; assessment_id: string }[]) {
    if (amDecided.has(h.assessment_id)) continue;
    if (tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, schemeOf(h.entity)) !== "intolerable") continue;
    if (await openTask("risk_intolerable", h.id)) continue;
    for (const role of ["SM", "AM"]) await db.from("tasks").insert({ entity: h.entity, kind: "risk_intolerable", title: `Intolerable risk — ${h.ref} ${h.title}`.slice(0, 200), detail: "The residual risk is in the red zone: the activity cannot continue as it is until the risk is reduced (MSM §3.5.3).", due: t0, owner_role: role, status: "open", link: `/safe/risk/${h.id}`, ref_id: h.id });
    ti++;
  }
  jobs.risk_intolerable = ti;
  // 4 · safety actions: effectiveness check due (date set at closure) → one task for the safety desk
  const { data: eff } = await db.from("safety_actions").select("id,entity,number,title,effectiveness_due").eq("status", "verified").is("effectiveness", null).lte("effectiveness_due", t0);
  let te = 0;
  for (const a of (eff ?? []) as { id: string; entity: string; number: string; title: string; effectiveness_due: string }[]) {
    if (await openTask("action_effectiveness", a.id)) continue;
    await db.from("tasks").insert({ entity: a.entity, kind: "action_effectiveness", title: `Effectiveness of ${a.number} — ${a.title}`.slice(0, 200), detail: "Did the action remove or reduce the problem? Effective, or not effective → follow-up action.", due: a.effectiveness_due, owner_role: "SM", status: "open", link: `/safe/actions/${a.id}`, ref_id: a.id });
    te++;
  }
  jobs.action_effectiveness = te;
  // FND-01 · findings whose plan is complete → closure proposed to the NP
  jobs.finding_closures = await sweepFindings(db);
  // SOC-02 · one reminder / escalation ladder for every open item past its due date (Settings › Notification rules)
  const esc = await runEscalations(db);
  for (const [k, v] of Object.entries(esc)) jobs[`escalation_${k}`] = v;
  // TMS-02 · Teams: cards for everything created above (and anywhere else since the last sweep), then the morning digest
  const sw = await sweepTeams(db, true);
  jobs.teams_cards = sw.notified; jobs.teams_refreshed = sw.refreshed;
  jobs.teams_digests = await morningDigest(db);
  return Response.json({ ran: new Date().toISOString(), jobs });
}
