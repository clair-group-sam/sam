"use server";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSections, type WmBundle } from "@/lib/wm-import";
import { structureHtml } from "@/lib/docs";

/* WM-03 · Web Manuals bridge: a whole Web Manuals root imported in one run. The Web Manuals tab reads each document (read-only)
 * and hands it to the bridge page, which stores the images and files, then calls these actions. CMM / SUPERADMIN only. */
export type BridgeMeta = {
  kind: "pages" | "file"; entity: string; code: string; title: string; path: string | null; wmId: number;
  internal?: boolean; ownerRole?: string; aircraftTypes?: string[];
  draft?: boolean; changedPages?: number;                 // pages: the working revision of Web Manuals, imported as a draft
  imageExt?: Record<string, string>; imageBase?: string; stash?: string;   // pages: bundle JSON parked in the bucket (too big for a request)
  filePath?: string; cert?: { scope: "organisation" | "aircraft"; registration: string | null; kind: string; folder: string | null; issuer: string | null };
};
export type BridgeResult = { ok: true; info: string } | { ok: false; error: string };

async function gate(entity: string) {
  const s = await getSession();
  if (!s || !(s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"))) return { s: null, error: "Compliance department only." };
  if (!s.group && !s.entities.includes(entity)) return { s: null, error: "Entity out of your scope." };
  return { s, error: "" };
}

export async function bridgeImport(meta: BridgeMeta): Promise<BridgeResult> {
  const { s, error } = await gate(meta.entity);
  if (!s) return { ok: false, error };
  try { return meta.kind === "file" ? await importFile(meta, s.person?.id ?? null) : await importPages(meta, s.person?.id ?? null, s.email); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

async function importPages(meta: BridgeMeta, personId: string | null, email: string): Promise<BridgeResult> {
  const db = supabaseAdmin();
  if (!meta.stash) return { ok: false, error: "No bundle." };
  const { data: blob, error: de } = await db.storage.from("manuals").download(meta.stash);
  if (de || !blob) return { ok: false, error: `bundle not readable: ${de?.message ?? "missing"}` };
  const b = JSON.parse(await blob.text()) as WmBundle;
  if (!b.pages?.length) return { ok: false, error: "Empty document (no page)." };
  const rev = (b.manual.rev ?? "").trim() || "00";
  const issue = parseInt(b.manual.issue ?? "1", 10) || 1;
  // manual: created with the Web Manuals folder as its place in the library; an existing one keeps its owner
  const { data: m0 } = await db.from("manuals").select("id").eq("entity", meta.entity).eq("code", meta.code).maybeSingle();
  let manualId = m0?.id as string | undefined;
  if (!manualId) {
    const { data: m1, error } = await db.from("manuals").insert({ entity: meta.entity, code: meta.code, title: meta.title || b.manual.name, owner_role: meta.ownerRole ?? "CMM", path: meta.path, internal: !!meta.internal, aircraft_types: meta.aircraftTypes ?? [], created_by: personId }).select("id").single();
    if (error || !m1) return { ok: false, error: error?.message ?? "manual not created" };
    manualId = m1.id as string;
  } else await db.from("manuals").update({ title: meta.title || b.manual.name, path: meta.path, internal: !!meta.internal }).eq("id", manualId);
  const source = { system: "webmanuals", manualId: b.manual.wmId, revisionId: b.manual.revisionId, pdfURL: b.manual.pdfURL ?? null, revisionDate: b.manual.revisionDate ?? null, importedAt: new Date().toISOString(), by: email, bridge: true, draft: !!meta.draft };
  const { data: r0 } = await db.from("revisions").select("id,step,source").eq("manual_id", manualId).eq("rev", rev).eq("issue", issue).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let revisionId = r0?.id as string | undefined;
  if (meta.draft) {
    // the working revision of Web Manuals: a draft in S.A.M., based on the last published revision; never written over a draft edited in S.A.M.
    if (r0 && r0.step !== "draft") return { ok: false, error: `Iss ${issue} Rev ${rev} already exists in S.A.M. at step ${r0.step}: the Web Manuals draft was not imported.` };
    if (r0 && (r0.source as { system?: string } | null)?.system !== "webmanuals") return { ok: false, error: `A draft Iss ${issue} Rev ${rev} written in S.A.M. already exists: left untouched.` };
    const { data: base } = await db.from("revisions").select("id").eq("manual_id", manualId).in("step", ["published", "repository"]).order("published_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const summary = `Draft in progress in Web Manuals, imported on ${new Date().toISOString().slice(0, 10)}${meta.changedPages ? `, ${meta.changedPages} page${meta.changedPages > 1 ? "s" : ""} changed since the published revision` : base ? "" : ", never published in Web Manuals"}`;
    if (!revisionId) {
      const { data: r1, error } = await db.from("revisions").insert({ manual_id: manualId, issue, rev, step: "draft", authority_route: meta.internal ? "none" : null, summary, created_by: personId, step_changed_by: personId, based_on: base?.id ?? null, source }).select("id").single();
      if (error || !r1) return { ok: false, error: error?.message ?? "draft not created" };
      revisionId = r1.id as string;
    } else await db.from("revisions").update({ source, summary, based_on: base?.id ?? null }).eq("id", revisionId);
  } else {
    const published = b.manual.publishedDate ? b.manual.publishedDate.slice(0, 10) : null;
    if (r0 && r0.step === "draft") return { ok: false, error: `Iss ${issue} Rev ${rev} is a draft in S.A.M.: the published revision of Web Manuals was not written over it.` };
    if (!revisionId) {
      const { data: r1, error } = await db.from("revisions").insert({ manual_id: manualId, issue, rev, step: "published", authority_route: meta.internal ? "none" : null, summary: `Imported from Web Manuals · revision date ${b.manual.revisionDate ?? "?"}`, published_at: published, source }).select("id").single();
      if (error || !r1) return { ok: false, error: error?.message ?? "revision not created" };
      revisionId = r1.id as string;
    } else await db.from("revisions").update({ source, published_at: published ?? undefined }).eq("id", revisionId);
  }
  const ext = meta.imageExt ?? {};
  const sections = buildSections(b, (id) => `${meta.imageBase}/${id}.${ext[id] ?? "png"}`);
  await db.from("revision_sections").delete().eq("revision_id", revisionId);
  const rows = sections.map((x) => { const st = structureHtml(x.html, `s${x.ord}`, x.ref); return { revision_id: revisionId, ord: x.ord, ref: x.ref, title: x.title, changed: x.changed, body: { html: st.html, text: x.text, pages: x.pages, page_revs: x.pageRevs, page_ids: x.pageIds, page_meta: x.pageMeta, page_start: x.start, uid: createHash("md5").update(`${manualId}:${x.ref}`).digest("hex"), headings: st.headings, structured: true } }; });
  for (let i = 0; i < rows.length; i += 40) { const { error } = await db.from("revision_sections").insert(rows.slice(i, i + 40)); if (error) return { ok: false, error: error.message }; }
  await db.from("audit_log").insert({ actor: personId, entity: meta.entity, object_type: "revision", object_id: revisionId, action: "import_webmanuals", after: { code: meta.code, rev, issue, draft: !!meta.draft, sections: rows.length, pages: b.pages.length, images: Object.keys(b.images ?? {}).length, wmId: meta.wmId, via: "bridge" } });
  await db.storage.from("manuals").remove([meta.stash]);
  revalidatePath("/docs/lib");
  return { ok: true, info: `${meta.code} Iss ${issue} Rev ${rev} ${meta.draft ? "draft" : "published"}: ${rows.length} chapters, ${b.pages.length} pages` };
}

async function importFile(meta: BridgeMeta, personId: string | null): Promise<BridgeResult> {
  const db = supabaseAdmin();
  if (!meta.filePath || !meta.cert) return { ok: false, error: "File not uploaded." };
  const prefix = `certificates/${meta.entity}/wm/${meta.wmId}/`;
  const { data: existing } = await db.from("certificates").select("id").eq("entity", meta.entity).like("file_path", `${prefix}%`).limit(1).maybeSingle();
  const row = { entity: meta.entity, scope: meta.cert.scope, registration: meta.cert.registration, kind: meta.cert.kind, title: meta.title, issuer: meta.cert.issuer, file_path: meta.filePath, folder: meta.cert.folder, uploaded_by: personId, uploaded_at: new Date().toISOString() };
  let id = existing?.id as string | undefined;
  if (id) { const { error } = await db.from("certificates").update(row).eq("id", id); if (error) return { ok: false, error: error.message }; }
  else { const { data: ins, error } = await db.from("certificates").insert(row).select("id").single(); if (error || !ins) return { ok: false, error: error?.message ?? "not created" }; id = ins.id as string; }
  await db.from("audit_log").insert({ actor: personId, entity: meta.entity, object_type: "certificate", object_id: id, action: "import_webmanuals_file", after: { title: meta.title, wmId: meta.wmId, folder: meta.cert.folder, via: "bridge" } });
  revalidatePath("/docs/files");
  return { ok: true, info: `${meta.title} → ${meta.cert.folder ?? "Certificates"}` };
}

/** What S.A.M. holds for the entity, to check the run against Web Manuals. */
export async function bridgeStats(entity: string): Promise<{ ok: boolean; error?: string; manuals?: { code: string; path: string | null; internal: boolean; revs: { issue: number; rev: string; step: string; sections: number }[] }[]; certificates?: { folder: string; n: number }[] }> {
  const { s, error } = await gate(entity);
  if (!s) return { ok: false, error };
  const db = supabaseAdmin();
  const { data: ms } = await db.from("manuals").select("id,code,path,internal").eq("entity", entity).order("code");
  const manuals = (ms ?? []) as { id: string; code: string; path: string | null; internal: boolean }[];
  const { data: rs } = manuals.length ? await db.from("revisions").select("id,manual_id,issue,rev,step,revision_sections(count)").in("manual_id", manuals.map((m) => m.id)) : { data: [] };
  const revs = (rs ?? []) as unknown as { manual_id: string; issue: number; rev: string; step: string; revision_sections: { count: number }[] }[];
  const { data: cs } = await db.from("certificates").select("folder").eq("entity", entity).is("archived_at", null);
  const folders = new Map<string, number>(); for (const c of (cs ?? []) as { folder: string | null }[]) folders.set(c.folder ?? "Unfiled", (folders.get(c.folder ?? "Unfiled") ?? 0) + 1);
  return { ok: true, manuals: manuals.map((m) => ({ code: m.code, path: m.path, internal: m.internal, revs: revs.filter((r) => r.manual_id === m.id).map((r) => ({ issue: r.issue, rev: r.rev, step: r.step, sections: r.revision_sections?.[0]?.count ?? 0 })) })), certificates: [...folders].map(([folder, n]) => ({ folder, n })) };
}
