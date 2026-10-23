import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addDays, today } from "@/lib/authority";
import { alertRoles } from "@/lib/cert";
// Daily (Hobby plan): authority files past their target date get a follow-up task for Compliance (PRJ-01 §6.2);
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
    await db.from("tasks").insert({ entity: f.entity, kind: "authority_followup", title: `Follow up with ${f.authority ?? "the authority"} — ${f.title}`, detail: `${f.portal_ref ?? "no reference"} · submitted ${f.submitted_at ?? "?"} · target date ${f.target_date} passed. Send a polite follow-up to the inspector.`, due: t0, owner_role: "CMM", status: "open", link: `/proj/auth/${f.id}`, ref_id: f.id });
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
  return Response.json({ ran: new Date().toISOString(), jobs });
}
