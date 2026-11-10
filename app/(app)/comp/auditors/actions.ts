"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { today } from "@/lib/authority";
import { QUALIFICATION_ITEMS, type Auditor } from "@/lib/compliance-registers";

/* COMP-05 · Internal auditors (ENR-CM-09 / PRO-CM-04): the desk keeps the register; the Accountable Manager (or the desk on his behalf) approves. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
const am = (s: Session) => s.role === "am" || s.roles.map(basePost).includes("AM");
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
async function auditor(id: string): Promise<Auditor> { const { data } = await db().from("auditors").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Auditor not found"); return data as Auditor; }
const touch = (id?: string | null) => { revalidatePath("/comp/auditors"); revalidatePath("/comp/over"); if (id) revalidatePath(`/comp/auditors?a=${id}`); };
const lines = (v: string | null) => (v ?? "").split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean);

export async function saveAuditor(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const id = str(fd, "id");
  const row = { entities: fd.getAll("entities").map(String).filter(Boolean), domains: fd.getAll("domains").map(String).filter(Boolean), exclusions: lines(str(fd, "exclusions")), lead: !!fd.get("lead"), external: str(fd, "external"), note: str(fd, "note"), aliases: lines(str(fd, "aliases")) };
  if (id) { await db().from("auditors").update({ ...row, ...(str(fd, "name") ? { name: str(fd, "name") } : {}) }).eq("id", id); touch(id); return; }
  // 10/11 · a staff member (person) or an external auditor known by name only (L. Rudelle, Aero Services EI)
  const person = str(fd, "person"), name = str(fd, "name"); if (!person && !name) throw new Error("Pick the person, or type the external auditor's name.");
  const { data, error } = await db().from("auditors").insert({ person_id: person, name: person ? null : name, ...row }).select("id").single();
  if (error) throw new Error(error.message.includes("duplicate") ? "Already in the register." : error.message);
  await db().from("auditor_items").insert(QUALIFICATION_ITEMS.map((label, i) => ({ auditor_id: data.id, ord: i, label })));
  touch(); redirect(`/comp/auditors?a=${data.id}`);
}
export async function saveItem(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const id = String(fd.get("id")); const a = str(fd, "auditor");
  await db().from("auditor_items").update({ done: !!fd.get("done"), evidence: str(fd, "evidence"), on_date: str(fd, "on_date"), valid_until: str(fd, "valid_until") }).eq("id", id);
  touch(a);
}
export async function uploadDoc(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const a = await auditor(String(fd.get("auditor")));
  const file = fd.get("file"); const name = str(fd, "name");
  let path: string | null = null, size: number | null = null, fname = name ?? "document";
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) throw new Error("File larger than 25 MB.");
    fname = name ?? file.name; const safe = file.name.replace(/[^\w.\-() ]+/g, "_"); const p = `${a.entities[0] ?? "ALL"}/auditors/${a.id}/${Date.now()}-${safe}`;
    const { error } = await db().storage.from("audits").upload(p, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: true });
    if (error) throw new Error(error.message); path = `audits/${p}`; size = file.size;
  } else if (!name) throw new Error("A file or a name.");
  await db().from("auditor_docs").insert({ auditor_id: a.id, name: fname, kind: str(fd, "kind"), path, size, issued_on: str(fd, "issued_on"), valid_until: str(fd, "valid_until"), uploaded_by: s.person?.id ?? null });
  touch(a.id);
}
export async function removeDoc(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const { data } = await db().from("auditor_docs").select("path,auditor_id").eq("id", String(fd.get("id"))).maybeSingle();
  if (data?.path) await db().storage.from("audits").remove([String(data.path).replace(/^audits\//, "")]);
  await db().from("auditor_docs").delete().eq("id", String(fd.get("id"))); touch(data?.auditor_id ?? null);
}
/** Approval (AM, or the desk recording the AM's signed letter): approved for 3 years by default. */
export async function setStatus(fd: FormData) {
  const s = await me(); const a = await auditor(String(fd.get("id"))); const status = String(fd.get("status"));
  if (!desk(s) && !am(s)) throw new Error("Accountable Manager or Compliance desk only.");
  const row: Record<string, unknown> = { status };
  if (status === "approved") { const { count } = await db().from("auditor_items").select("id", { count: "exact", head: true }).eq("auditor_id", a.id).eq("done", false); if ((count ?? 0) > 0 && !fd.get("force")) throw new Error(`${count} qualification item(s) not done — tick them, or force the approval with a note.`); row.approved_by = s.person?.id ?? null; row.approved_on = str(fd, "approved_on") ?? today(); row.valid_until = str(fd, "valid_until") ?? new Date(Date.parse(String(row.approved_on)) + 3 * 365.25 * 86_400_000).toISOString().slice(0, 10); }
  if (str(fd, "note")) row.note = `${a.note ? a.note + "\n" : ""}${today()} · ${status}: ${str(fd, "note")}`;
  await db().from("auditors").update(row).eq("id", a.id);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: a.entities[0] ?? null, object_type: "auditor", object_id: a.id, action: `auditor_${status}`, after: row });
  touch(a.id);
}
