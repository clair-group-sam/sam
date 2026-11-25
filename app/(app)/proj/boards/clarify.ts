"use server";
import { revalidatePath } from "next/cache";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { loadTypes } from "@/lib/authority";
import { callClaudeResearch } from "@/lib/ai";
import { ENT } from "@/lib/nav";
import type { Project, Task } from "@/lib/projects";

const SYSTEM = `You name and explain the applications a project files with aviation authorities, for the people who run the project.
For each application given, return:
- name: the application exactly as that authority names it (form number and official title when there is one, e.g. "Form SM 13: maintenance programme declaration"). Use web search to confirm the official name on the authority's own site when you are not sure. Never invent a form number: if you cannot confirm an official name, give the plainest accurate name, without a verb ("Validation of foreign pilot licences", not "Apply for …").
- what: ONE plain sentence, 25 words at most: what is asked of the authority and what the company holds once it is granted. No jargon left unexplained, no "ensure", no reference to other tasks.
- confirmed: true only if you found the official name on an official source.
Write in English. Answer ONLY with JSON: {"apps":[{"id":"…","name":"…","what":"…","confirmed":true}]}`;

/** Projects · Applications: S.A.M. gives each application still to file its official name and one sentence on what it is for.
 *  The former title and detail are kept in the audit log. Owner of the project or Compliance. */
export async function clarifyApplications(projectId: string): Promise<{ ok: true; changed: number; unconfirmed: number } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return { ok: false, error: "Not signed in." };
  const db = supabaseAdmin();
  const { data: pr } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
  const p = pr as Project | null;
  if (!p || (!s.group && !s.entities.includes(p.entity))) return { ok: false, error: "Project not found." };
  const owner = p.owner_person ? s.person?.id === p.owner_person : !!p.owner_role && s.roles.map(basePost).includes(basePost(p.owner_role));
  if (!isCmm(s) && !owner) return { ok: false, error: "Only the project owner or Compliance can rename the applications." };
  const { data: td } = await db.from("project_tasks").select("*").eq("project_id", p.id).eq("link_kind", "authority_file").is("link_id", null).not("status", "in", "(done,not_needed)").order("ord");
  const apps = (td ?? []) as Task[];
  if (!apps.length) return { ok: false, error: "No application left to file in this project." };
  const types = new Map((await loadTypes(db)).map((t) => [t.code, t]));
  const user = [
    `PROJECT: ${p.title} (${ENT[p.entity]?.name ?? p.entity})`,
    p.description ? `ABOUT: ${p.description.slice(0, 1500)}` : "",
    `APPLICATIONS:\n${apps.map((a) => { const ty = a.link_ref ? types.get(a.link_ref) : undefined; return `- id ${a.id}: "${a.title}"${a.detail ? ` | detail: ${a.detail.slice(0, 300)}` : ""}${a.source ? ` | basis: ${a.source.slice(0, 200)}` : ""}${ty ? ` | S.A.M. type: ${ty.name}, filed on ${ty.routes?.[p.entity]?.portal ?? "?"}` : ""}`; }).join("\n")}`,
  ].filter(Boolean).join("\n\n");
  let out: { id?: string; name?: string; what?: string; confirmed?: boolean }[] = [];
  try {
    const r = await callClaudeResearch({ agent: "plan", personId: s.person?.id ?? null, entity: p.entity, system: SYSTEM, user, maxTokens: 3000, web: true, maxSearches: 4 });
    const m = /\{[\s\S]*\}/.exec(r.text); out = m ? ((JSON.parse(m[0]) as { apps?: typeof out }).apps ?? []) : [];
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "S.A.M. could not read the applications." }; }
  let changed = 0, unconfirmed = 0;
  for (const a of apps) {
    const x = out.find((o) => o.id === a.id); if (!x) continue;
    const name = String(x.name ?? "").trim().slice(0, 200), what = String(x.what ?? "").trim().slice(0, 400);
    if (!name || !what) continue;
    if (x.confirmed !== true) unconfirmed++;
    if (name === a.title && what === a.detail) continue;
    await db.from("project_tasks").update({ title: name, detail: what, updated_at: new Date().toISOString() }).eq("id", a.id);
    await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: p.entity, object_type: "project_task", object_id: a.id, action: "application_named_by_sam", before: { title: a.title, detail: a.detail }, after: { title: name, detail: what, official_name_confirmed: x.confirmed === true } });
    changed++;
  }
  revalidatePath(`/proj/boards/${p.id}`);
  return { ok: true, changed, unconfirmed };
}
