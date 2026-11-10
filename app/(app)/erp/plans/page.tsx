import { lastErpExercises } from "@/lib/erp-exercises";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENTS4 } from "@/lib/nav";
import { Metric, PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

/* ERP · Emergency plans: the plan of each entity, and what S.A.M. watches for it (review date, yearly exercise, numbers missing, checklists, times). */
export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? [...ENTS4] : s.entities) : [s.entity];
  const db = supabaseAdmin();
  const [{ data: pl }, { data: ex }, { data: ct }, { data: cl }, { data: ms }, { data: pr }] = await Promise.all([
    db.from("erp_plans").select("entity,next_review").in("entity", scope).eq("active", true),
    db.from("erp_exercises").select("entity,held_on").in("entity", scope).eq("status", "done"),
    db.from("erp_contacts").select("entity,kind,phone").in("entity", scope).eq("active", true),
    db.from("erp_checklists").select("entity").in("entity", scope).eq("active", true),
    db.from("erp_milestones").select("entity").in("entity", scope).eq("active", true),
    db.from("app_params").select("value").eq("key", "erp_exercise_months").maybeSingle(),
  ]);
  const t0 = new Date().toISOString().slice(0, 10);
  const months = Number((pr as { value?: string } | null)?.value ?? 12) || 12;
  const limit = new Date(Date.now() - months * 30.44 * 86_400_000).toISOString().slice(0, 10);
  const plans = (pl ?? []) as { entity: string; next_review: string | null }[];
  const late = plans.filter((p) => p.next_review && p.next_review < t0);
  void ex; const lastEx = await lastErpExercises(db, scope);
  const noEx = [...new Set(plans.map((p) => p.entity))].filter((e) => (lastEx.get(e)?.on ?? "") < limit);
  const noPhone = ((ct ?? []) as { kind: string; phone: string | null }[]).filter((c) => (c.kind === "internal" || c.kind === "investigation") && !c.phone);
  const single = scope.length === 1 ? scope[0] : null;
  return (
    <>
      <PageHeader eyebrow="ERP, Emergency plans" title="Emergency response plans" sub="One plan per entity, read from its MSM: response unit by scenario, crisis room, triggers. The MSM keeps the policy; the numbers, checklists and response times live here and are printed in the ERP binder (ORO.GEN.200(a)(7), ORA.GEN.200(a)(3))."
        right={<div className="flex gap-2">{single && <Link className="btn" href={`/print/erp/${single}`} target="_blank">Print the ERP binder</Link>}{await RegisterAdd({ reg: "erp_plans", s })}</div>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Plans past their review" value={late.length} tone={late.length ? "amber" : undefined} hint={late.map((p) => p.entity).join(", ") || "all within date"} />
        <Metric label="No exercise in 12 months" value={noEx.length} tone={noEx.length ? "red" : undefined} hint={noEx.join(", ") || `exercises up to date${[...lastEx.values()].some((x) => x.from === "committee") ? ", last one read from Safety › Committees" : ""}`} />
        <Metric label="Numbers to enter" value={noPhone.length} tone={noPhone.length ? "amber" : undefined} hint="unit members and investigation bureau without a phone" />
        <Metric label="Activation checklists" value={(cl ?? []).length} hint={`${(ms ?? []).length} response times, run as clocks in Activation mode`} />
      </div>
      <Register reg="erp_plans" s={s} open={sp.open} adding={sp.new === "1"} empty="No emergency plan recorded yet." />
    </>
  );
}
