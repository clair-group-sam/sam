"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { today } from "@/lib/authority";
import { instantiate, type Project, type ProjectTemplate } from "@/lib/projects";
import { researchPlan, sanitizePlan, type Plan, type PlanResult } from "@/lib/project-plan";
import type { WebSource } from "@/lib/ai";

type Brief = { entity: string; title: string; goal: string; context?: string; target?: string; web: boolean };
const clean = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/** Research and proposal. Nothing is created: the person reads the plan, changes it, then creates the project. */
export async function proposePlan(input: Brief & { previous?: Plan | null; feedback?: string }): Promise<{ ok: true; r: PlanResult } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || s.role === "user") return { ok: false, error: "Not allowed." };
  const entity = clean(input.entity, 10);
  if (!s.group && !s.entities.includes(entity)) return { ok: false, error: "Out of your scope." };
  const title = clean(input.title, 200), goal = clean(input.goal, 3000);
  if (title.length < 4 || goal.length < 20) return { ok: false, error: "Give the project a title and say in a few sentences what it must achieve." };
  try {
    const r = await researchPlan(supabaseAdmin(), { personId: s.person?.id ?? null }, { entity, title, goal, context: clean(input.context, 3000) || undefined, target: clean(input.target, 10) || null, web: !!input.web, previous: input.previous ? sanitizePlan(input.previous, null) : null, feedback: clean(input.feedback, 2000) || undefined });
    return { ok: true, r };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "S.A.M. could not build the plan." }; }
}

/** Creates the project from the plan as the person left it (ticked tasks only). The research is kept in the audit log. */
export async function createFromPlan(input: Brief & { plan: Plan; keep: string[]; answers?: Record<string, string>; verdicts?: Record<string, string>; owner_role?: string; owner_me?: boolean; sources?: WebSource[]; model?: string }): Promise<{ ok: false; error: string }> {
  const s = await getSession();
  if (!s || s.role === "user") return { ok: false, error: "Not allowed." };
  const entity = clean(input.entity, 10);
  if (!s.group && !s.entities.includes(entity)) return { ok: false, error: "Out of your scope." };
  const plan = sanitizePlan(input.plan, null);
  const keep = new Set((input.keep ?? []).map(String));
  const tasks = plan.tasks.filter((t) => keep.has(t.key)).map((t) => ({ ...t, deps: (t.deps ?? []).filter((d) => keep.has(d)) }));
  if (!tasks.length) return { ok: false, error: "Tick at least one task." };
  const phases = plan.phases.filter((p) => tasks.some((t) => t.phase === p.key));
  const db = supabaseAdmin();
  const title = clean(input.title, 200) || "New project";
  const description = [plan.summary, plan.assumptions.length ? `Assumptions: ${plan.assumptions.map((a) => `${a}${clean(input.verdicts?.[a], 320) ? ` [${clean(input.verdicts?.[a], 320)}]` : " [not reviewed]"}`).join(" ")}` : "", plan.risks.length ? `Risks: ${plan.risks.join(" ")}` : "", plan.questions.length ? `Decisions: ${plan.questions.map((q) => `${q} ${clean(input.answers?.[q], 300) ? `→ ${clean(input.answers?.[q], 300)}` : "(open)"}`).join(" ")}` : ""].filter(Boolean).join("\n\n").slice(0, 4000) || clean(input.goal, 2000);
  const row = { entity, template_code: null, title, description, owner_role: clean(input.owner_role, 20).toUpperCase() || "CMM", owner_person: input.owner_me ? s.person?.id ?? null : null, pivot: {}, started_at: today(), target_date: clean(input.target, 10) || null, created_by: s.person?.id ?? null };
  const { data: created, error } = await db.from("projects").insert(row).select("*").single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not create the project." };
  const p = created as Project;
  const tpl = { code: "PLAN", name: title, description, entities: [entity], phases, tasks, pivots: [], active: true, ord: 0 } as unknown as ProjectTemplate;
  const n = await instantiate(db, p.id, tpl);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "project", object_id: p.id, action: "project_created_from_sam_plan", after: { title, goal: clean(input.goal, 3000), context: clean(input.context, 3000), proposed: plan.tasks.length, kept: n, model: clean(input.model, 80), sources: (input.sources ?? []).slice(0, 40).map((x) => ({ url: clean(x.url, 500), title: clean(x.title, 200) })), questions: plan.questions, answers: input.answers ?? {}, verdicts: input.verdicts ?? {}, risks: plan.risks, assumptions: plan.assumptions } });
  revalidatePath("/proj/boards");
  redirect(`/proj/boards/${p.id}`);
}
