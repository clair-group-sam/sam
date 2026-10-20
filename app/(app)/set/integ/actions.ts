"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSections, type WmBundle } from "@/lib/wm-import";
import { structureHtml } from "@/lib/docs";

export type ImportInput = { entity: string; code: string; title: string; path?: string; ownerRole?: string; bundle: WmBundle; imageExt: Record<string, string> };
export type ImportResult = { ok: true; manualId: string; revisionId: string; sections: number; changed: number } | { ok: false; error: string };

/** Writes a Web Manuals export as a published revision of a manual (images already uploaded by the browser). CMM / SUPERADMIN only. */
export async function importWmBundle(input: ImportInput): Promise<ImportResult> {
  const s = await getSession();
  if (!s || !(s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"))) return { ok: false, error: "Compliance department only." };
  if (!s.group && !s.entities.includes(input.entity)) return { ok: false, error: "Entity out of your scope." };
  const b = input.bundle;
  if (b.format !== "sam-wm-export/1" || !b.pages?.length) return { ok: false, error: "Not a S.A.M. Web Manuals export." };
  const rev = (b.manual.rev ?? "").trim() || "00";
  const issue = parseInt(b.manual.issue ?? "1", 10) || 1;
  const db = supabaseAdmin();
  // manual
  const { data: m0 } = await db.from("manuals").select("id").eq("entity", input.entity).eq("code", input.code).maybeSingle();
  let manualId = m0?.id as string | undefined;
  if (!manualId) {
    const { data: m1, error } = await db.from("manuals").insert({ entity: input.entity, code: input.code, title: input.title || b.manual.name, owner_role: input.ownerRole ?? "CMM", path: input.path ?? null }).select("id").single();
    if (error || !m1) return { ok: false, error: error?.message ?? "manual not created" };
    manualId = m1.id as string;
  }
  // revision (find by issue/rev or create as published)
  const published = b.manual.publishedDate ? b.manual.publishedDate.slice(0, 10) : null;
  const { data: r0 } = await db.from("revisions").select("id").eq("manual_id", manualId).eq("rev", rev).eq("issue", issue).maybeSingle();
  let revisionId = r0?.id as string | undefined;
  const source = { system: "webmanuals", manualId: b.manual.wmId, revisionId: b.manual.revisionId, pdfURL: b.manual.pdfURL ?? null, revisionDate: b.manual.revisionDate ?? null, importedAt: new Date().toISOString(), by: s.email };
  if (!revisionId) {
    const { data: r1, error } = await db.from("revisions").insert({ manual_id: manualId, issue, rev, step: "published", authority_route: null, summary: `Imported from Web Manuals · revision date ${b.manual.revisionDate ?? "?"}`, published_at: published, source }).select("id").single();
    if (error || !r1) return { ok: false, error: error?.message ?? "revision not created" };
    revisionId = r1.id as string;
  } else {
    await db.from("revisions").update({ source, published_at: published ?? undefined }).eq("id", revisionId);
  }
  // sections
  const base = `/api/files/manuals/${input.entity}/${input.code}/${rev}`;
  const sections = buildSections(b, (id) => `${base}/${id}.${input.imageExt[id] ?? "png"}`);
  await db.from("revision_sections").delete().eq("revision_id", revisionId);
  const rows = sections.map((x) => { const st = structureHtml(x.html, `s${x.ord}`, x.ref); return { revision_id: revisionId, ord: x.ord, ref: x.ref, title: x.title, changed: x.changed, body: { html: st.html, text: x.text, pages: x.pages, page_revs: x.pageRevs, headings: st.headings, structured: true } }; });
  for (let i = 0; i < rows.length; i += 20) { const { error } = await db.from("revision_sections").insert(rows.slice(i, i + 20)); if (error) return { ok: false, error: error.message }; }
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: input.entity, object_type: "revision", object_id: revisionId, action: "import_webmanuals", after: { code: input.code, rev, sections: rows.length, images: Object.keys(b.images ?? {}).length } });
  revalidatePath("/docs/lib");
  return { ok: true, manualId, revisionId, sections: rows.length, changed: sections.filter((x) => x.changed).length };
}
