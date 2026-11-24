// PRJ-03 · Plan with S.A.M. (24/11/2026): for a project never done before, S.A.M. researches what it takes and proposes the
// phases and tasks; the person keeps what is right and the project is created from it. S.A.M. proposes, the human decides.
// Research = what S.A.M. already holds (posts, manuals, application types, templates, lessons learned, the EARs loaded) + official
// sources on the web (searched by Claude at Anthropic). Every rule cited is checked against the EARs loaded in S.A.M.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaudeResearch, type WebSource } from "@/lib/ai";
import { loadTemplates, type LinkKind, type TemplateTask } from "@/lib/projects";
import { loadTypes } from "@/lib/authority";
import { ruleCodesIn } from "@/lib/regulation-items";
import { ENT } from "@/lib/nav";

export type PlanTask = TemplateTask & { basis?: string; unknown?: boolean; rules?: { code: string; found: boolean }[]; flags?: string[] };
export type Plan = { summary: string; risks: string[]; assumptions: string[]; questions: string[]; phases: { key: string; label: string }[]; tasks: PlanTask[] };
export type PlanResult = { plan: Plan; sources: WebSource[]; searches: number; model: string; webNote: string | null; context: string };
export type PlanInput = { entity: string; title: string; goal: string; context?: string; target?: string | null; web: boolean; previous?: Plan | null; feedback?: string };

const LINKS: LinkKind[] = ["manual", "authority_file", "certificate", "moc"];
const GENERAL_POSTS = ["AM", "CMM", "SM", "ISM", "NPFO", "NPGO", "NPCT", "NPCA", "HR", "FINANCE", "IT", "LEGAL"];
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

const SYSTEM = `You plan a project for an aviation organisation of Clair Group (EASA rules; Malta TM-CAD for Astonjet Ltd, French DGAC/DSAC/OSAC for Astonjet SAS, Astonfly and Astontec). The organisation has never run this kind of project. Your job: find out what it really takes and turn it into a project plan that can be executed.
How to work:
- First use what S.A.M. already holds (given below): posts, manuals, authority application types, existing project templates and lessons learned. Reuse their wording and their real durations when a part of this project resembles them.
- When web search is available, use it to establish the requirements you are not sure of: the applicable EASA rules (Easy Access Rules, AMC/GM), the national authority's procedure, forms and lead times, the manufacturer or supplier steps. Prefer official sources (easa.europa.eu, eur-lex.europa.eu, the authority's own site). Do not search for what you already know reliably.
- Never invent a regulatory reference, a form number or a lead time. If you are not sure, say so in "questions" or in the task's basis ("to confirm with …").
What a good plan is:
- 3 to 8 phases in the order of the work; 10 to 45 tasks. One task = one deliverable one post can finish; title starts with a verb, under 110 characters.
- owner_role: a post code of the entity (list given). Use another short code only when no listed post fits.
- days: realistic working duration in calendar days, including authority lead times on the tasks that wait for the authority.
- deps: keys of the tasks that must be finished first. Keep the chain real (manual revised, then application filed, then approval, then publication).
- link_kind: "manual" when the task is the revision of a manual of the library (link_ref = its code, exactly as listed); "authority_file" when the task is an application or notification to the authority (link_ref = the application type code, exactly as listed, or omit it if no type fits); "certificate" when the task ends with a certificate or approval document to file; "moc" when the task is a management of change or risk assessment. Omit link_kind otherwise.
- A change with a safety impact has a management of change with its risk assessment early in the plan, and the manuals affected are revised before the application that needs them.
- basis: where the task comes from: the rule (e.g. "ORO.GEN.130(b)"), the authority procedure, the template or lesson reused, or "good practice". One line.
- detail: one or two sentences on what is expected, only when the title is not enough.
- What you could not establish and that only someone OUTSIDE the company knows (the authority's real lead time or form, an airport's or a supplier's conditions, a manufacturer's data) is NEVER a question: make it a task at the right place in the plan, "Ask <who>: <what to confirm>", owned by the post that has the contact, with "unknown": true, and make the tasks that depend on the answer depend on it.
- questions: ONLY decisions or facts the project owner can answer from inside the company, today, in a few words: scope (which aircraft, which crews, which base), choices (in-house or subcontracted, which provider among those known), what is already held (an approval, a contract, a trained instructor), budget or priority. Each question short, one subject, answerable by a name, a number, yes or no. Max 6; none if nothing is needed.
- assumptions: what you assumed in the absence of an answer (max 6). risks: what could make the project slip or fail (max 4, one line each).
- summary: 2 or 3 short sentences: what the project takes and where the critical path runs. No list, no figures you cannot support.
Write in English. Answer ONLY with one JSON object, no text before or after:
{"summary":"…","risks":["…"],"assumptions":["…"],"questions":["…"],"phases":[{"key":"short_key","label":"Phase label"}],"tasks":[{"key":"short_key","phase":"phase key","title":"…","detail":"…","owner_role":"POST","days":5,"deps":["key"],"link_kind":"manual","link_ref":"OM-A","basis":"…","unknown":false}]}`;

/** What S.A.M. holds that helps to plan: compact text for the prompt. */
async function contextFor(db: SupabaseClient, entity: string): Promise<{ text: string; posts: Set<string>; manuals: Set<string>; types: Set<string> }> {
  const [{ data: np }, { data: mn }, types, templates, { data: closed }, { data: regs }] = await Promise.all([
    db.from("np_posts").select("code,title").eq("entity", entity).order("ord"),
    db.from("manuals").select("code,title,owner_role").eq("entity", entity).order("code"),
    loadTypes(db), loadTemplates(db),
    db.from("projects").select("title,entity,lessons,template_code").eq("status", "closed").not("lessons", "is", null).order("closed_at", { ascending: false }).limit(8),
    db.from("regulations").select("title,items_version").contains("entities", [entity]).not("items_version", "is", null),
  ]);
  const posts = ((np ?? []) as { code: string; title: string }[]);
  const manuals = ((mn ?? []) as { code: string; title: string; owner_role: string }[]);
  const ty = types.filter((t) => t.entities.includes(entity));
  const tpl = templates.filter((t) => t.entities.includes(entity)).slice(0, 8);
  const text = [
    `ENTITY: ${ENT[entity]?.name ?? entity} (${entity}).`,
    `POSTS (code: title): ${posts.map((p) => `${p.code}: ${p.title}`).join("; ") || "none recorded"}. General posts also usable: AM, CMM, SM, ISM.`,
    `MANUALS OF THE LIBRARY (code: title, owner): ${manuals.map((m) => `${m.code}: ${m.title} (${m.owner_role})`).join("; ") || "none imported yet"}.`,
    `AUTHORITY APPLICATION TYPES (code: name, usual days): ${ty.map((t) => `${t.code}: ${t.name} (${t.target_days} d)`).join("; ") || "none"}.`,
    `EXISTING PROJECT TEMPLATES (reuse their tasks when relevant):\n${tpl.map((t) => `- ${t.code} ${t.name}: ${t.phases.map((ph) => `[${ph.label}] ${t.tasks.filter((x) => x.phase === ph.key).slice(0, 14).map((x) => `${x.title}${x.owner_role ? ` (${x.owner_role}${x.days ? `, ${x.days} d` : ""})` : ""}`).join(" | ")}`).join(" ").slice(0, 2600)}`).join("\n") || "none"}`,
    `LESSONS LEARNED ON CLOSED PROJECTS:\n${((closed ?? []) as { title: string; entity: string; lessons: string }[]).map((c) => `- ${c.title} (${c.entity}): ${c.lessons.slice(0, 600)}`).join("\n") || "none yet"}`,
    `EASA EASY ACCESS RULES LOADED IN S.A.M. FOR THIS ENTITY: ${((regs ?? []) as { title: string }[]).map((r) => r.title).join("; ") || "none"}.`,
  ].join("\n\n");
  return { text, posts: new Set([...posts.map((p) => p.code.toUpperCase()), ...GENERAL_POSTS]), manuals: new Set(manuals.map((m) => m.code.toUpperCase())), types: new Set(ty.map((t) => t.code.toUpperCase())) };
}

/** Makes whatever came back safe to create: known phases, unique keys, real dependencies without loops, links that exist. */
export function sanitizePlan(raw: unknown, known: { posts: Set<string>; manuals: Set<string>; types: Set<string> } | null): Plan {
  const j = (raw ?? {}) as Record<string, unknown>;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, 400));
  const phases: Plan["phases"] = []; const pk = new Set<string>();
  for (const p of (Array.isArray(j.phases) ? j.phases : []) as Record<string, unknown>[]) { const label = String(p?.label ?? "").trim().slice(0, 80); let key = slug(String(p?.key ?? label)) || `p${phases.length + 1}`; if (!label) continue; while (pk.has(key)) key += "_"; pk.add(key); phases.push({ key, label }); if (phases.length >= 10) break; }
  if (!phases.length) { phases.push({ key: "tasks", label: "Tasks" }); pk.add("tasks"); }
  const tasks: PlanTask[] = []; const tk = new Set<string>(); const rename = new Map<string, string>();
  for (const t of (Array.isArray(j.tasks) ? j.tasks : []) as Record<string, unknown>[]) {
    const title = String(t?.title ?? "").trim().slice(0, 200); if (!title) continue;
    const orig = String(t?.key ?? ""); let key = slug(orig || title) || `t${tasks.length + 1}`; while (tk.has(key)) key += "_"; tk.add(key); if (orig) rename.set(orig, key);
    const flags: string[] = [];
    const phase = pk.has(slug(String(t?.phase ?? ""))) ? slug(String(t.phase)) : phases[0].key;
    const owner = String(t?.owner_role ?? "").trim().toUpperCase().replace(/[^A-Z0-9_ -]/g, "").slice(0, 20) || null;
    if (owner && known && !known.posts.has(owner)) flags.push(`post ${owner} is not in the entity's posts`);
    const d = Number(t?.days); const days = Number.isFinite(d) && d > 0 ? Math.min(Math.round(d), 365) : null;
    const link_kind = LINKS.includes(t?.link_kind as LinkKind) ? (t.link_kind as LinkKind) : undefined;
    let link_ref = String(t?.link_ref ?? "").trim().toUpperCase().slice(0, 40) || undefined;
    if (known && link_kind === "manual" && link_ref && !known.manuals.has(link_ref)) { flags.push(`manual ${link_ref} is not in the library yet`); }
    if (known && link_kind === "authority_file" && link_ref && !known.types.has(link_ref)) { flags.push(`no application type ${link_ref}: pick the type when opening the file`); link_ref = undefined; }
    if (!link_kind) link_ref = undefined;
    const basis = String(t?.basis ?? "").trim().slice(0, 300) || undefined;
    const x: PlanTask = { key, phase, title, owner_role: owner, days, deps: (Array.isArray(t?.deps) ? t.deps : []).map(String), basis, source: basis };
    const detail = String(t?.detail ?? "").trim().slice(0, 600); if (detail) x.detail = detail;
    if (link_kind) x.link_kind = link_kind; if (link_ref) x.link_ref = link_ref; if (flags.length) x.flags = flags;
    if (t?.unknown === true) x.unknown = true;
    tasks.push(x); if (tasks.length >= 60) break;
  }
  // dependencies: on kept tasks only, never on itself, and no loop (a dependency that would close a loop is dropped)
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  for (const t of tasks) t.deps = [...new Set((t.deps ?? []).map((d) => rename.get(d) ?? slug(d)).filter((d) => d !== t.key && byKey.has(d)))];
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); return (byKey.get(from)?.deps ?? []).some((d) => reaches(d, to, seen)); };
  for (const t of tasks) t.deps = (t.deps ?? []).filter((d) => !reaches(d, t.key));
  // tasks in the order of their phases
  const ord = new Map(phases.map((p, i) => [p.key, i]));
  tasks.sort((a, b) => (ord.get(a.phase) ?? 0) - (ord.get(b.phase) ?? 0));
  return { summary: String(j.summary ?? "").trim().slice(0, 900), risks: strs(j.risks, 4), assumptions: strs(j.assumptions, 6), questions: strs(j.questions, 6), phases: phases.filter((p) => tasks.some((t) => t.phase === p.key)).length ? phases.filter((p) => tasks.some((t) => t.phase === p.key)) : phases, tasks };
}

/** Rule codes cited by the plan, checked against the EARs loaded for the entity: found = the text is in S.A.M. */
async function checkRules(db: SupabaseClient, entity: string, plan: Plan): Promise<void> {
  const per = plan.tasks.map((t) => ruleCodesIn(`${t.basis ?? ""} ${t.detail ?? ""} ${t.title}`));
  const all = [...new Set(per.flat())]; if (!all.length) return;
  const { data: regs } = await db.from("regulations").select("id,items_version").contains("entities", [entity]).not("items_version", "is", null);
  const found = new Set<string>();
  for (const r of (regs ?? []) as { id: string; items_version: string }[]) {
    const { data } = await db.from("regulation_items").select("code").eq("regulation_id", r.id).eq("version", r.items_version).in("code", all).limit(500);
    for (const x of (data ?? []) as { code: string }[]) found.add(x.code.toUpperCase());
  }
  plan.tasks.forEach((t, i) => { if (per[i].length) t.rules = per[i].map((code) => ({ code, found: found.has(code) })); });
}

export async function researchPlan(db: SupabaseClient, who: { personId: string | null }, input: PlanInput): Promise<PlanResult> {
  const ctx = await contextFor(db, input.entity);
  const user = [
    `PROJECT: ${input.title}`,
    `WHAT IT MUST ACHIEVE: ${input.goal}`,
    input.context ? `CONTEXT AND CONSTRAINTS GIVEN BY THE OWNER: ${input.context}` : "",
    input.target ? `TARGET DATE: ${input.target} (today: ${new Date().toISOString().slice(0, 10)}). Say in the summary whether the plan fits.` : "",
    `WHAT S.A.M. HOLDS:\n${ctx.text}`,
    input.previous ? `YOUR PREVIOUS PROPOSAL (JSON):\n${JSON.stringify({ ...input.previous, tasks: input.previous.tasks.map(({ rules: _r, flags: _f, source: _s, ...t }) => t) })}\n\nTHE OWNER ASKS TO CHANGE IT: ${input.feedback ?? ""}\nReturn the full corrected plan (keep the keys of the tasks you keep).` : "",
  ].filter(Boolean).join("\n\n");
  const r = await callClaudeResearch({ agent: "plan", personId: who.personId, entity: input.entity, system: SYSTEM, user, maxTokens: 12000, web: input.web, maxSearches: input.previous ? 3 : 6 });
  const m = /\{[\s\S]*\}/.exec(r.text);
  if (!m) throw new Error("S.A.M. did not return a plan. Ask again, or with a narrower description.");
  let raw: unknown;
  try { raw = JSON.parse(m[0]); } catch { throw new Error("The plan was cut before the end. Ask again with a narrower project, or split it in two."); }
  const plan = sanitizePlan(raw, ctx);
  if (!plan.tasks.length) throw new Error("S.A.M. returned no task. Say more about what the project must achieve.");
  await checkRules(db, input.entity, plan).catch(() => {});
  return { plan, sources: r.sources.slice(0, 40), searches: r.searches, model: r.model, webNote: r.webNote, context: `${ctx.posts.size} posts, ${ctx.manuals.size} manuals, ${ctx.types.size} application types` };
}
