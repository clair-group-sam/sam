"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";

/** NP management: Compliance maintains the posts of each entity (holders, deputies, reporting lines, acceptance). */
export async function savePost(formData: FormData) {
  const s = await getSession();
  if (!s || !isCmm(s)) return;
  const entity = String(formData.get("entity") ?? "");
  if (!s.group && !s.entities.includes(entity)) return;
  const id = String(formData.get("id") ?? "");
  const v = (k: string) => { const x = String(formData.get(k) ?? "").trim(); return x || null; };
  const row = { entity, code: (v("code") ?? "").toUpperCase(), title: v("title") ?? "", parent_code: v("parent_code"), ord: Number(formData.get("ord") ?? 0) || 0,
    holder_name: v("holder_name"), deputy_name: v("deputy_name"), status: v("status") ?? "accepted", since: v("since"), regulatory: v("regulatory"), updated_at: new Date().toISOString(), updated_by: s.person?.id ?? null };
  if (!row.code || !row.title) return;
  const db = supabaseAdmin();
  const { data: before } = id ? await db.from("np_posts").select("*").eq("id", id).maybeSingle() : { data: null };
  if (id) await db.from("np_posts").update(row).eq("id", id); else await db.from("np_posts").insert(row);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "np_post", object_id: id || row.code, action: id ? "np_post_updated" : "np_post_created", before, after: row });
  revalidatePath("/np/over");
}
export async function deletePost(formData: FormData) {
  const s = await getSession();
  if (!s || !isCmm(s)) return;
  const id = String(formData.get("id") ?? "");
  const db = supabaseAdmin();
  const { data: before } = await db.from("np_posts").select("*").eq("id", id).maybeSingle();
  if (!before || (!s.group && !s.entities.includes((before as { entity: string }).entity))) return;
  await db.from("np_posts").delete().eq("id", id);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: (before as { entity: string }).entity, object_type: "np_post", object_id: id, action: "np_post_deleted", before });
  revalidatePath("/np/over");
}

/** FB-075 · an entity with no post yet: take them from its Crisis directory (unit members attached to a post, with the name written there).
 *  Created as "pending": the CMM checks the titles, the reporting lines and the authority acceptance afterwards. */
export async function seedPostsFromErp(formData: FormData) {
  const s = await getSession();
  if (!s || !isCmm(s)) return;
  const entity = String(formData.get("entity") ?? "");
  if (!entity || (!s.group && !s.entities.includes(entity))) return;
  const db = supabaseAdmin();
  const { count } = await db.from("np_posts").select("id", { count: "exact", head: true }).eq("entity", entity);
  if (count) return; // only for an empty entity
  const { data } = await db.from("erp_contacts").select("crisis_role,post,name,ord").eq("entity", entity).eq("active", true).eq("kind", "internal").not("post", "is", null).order("ord");
  const seen = new Set<string>(); const rows: Record<string, unknown>[] = [];
  for (const c of (data ?? []) as { crisis_role: string; post: string; name: string | null; ord: number }[]) {
    for (const code of c.post.split(/[,;\/\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)) {
      if (seen.has(code)) continue; seen.add(code);
      rows.push({ entity, code, title: c.crisis_role.replace(/,.*$/, "").slice(0, 120), parent_code: code === "AM" ? null : "AM", ord: rows.length * 10, holder_name: c.name, status: "pending", updated_at: new Date().toISOString(), updated_by: s.person?.id ?? null });
    }
  }
  if (!rows.length) return;
  await db.from("np_posts").insert(rows);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "np_post", object_id: entity, action: "np_posts_seeded_from_erp", after: { posts: rows.map((r) => r.code) } });
  revalidatePath("/np/over");
}
