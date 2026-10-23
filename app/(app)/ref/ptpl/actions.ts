"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { ENTS4 } from "@/lib/nav";
import type { ProjectTemplate, TemplateTask } from "@/lib/projects";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lines = (fd: FormData, k: string) => str(fd, k).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
const LINKS = ["manual", "authority_file", "certificate", "moc"];

/**
 * Phases: one per line "key | Label". Tasks: one per line
 * "key | phase | Title | ROLE | days | dep1,dep2 | link_kind:REF | detail".
 * Empty fields are allowed ("key | phase | Title"). Keys must be unique; dependencies and phases must exist.
 */
function parseTemplate(fd: FormData): { phases: ProjectTemplate["phases"]; tasks: TemplateTask[] } {
  const phases = lines(fd, "phases").map((l) => { const [k = "", label = ""] = l.split("|").map((x) => x.trim()); return { key: slug(k) || slug(label), label: label || k }; }).filter((p) => p.key && p.label);
  const pk = new Set(phases.map((p) => p.key));
  if (!phases.length) throw new Error("At least one phase.");
  const tasks: TemplateTask[] = lines(fd, "tasks").map((l, i) => {
    const c = l.split("|").map((x) => x.trim());
    const [k = "", phase = "", title = "", role = "", days = "", deps = "", link = "", detail = ""] = c;
    const key = slug(k) || slug(title) || `t${i + 1}`;
    if (!title) throw new Error(`Line ${i + 1}: a title is required.`);
    if (!pk.has(slug(phase))) throw new Error(`Line ${i + 1} (${title}): unknown phase “${phase}”.`);
    const t: TemplateTask = { key, phase: slug(phase), title, owner_role: role ? role.toUpperCase() : null, days: days ? Number(days) || null : null, deps: deps ? deps.split(",").map((d) => slug(d)).filter(Boolean) : [] };
    if (link) { const [kind, ref] = link.split(":").map((x) => x.trim()); if (!LINKS.includes(kind)) throw new Error(`Line ${i + 1} (${title}): unknown link kind “${kind}” (manual, authority_file, certificate, moc).`); t.link_kind = kind as TemplateTask["link_kind"]; if (ref) t.link_ref = ref.toUpperCase(); }
    if (detail) t.detail = detail;
    return t;
  });
  const keys = new Set<string>();
  for (const t of tasks) { if (keys.has(t.key)) throw new Error(`Duplicate task key “${t.key}”.`); keys.add(t.key); }
  for (const t of tasks) for (const d of t.deps ?? []) if (!keys.has(d)) throw new Error(`Task “${t.title}” depends on unknown key “${d}”.`);
  return { phases, tasks };
}

/** References › Project templates: Compliance maintains the catalogue. A change applies to projects opened afterwards. */
export async function saveTemplate(formData: FormData) {
  const s = await getSession();
  if (!s || !isCmm(s)) throw new Error("Compliance only");
  const db = supabaseAdmin();
  const code = str(formData, "code").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!code) throw new Error("A code is required");
  const { data: before } = await db.from("project_templates").select("*").eq("code", code).maybeSingle();
  const prev = (before as ProjectTemplate | null) ?? null;
  const { phases, tasks } = parseTemplate(formData);
  const row = { code, name: str(formData, "name") || code, description: str(formData, "description") || null, entities: ENTS4.filter((e) => formData.get(`ent_${e}`) === "on"), phases, tasks,
    pivots: ["aircraft_type", "aircraft_reg", "np_post_code"].filter((k) => formData.get(`pivot_${k}`) === "on"), active: formData.get("active") === "on", ord: Number(str(formData, "ord")) || prev?.ord || 99 };
  const { error } = prev ? await db.from("project_templates").update(row).eq("code", code) : await db.from("project_templates").insert(row);
  if (error) throw new Error(error.message);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: null, object_type: "project_template", object_id: code, action: prev ? "template_updated" : "template_created", before: prev, after: row });
  revalidatePath("/ref/ptpl"); revalidatePath("/proj/boards/new");
}
