import type { SupabaseClient } from "@supabase/supabase-js";

/* Daily sweep for the ERP and Part-IS (10/11/2026). What S.A.M. can watch alone is not a human task until it is due:
 * plan review date passed → SM; no exercise in erp_exercise_months → SM; per entity, critical Part-IS systems without a risk
 * assessment and departments awaiting reply → one ISM task. One open task per object, never duplicated, closed when the cause is gone. */
export async function sweepErpIs(db: SupabaseClient): Promise<number> {
  const t0 = new Date().toISOString().slice(0, 10);
  let n = 0;
  const openTask = async (kind: string, ref: string) => { const { data } = await db.from("tasks").select("id").eq("kind", kind).eq("ref_id", ref).eq("status", "open").limit(1); return (data ?? [])[0] as { id: string } | undefined; };
  const close = async (kind: string, ref: string) => { await db.from("tasks").update({ status: "done" }).eq("kind", kind).eq("ref_id", ref).eq("status", "open"); };
  const { data: pr } = await db.from("app_params").select("key,value").in("key", ["erp_exercise_months"]);
  const months = Number(((pr ?? []) as { key: string; value: string }[]).find((x) => x.key === "erp_exercise_months")?.value ?? 12) || 12;
  const limit = new Date(Date.now() - months * 30.44 * 86_400_000).toISOString().slice(0, 10);

  const { data: plans } = await db.from("erp_plans").select("id,entity,title,next_review,owner_role").eq("active", true);
  const { data: exs } = await db.from("erp_exercises").select("entity,held_on").eq("status", "done");
  const last = new Map<string, string>(); for (const e of (exs ?? []) as { entity: string; held_on: string | null }[]) if (e.held_on && (last.get(e.entity) ?? "") < e.held_on) last.set(e.entity, e.held_on);
  const seen = new Set<string>();
  for (const p of (plans ?? []) as { id: string; entity: string; title: string; next_review: string | null; owner_role: string | null }[]) {
    if (p.next_review && p.next_review < t0) {
      if (!(await openTask("erp_review", p.id))) { await db.from("tasks").insert({ entity: p.entity, kind: "erp_review", title: `${p.title}: review due since ${p.next_review}`.slice(0, 200), detail: "Check the unit, the numbers, the checklists and the response times, then set the next review date. A change of policy, unit or triggers is an MSM revision.", due: t0, owner_role: p.owner_role ?? "SM", status: "open", link: `/erp/plans?open=${p.id}#edit`, ref_id: p.id }); n++; }
    } else await close("erp_review", p.id);
    if (seen.has(p.entity)) continue; seen.add(p.entity);
    const ref = p.id; const l = last.get(p.entity);
    if (!l || l < limit) {
      if (!(await openTask("erp_exercise", ref))) { await db.from("tasks").insert({ entity: p.entity, kind: "erp_exercise", title: `ERP exercise due${l ? `: last one on ${l}` : ": none recorded"}`, detail: "Plan the yearly ERP exercise (tabletop or drill) in Exercises. Run it in Activation mode, ticked \"This is an exercise\": the log, ticks and times become the exercise record.", due: t0, owner_role: "SM", status: "open", link: "/erp/exer?new=1#edit", ref_id: ref }); n++; }
    } else await close("erp_exercise", ref);
  }

  // Part-IS: one task per entity, never one per system (a list thrown at the ISM is not a task)
  const { data: sys } = await db.from("is_systems").select("id,entity,ref,name,attention,status").eq("active", true);
  const { data: risks } = await db.from("is_risks").select("entity,system");
  const assessed = (e: string, name: string) => ((risks ?? []) as { entity: string; system: string | null }[]).some((r) => r.entity === e && (r.system ?? "").toLowerCase().includes(name.toLowerCase().split(/[ (]/)[0]));
  const byEnt = new Map<string, { anchor?: string; first?: string; crit: string[]; wait: string[] }>();
  for (const x of (sys ?? []) as { id: string; entity: string; ref: string | null; name: string; attention: string | null; status: string }[]) {
    const g = byEnt.get(x.entity) ?? { crit: [], wait: [] }; byEnt.set(x.entity, g);
    if (x.ref === "sam") g.anchor = x.id; g.first ??= x.id;
    if (x.status === "awaiting") g.wait.push(x.name);
    else if (x.attention === "critical" && !assessed(x.entity, x.name)) g.crit.push(x.name);
  }
  for (const [entity, g] of byEnt) {
    const ref = g.anchor ?? g.first!; const ex = await openTask("is_review", ref);
    if (!g.crit.length && !g.wait.length) { if (ex) await close("is_review", ref); continue; }
    const title = [g.crit.length ? `${g.crit.length} critical system${g.crit.length > 1 ? "s" : ""} without an IS risk assessment` : "", g.wait.length ? `${g.wait.length} department${g.wait.length > 1 ? "s" : ""} without reply` : ""].filter(Boolean).join(", ");
    const detail = [g.crit.length ? `Assess for aviation safety (IS.I.OR.205): ${g.crit.join(", ")}.` : "", g.wait.length ? `Follow up the inventory e-mail of 31/03/2026: ${g.wait.join(", ")}.` : ""].filter(Boolean).join(" ");
    if (ex) { await db.from("tasks").update({ title: `Part-IS: ${title}`.slice(0, 200), detail }).eq("id", ex.id); continue; }
    await db.from("tasks").insert({ entity, kind: "is_review", title: `Part-IS: ${title}`.slice(0, 200), detail, due: t0, owner_role: "ISM", status: "open", link: "/is/over", ref_id: ref }); n++;
  }
  return n;
}
