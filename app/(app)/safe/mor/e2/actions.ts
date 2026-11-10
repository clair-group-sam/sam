"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";
import { eccairsConfig, eccairsEnv, loadLongLists, loadTaxonomy, taxonomyVersion } from "@/lib/eccairs";
import { autoMaps } from "@/lib/eccairs-map";

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
  try { const r = await loadTaxonomy(db(), entity); note = `Taxonomy ${r.name} ${r.version}: ${r.attributes} attributes, ${r.values} values cached`; }
  catch (e) {
    note = (e as Error).message;
    // the proxy or E2 is down: the released taxonomy is the same for every entity on the same environment — reuse what another entity cached
    const { data: other } = await db().from("eccairs_taxonomies").select("*").neq("entity", entity).order("loaded_at", { ascending: false }).limit(5);
    const src = ((other ?? []) as { entity: string; env: string | null; taxonomy_id: number; name: string; version: string; loaded_at: string; attributes: number; values: number }[]).find((o) => o.env === eccairsEnv(entity));
    if (src) { await db().from("eccairs_taxonomies").upsert({ entity, taxonomy_id: src.taxonomy_id, name: src.name, version: src.version, env: src.env, loaded_at: src.loaded_at, attributes: src.attributes, values: src.values }, { onConflict: "entity" }); note = `E2 not reachable (${note}) — taxonomy ${src.name} ${src.version} reused from ${src.entity}'s cache (same environment, loaded ${src.loaded_at.slice(0, 16).replace("T", " ")})`; }
  }
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
export async function proposeMaps(fd: FormData) {
  const entity = String(fd.get("entity")); const s = await me(entity);
  let note: string;
  try { const r = await autoMaps(db(), entity); note = `${r.proposed} correspondence(s) proposed from the names${r.unresolved.length ? ` · not found: ${r.unresolved.slice(0, 12).join("; ")}${r.unresolved.length > 12 ? "…" : ""}` : ""}`; } catch (e) { note = (e as Error).message; }
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "eccairs", object_id: null, action: "eccairs_maps_proposed", after: { note } });
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
