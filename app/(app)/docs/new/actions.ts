"use server";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { mayCreateManual } from "@/lib/create";
import { isCmm } from "@/lib/revisions";


/** New manual: Issue 1 Rev 00 as a draft with the chapters typed by its author, then the editor. */
export async function createManual(formData: FormData) {
  const s = await getSession();
  if (!s || !(await mayCreateManual(s))) throw new Error("You are not allowed to create a manual.");
  const entity = String(formData.get("entity") ?? "");
  if (!s.group && !s.entities.includes(entity)) throw new Error("Entity outside your access.");
  const code = String(formData.get("code") ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  const title = String(formData.get("title") ?? "").trim();
  const folder = String(formData.get("folder_new") ?? "").trim() || String(formData.get("folder") ?? "").trim() || null;
  const owner = String(formData.get("owner") ?? "");
  const internal = formData.get("internal") === "on" && isCmm(s); // regulated by default; only Compliance classifies a document as internal
  if (!code || !title || !owner) throw new Error("Code, title and owner are required.");
  const db = supabaseAdmin();
  const { data: dup } = await db.from("manuals").select("id").eq("entity", entity).eq("code", code).maybeSingle();
  if (dup) throw new Error(`${entity} already has a manual ${code}.`);
  const ownerName = owner.startsWith("PERSON:") ? s.name : null;
  const { data: m, error } = await db.from("manuals").insert({ entity, code, title, owner_role: owner, owner_name: ownerName, path: folder, internal, created_by: s.person?.id ?? null, needs_signature: false, to_tmcad_repository: false }).select("id").single();
  if (error || !m) throw new Error(error?.message ?? "Manual not created");
  const { data: r, error: e2 } = await db.from("revisions").insert({ manual_id: m.id, issue: 1, rev: "00", step: "draft", authority_route: internal ? "none" : null, summary: "Initial issue", created_by: s.person?.id ?? null, step_changed_by: s.person?.id ?? null }).select("id").single();
  if (e2 || !r) throw new Error(e2?.message ?? "Revision not created");
  // chapters: one per line, "1.2 Scope" keeps its number, a plain title is numbered in order
  const lines = String(formData.get("chapters") ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  let n = 0;
  const rows = (lines.length ? lines : ["Introduction"]).map((l, ord) => {
    const mm = /^([A-Z]{0,2}\d+(?:\.\d+)*)\s*[-–.:]?\s+(.+)$/.exec(l);
    const ref = mm ? mm[1] : String(++n);
    const t = mm ? mm[2] : l;
    return { revision_id: r.id, ord: ord + 1, ref, title: t, changed: true, body: { html: "<p></p>", text: "", headings: [], structured: true, base_html: "", base_norm: null, uid: randomUUID() } };
  });
  await db.from("revision_sections").insert(rows);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "manual", object_id: m.id, action: "manual_created", after: { code, title, owner, internal, chapters: rows.length } });
  revalidatePath("/docs/lib");
  redirect(`/docs/editor/${r.id}?tab=write`);
}

/** Compliance names the people (without an NP / AM post) who may create manuals. */
export async function setCreators(formData: FormData) {
  const s = await getSession();
  if (!s || !isCmm(s)) return;
  const ids = formData.getAll("person").map(String);
  const db = supabaseAdmin();
  await db.from("people").update({ can_create_manuals: false }).eq("can_create_manuals", true);
  if (ids.length) await db.from("people").update({ can_create_manuals: true }).in("id", ids);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: null, object_type: "people", object_id: "can_create_manuals", action: "creators", after: { count: ids.length } });
  revalidatePath("/docs/new");
}
