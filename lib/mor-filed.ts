import type { SupabaseClient } from "@supabase/supabase-js";

/** SAF-06 · The MOR is filed (from the portal by hand, or by S.A.M. through the E2 API): the 72 h clock stops, the reporter is told,
 *  the 30-day and 3-month reports to the authority are scheduled (376/2014 art. 13(4)). Shared by the report sheet and the E2 send. */
export async function markMorFiled(db: SupabaseClient, id: string, ref: string, actor: string | null, via: "portal" | "e2" = "portal"): Promise<void> {
  const { data: cur } = await db.from("reports").select("entity,headline,mor_filed_at").eq("id", id).maybeSingle();
  const r0 = cur as { entity: string; headline: string; mor_filed_at: string | null } | null; if (!r0) return;
  const now = new Date().toISOString();
  await db.from("reports").update({ mor_ref: ref, mor_filed_at: r0.mor_filed_at ?? now }).eq("id", id);
  await db.from("report_events").insert({ report_id: id, kind: "mor", actor, note: via === "e2" ? `MOR sent to the authority through ECCAIRS 2 — ${ref}` : `MOR filed with the authority — ${ref}`, to_reporter: true });
  await db.from("tasks").update({ status: "done" }).eq("kind", "safety_report").eq("link", `/safe/reports/${id}`).eq("status", "open");
  if (r0.mor_filed_at) return; // already filed once: the follow-up tasks exist
  const t = Date.now(); const m3 = new Date(t); m3.setUTCMonth(m3.getUTCMonth() + 3);
  await db.from("tasks").insert([
    { entity: r0.entity, kind: "mor_followup", title: `${id} — 30-day report to the authority`, detail: `${r0.headline} · MOR ${ref}`, due: new Date(t + 30 * 864e5).toISOString().slice(0, 10), owner_role: "SM", status: "open", link: "/safe/mor", ref_id: id },
    { entity: r0.entity, kind: "mor_final", title: `${id} — final report to the authority (3 months)`, detail: `${r0.headline} · MOR ${ref}`, due: m3.toISOString().slice(0, 10), owner_role: "SM", status: "open", link: "/safe/mor", ref_id: id },
  ]);
}
