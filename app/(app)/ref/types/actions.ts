"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { ENTS4 } from "@/lib/nav";
import { CATEGORY_LABEL, FAMILIES, type ChecklistItem, type FileType } from "@/lib/authority";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lines = (fd: FormData, k: string) => str(fd, k).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `i${Date.now().toString(36)}`;

/**
 * Checklist typed one item per line: "Label | ROLE | optional". Keys of existing items are kept (matched by label) so files
 * opened earlier keep their meaning; new items get a key from their label.
 */
function parseChecklist(text: string[], previous: ChecklistItem[]): ChecklistItem[] {
  const used = new Set<string>();
  return text.map((line) => {
    const [label = "", role = "", flag = ""] = line.split("|").map((x) => x.trim());
    const prev = previous.find((p) => p.label.toLowerCase() === label.toLowerCase());
    let key = prev?.key ?? slug(label);
    while (used.has(key)) key = `${key}_`;
    used.add(key);
    return { key, label, role: role || null, required: !/^(optional|opt|o)$/i.test(flag) };
  }).filter((c) => c.label);
}

/** References › Authority application types: Compliance maintains the catalogue. A change applies to files opened afterwards. */
export async function saveType(formData: FormData) {
  const s = await getSession();
  if (!s || !isCmm(s)) throw new Error("Compliance only");
  const db = supabaseAdmin();
  const code = str(formData, "code").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!code) throw new Error("A code is required");
  const { data: before } = await db.from("authority_file_types").select("*").eq("code", code).maybeSingle();
  const prev = (before as FileType | null) ?? null;
  const entities = ENTS4.filter((e) => formData.get(`ent_${e}`) === "on");
  const routes: FileType["routes"] = {};
  for (const e of entities) {
    const portal = str(formData, `portal_${e}`); const category = str(formData, `category_${e}`) || "approval";
    if (!(category in CATEGORY_LABEL)) throw new Error(`Unknown category for ${e}`);
    routes[e] = { portal, category };
  }
  const family = str(formData, "family");
  if (!FAMILIES.includes(family)) throw new Error("Unknown family");
  const row = {
    code, family, name: str(formData, "name") || code, entities, routes,
    checklist: parseChecklist(lines(formData, "checklist"), prev?.checklist ?? []),
    closeout: lines(formData, "closeout"),
    default_owner_role: str(formData, "default_owner_role").toUpperCase() || null,
    needs_signature: formData.get("needs_signature") === "on",
    target_days: Math.max(0, Number(str(formData, "target_days")) || 20),
    ord: Number(str(formData, "ord")) || prev?.ord || 999,
    active: formData.get("active") === "on",
    notes: str(formData, "notes") || null,
  };
  if (!row.name) throw new Error("A name is required");
  const { error } = prev ? await db.from("authority_file_types").update(row).eq("code", code) : await db.from("authority_file_types").insert(row);
  if (error) throw new Error(error.message);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: null, object_type: "authority_file_type", object_id: code, action: prev ? "type_updated" : "type_created", before: prev, after: row });
  revalidatePath("/ref/types"); revalidatePath("/proj/auth/new");
}
