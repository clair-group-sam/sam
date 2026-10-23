"use server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { mayCreateManual } from "@/lib/create";
import { callClaude } from "@/lib/ai";
import { ENT, ENTS4 } from "@/lib/nav";
import { CERT_KINDS, safeKey } from "@/lib/cert";

export type DropProposal = {
  kind: string; scope: "organisation" | "aircraft"; entity: string; registration: string | null; title: string; issuer: string | null;
  reference: string | null; issued_on: string | null; valid_until: string | null; summary: string; confidence: "high" | "medium" | "low"; why: string;
  folder: string;
};
/** Folders already used in Certificates & Validities, per entity (to propose and to choose from). */
export async function certFolders(): Promise<Record<string, string[]>> {
  const s = await getSession(); if (!s) return {};
  let q = supabaseAdmin().from("certificates").select("entity,folder").not("folder", "is", null);
  if (!s.group) q = q.in("entity", s.entities);
  const { data } = await q;
  const out: Record<string, string[]> = {};
  for (const r of (data ?? []) as { entity: string; folder: string }[]) { (out[r.entity] ??= []); if (!out[r.entity].includes(r.folder)) out[r.entity].push(r.folder); }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}
export type Existing = { id: string; title: string; kind: string; registration: string | null; valid_until: string | null; reference: string | null };

async function allowed() {
  const s = await getSession();
  if (!s || !(await mayCreateManual(s))) throw new Error("Reserved to Compliance, the AM, nominated persons, their deputies and the people Compliance names.");
  return s;
}

/** Step 1 · the file is kept aside (not filed yet) and SAM reads it to propose where it belongs. */
export async function analyseDrop(input: { name: string; type: string; b64: string }): Promise<{ ok: true; inbox: string; proposal: DropProposal; existing: Existing[]; preview: string } | { ok: false; error: string }> {
  try {
    const s = await allowed();
    const pdf = input.type === "application/pdf";
    if (!pdf && !/^image\/(png|jpe?g|webp|gif)$/.test(input.type)) return { ok: false, error: "PDF or image (PNG, JPG, WebP) only." };
    const bin = Buffer.from(input.b64, "base64");
    if (bin.length > 7 * 1024 * 1024) return { ok: false, error: "File larger than 7 MB." };
    const db = supabaseAdmin();
    const inbox = `_inbox/${s.person?.id ?? "anon"}/${randomUUID()}/${safeKey(input.name)}`;
    const up = await db.storage.from("certificates").upload(inbox, bin, { contentType: input.type, upsert: false });
    if (up.error) return { ok: false, error: up.error.message };
    const scope = s.group ? ENTS4 : s.entities;
    const { data: ents } = await db.from("entities").select("code,name,authority,approvals").in("code", scope);
    const folders = await certFolders();
    const folderList = Object.entries(folders).map(([e, f]) => `${e}: ${f.join(" | ")}`).join("\n") || "(none yet)";
    const entList = ((ents ?? []) as { code: string; name: string; authority: string; approvals: string[] }[]).map((e) => `${e.code} = ${e.name} (${ENT[e.code]?.qual ?? ""}; authority ${e.authority}; approvals ${e.approvals.join(", ")})`).join("\n");
    const system = `You file documents for the compliance department of an aviation group. Read the attached document and say what it is and where it belongs. Entities you may choose from (only these):\n${entList}\nKinds (id: label): ${CERT_KINDS.map((k) => `${k.id}: ${k.label}`).join(" · ")}.\nAircraft documents carry a registration (F-XXXX, 9H-XXX…). Dates in ISO format (YYYY-MM-DD); valid_until = expiry / end of cover / validity end, null if none. Never invent: null when the document does not say it. Folder: choose the best existing folder of that entity, or propose a short new one (e.g. "Insurance", "Approvals & validities", "Aircraft › F-HXXX"). Existing folders by entity:\n${folderList}\nAnswer ONLY with JSON: {"folder":"…","kind":"…","scope":"organisation|aircraft","entity":"CODE","registration":null,"title":"short title as a person would name it","issuer":"…","reference":"certificate / policy / approval number","issued_on":null,"valid_until":null,"summary":"one sentence","confidence":"high|medium|low","why":"how you recognised the entity and the kind"}`;
    const { text } = await callClaude({ agent: "file", personId: s.person?.id ?? null, entity: null, system, user: `File name: ${input.name}`, maxTokens: 1200, attachments: [{ type: pdf ? "document" : "image", mediaType: input.type, b64: input.b64 }] });
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return { ok: false, error: "SAM could not read the document." };
    const p = JSON.parse(m[0]) as DropProposal;
    if (!scope.includes(p.entity)) p.entity = scope[0];
    if (!CERT_KINDS.some((k) => k.id === p.kind)) p.kind = "other";
    p.scope = p.scope === "aircraft" ? "aircraft" : "organisation";
    if (!p.folder?.trim()) p.folder = p.scope === "aircraft" ? `Aircraft${p.registration ? ` › ${p.registration}` : ""}` : p.kind === "insurance" ? "Insurance" : "Approvals & validities";
    // documents it would replace (same entity, kind and aircraft, still current)
    let q = db.from("certificates").select("id,title,kind,registration,valid_until,reference").eq("entity", p.entity).eq("kind", p.kind).is("archived_at", null);
    if (p.registration) q = q.eq("registration", p.registration);
    const { data: ex } = await q;
    const { data: sig } = await db.storage.from("certificates").createSignedUrl(inbox, 900);
    return { ok: true, inbox, proposal: p, existing: (ex ?? []) as Existing[], preview: sig?.signedUrl ?? "" };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Step 2 · the user confirms (or changes) the place: the file is moved there and listed in Certificates & Validities. */
export async function fileDrop(input: { inbox: string; p: DropProposal; replaces: string[] }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const s = await allowed();
    const p = input.p;
    if (!s.group && !s.entities.includes(p.entity)) return { ok: false, error: "Entity outside your access." };
    if (!input.inbox.startsWith(`_inbox/${s.person?.id ?? "anon"}/`)) return { ok: false, error: "Unknown file." };
    const db = supabaseAdmin();
    const name = input.inbox.split("/").pop() ?? "file";
    const where = p.scope === "aircraft" && p.registration ? `aircraft/${safeKey(p.registration)}` : "organisation";
    const dest = `${p.entity}/${where}/${safeKey(p.kind)}/${Date.now()}-${name}`;
    const mv = await db.storage.from("certificates").move(input.inbox, dest);
    if (mv.error) return { ok: false, error: mv.error.message };
    const row = { entity: p.entity, scope: p.scope, registration: p.scope === "aircraft" ? (p.registration || null) : null, kind: p.kind, title: p.title || name, issuer: p.issuer || null,
      reference: p.reference || null, issued_on: p.issued_on || null, valid_until: p.valid_until || null, summary: p.summary || null, folder: p.folder?.trim() || null, file_path: `certificates/${dest}`, uploaded_by: s.person?.id ?? null, uploaded_at: new Date().toISOString() };
    const { data: ins, error } = await db.from("certificates").insert(row).select("id").single();
    if (error || !ins) return { ok: false, error: error?.message ?? "not filed" };
    if (input.replaces.length) await db.from("certificates").update({ archived_at: new Date().toISOString(), replaced_by: ins.id }).in("id", input.replaces).eq("entity", p.entity);
    await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: p.entity, object_type: "certificate", object_id: ins.id, action: "certificate_filed", after: { kind: p.kind, title: row.title, registration: row.registration, valid_until: row.valid_until, replaces: input.replaces } });
    revalidatePath("/docs/files");
    return { ok: true, id: ins.id as string };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function discardDrop(input: { inbox: string }) {
  const s = await getSession();
  if (!s || !input.inbox.startsWith(`_inbox/${s.person?.id ?? "anon"}/`)) return;
  await supabaseAdmin().storage.from("certificates").remove([input.inbox]);
}

/** Certificates & Validities: move a document to another folder (same entity). */
export async function moveCertificate(formData: FormData) {
  const s = await allowed();
  const id = String(formData.get("id") ?? "");
  const folder = (String(formData.get("folder_new") ?? "").trim() || String(formData.get("folder") ?? "").trim()) || null;
  const db = supabaseAdmin();
  const { data: c } = await db.from("certificates").select("id,entity,folder").eq("id", id).maybeSingle();
  const cert = c as { id: string; entity: string; folder: string | null } | null;
  if (!cert || (!s.group && !s.entities.includes(cert.entity))) return;
  await db.from("certificates").update({ folder }).eq("id", id);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: cert.entity, object_type: "certificate", object_id: id, action: "certificate_moved", before: { folder: cert.folder }, after: { folder } });
  revalidatePath("/docs/files");
}
