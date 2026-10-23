import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addDays, today } from "@/lib/authority";
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
  return Response.json({ ran: new Date().toISOString(), jobs });
}
