"use server";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSections, type WmBundle } from "@/lib/wm-import";
import { structureHtml } from "@/lib/docs";

export type ImportInput = { entity: string; code: string; title: string; path?: string; ownerRole?: string; bundle: WmBundle; imageExt: Record<string, string>; filePath?: string; cert?: { kind: string; issuer?: string; valid_until?: string | null } };
export type ImportResult = { ok: true; manualId: string; revisionId: string; sections: number; changed: number } | { ok: false; error: string };

/** Writes a Web Manuals export as a published revision of a manual (images already uploaded by the browser). CMM / SUPERADMIN only. */
export async function importWmBundle(input: ImportInput): Promise<ImportResult> {
  const s = await getSession();
  if (!s || !(s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"))) return { ok: false, error: "Compliance department only." };
  if (!s.group && !s.entities.includes(input.entity)) return { ok: false, error: "Entity out of your scope." };
  const b = input.bundle;
  if (b.format !== "sam-wm-export/1") return { ok: false, error: "Not a S.A.M. Web Manuals export." };
  if (b.kind === "file") return importCertificate(input);
  if (b.kind === "pdf") return importOfficialPdf(input);
  if (!b.pages?.length) return { ok: false, error: "Empty export." };
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
  // FB-029 · one revision per (manual, issue, rev): if duplicates already exist, the import updates the most recent one and never adds a third
  const { data: r0 } = await db.from("revisions").select("id").eq("manual_id", manualId).eq("rev", rev).eq("issue", issue).order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
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
  const rows = sections.map((x) => { const st = structureHtml(x.html, `s${x.ord}`, x.ref); return { revision_id: revisionId, ord: x.ord, ref: x.ref, title: x.title, changed: x.changed, body: { html: st.html, text: x.text, pages: x.pages, page_revs: x.pageRevs, page_ids: x.pageIds, uid: createHash("md5").update(`${manualId}:${x.ref}`).digest("hex"), headings: st.headings, structured: true } }; });
  for (let i = 0; i < rows.length; i += 20) { const { error } = await db.from("revision_sections").insert(rows.slice(i, i + 20)); if (error) return { ok: false, error: error.message }; }
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: input.entity, object_type: "revision", object_id: revisionId, action: "import_webmanuals", after: { code: input.code, rev, sections: rows.length, images: Object.keys(b.images ?? {}).length } });
  revalidatePath("/docs/lib");
  return { ok: true, manualId, revisionId, sections: rows.length, changed: sections.filter((x) => x.changed).length };
}

/** A FILE document of Web Manuals (certificate, approval letter…) → certificates table + private bucket. */
async function importCertificate(input: ImportInput): Promise<ImportResult> {
  const s = await getSession(); const db = supabaseAdmin(); const b = input.bundle;
  if (!input.filePath) return { ok: false, error: "File not uploaded." };
  const { data: existing } = await db.from("certificates").select("id").eq("entity", input.entity).like("file_path", `wm:${b.manual.wmId}/%`).maybeSingle();
  const row = { entity: input.entity, scope: "organisation", kind: input.cert?.kind ?? "approval", title: input.title || b.manual.name, issuer: input.cert?.issuer ?? null, valid_until: input.cert?.valid_until || null, file_path: input.filePath };
  let id = existing?.id as string | undefined;
  if (id) await db.from("certificates").update(row).eq("id", id);
  else { const { data: ins, error } = await db.from("certificates").insert(row).select("id").single(); if (error || !ins) return { ok: false, error: error?.message ?? "not created" }; id = ins.id as string; }
  await db.from("audit_log").insert({ actor: s?.person?.id ?? null, entity: input.entity, object_type: "certificate", object_id: id, action: "import_webmanuals_file", after: { file: b.file?.name, wmId: b.manual.wmId } });
  revalidatePath("/docs/files");
  return { ok: true, manualId: "", revisionId: "", sections: 0, changed: 0 };
}
/** The official PDF of a published revision (as Web Manuals renders it) → revisions.pdf_path. */
async function importOfficialPdf(input: ImportInput): Promise<ImportResult> {
  const db = supabaseAdmin(); const b = input.bundle;
  if (!input.filePath) return { ok: false, error: "File not uploaded." };
  const rev = (b.manual.rev ?? "").trim() || "00"; const issue = parseInt(b.manual.issue ?? "1", 10) || 1;
  const { data: m } = await db.from("manuals").select("id").eq("entity", input.entity).eq("code", input.code).maybeSingle();
  if (!m) return { ok: false, error: `Manual ${input.entity}/${input.code} not found: import its pages first.` };
  const { data: r } = await db.from("revisions").select("id").eq("manual_id", m.id).eq("rev", rev).eq("issue", issue).maybeSingle();
  if (!r) return { ok: false, error: `Revision Iss ${issue} Rev ${rev} not found: import its pages first.` };
  await db.from("revisions").update({ pdf_path: input.filePath }).eq("id", r.id);
  revalidatePath(`/docs/manual/${m.id}`);
  return { ok: true, manualId: m.id as string, revisionId: r.id as string, sections: 0, changed: 0 };
}

/** TMS-01 · Teams bot: sends a test card to the signed-in person (installs the app for them if needed). */
export async function teamsTestCard(): Promise<void> {
  const s = await getSession();
  if (!s?.person) return;
  const { ensureConversation, sendCard, infoCard, teamsConfigured } = await import("@/lib/teams");
  const db = supabaseAdmin();
  let status = "not configured";
  if (teamsConfigured()) {
    const conv = await ensureConversation(db, { id: s.person.id, email: s.person.email });
    if (!conv) status = "no conversation: open the S.A.M. bot once in Teams (or set TEAMS_APP_ID for automatic installation)";
    else { const r = await sendCard(conv, infoCard("Test card", `Sent from Settings › Integrations by ${s.name}. If you read this, S.A.M. can write to you in Teams.`, "/home/tasks"), "S.A.M. test card"); status = r.ok ? "sent" : `failed: ${r.error}`; }
  }
  await db.from("audit_log").insert({ actor: s.person.id, entity: null, object_type: "teams", object_id: s.person.id, action: "teams_test_card", after: { status } });
  revalidatePath("/set/integ");
}
