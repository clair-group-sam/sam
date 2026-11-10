"use server";
import { revalidatePath } from "next/cache";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

import { SEV, isHazardsToTake } from "@/lib/is-risks";

/** FB-102 · copies them as open IS risks (threat, impact, current rating), each one naming its hazard-log entry. Nothing is removed from the hazard log. */
export async function takeIsHazards(fd: FormData) {
  const s = await getSession(); if (!s) return;
  const entity = String(fd.get("entity") ?? "");
  const posts = s.roles.map(basePost);
  if (!entity || (!s.group && !s.entities.includes(entity)) || !(posts.includes("CMM") || posts.includes("SM") || posts.includes("ISM") || posts.includes("AM") || s.roles.includes("SUPERADMIN"))) return;
  const list = await isHazardsToTake(entity); if (!list.length) return;
  const db = supabaseAdmin();
  const n15 = (v: number | null) => (v && v >= 1 && v <= 5 ? Math.round(v) : null);
  await db.from("is_risks").insert(list.map((h) => ({ entity, threat: h.title.slice(0, 300), safety_impact: h.consequence, likelihood: n15(h.lik_after ?? h.lik_before), severity: SEV[(h.sev_after ?? h.sev_before ?? "").toUpperCase()] ?? null,
    treatment: `Taken from the Safety hazard log, ${h.risk_assessments.number} (${h.ref}): its mitigations are followed there.`, owner_role: "ISM", status: "open" })));
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "is_risk", object_id: entity, action: "is_risks_taken_from_hazard_log", after: { count: list.length } });
  revalidatePath("/is/risks"); revalidatePath("/is/over");
}
