"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { eccairsConfig, loadLongLists, loadTaxonomy, taxonomyVersion } from "@/lib/eccairs";

/* ECC-01 · the link with E2 for the safety desk: test, taxonomy cache, correspondences between S.A.M. values and E2 value ids. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
async function me(entity: string) { const s = await getSession(); if (!s || !isSafetyDesk(s)) throw new Error("Reserved to the safety desk."); if (!s.group && !s.entities.includes(entity)) throw new Error("Entity out of scope"); return s; }
const touch = () => { revalidatePath("/safe/mor/e2"); revalidatePath("/safe/mor"); };

export async function testLink(fd: FormData) {
  const entity = String(fd.get("entity")); const s = await me(entity);
  if (!eccairsConfig(entity)) throw new Error(`ECCAIRS is not configured for ${entity}.`);
  let note: string; let ok = false;
  try { const t = await taxonomyVersion(entity); const d = (Array.isArray(t.data) ? t.data[0] : t.data) as { name?: string; version?: string }; note = `Connected · ${d?.name ?? ""} ${d?.version ?? ""}`.trim(); ok = true; } catch (e) { note = (e as Error).message; }
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "eccairs", object_id: null, action: ok ? "eccairs_test_ok" : "eccairs_test_failed", after: { note } });
  touch(); redirect(`/safe/mor/e2?ent=${entity}&msg=${encodeURIComponent(note)}`);
}
export async function loadTax(fd: FormData) {
  const entity = String(fd.get("entity")); const s = await me(entity);
  let note: string;
  try { const r = await loadTaxonomy(db(), entity); note = `Taxonomy ${r.name} ${r.version}: ${r.attributes} attributes, ${r.values} values cached`; } catch (e) { note = (e as Error).message; }
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "eccairs", object_id: null, action: "eccairs_taxonomy_loaded", after: { note } });
  touch(); redirect(`/safe/mor/e2?ent=${entity}&msg=${encodeURIComponent(note)}`);
}
export async function loadLong(fd: FormData) {
  const entity = String(fd.get("entity")); const s = await me(entity);
  let note: string;
  try { const r = await loadLongLists(db(), entity); note = `Long lists cached: ${r.values} values in ${r.lists} lists (aircraft make/model, operators)`; } catch (e) { note = (e as Error).message; }
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "eccairs", object_id: null, action: "eccairs_taxonomy_loaded", after: { note } });
  touch(); redirect(`/safe/mor/e2?ent=${entity}&msg=${encodeURIComponent(note)}`);
}
export async function saveMap(fd: FormData) {
  const entity = String(fd.get("entity")); await me(entity);
  const field = str(fd, "field"), our = str(fd, "our_value"); const attribute = Number(fd.get("attribute_code")); const vid = str(fd, "value_id");
  if (!field || !our || !attribute) throw new Error("Field, our value and attribute are required.");
  if (fd.get("what") === "remove") await db().from("eccairs_value_maps").delete().eq("entity", entity).eq("field", field).eq("our_value", our);
  else await db().from("eccairs_value_maps").upsert({ entity, field, our_value: our, attribute_code: attribute, value_id: vid ? Number(vid) : null, note: str(fd, "note"), updated_at: new Date().toISOString() }, { onConflict: "entity,field,our_value" });
  touch();
}
