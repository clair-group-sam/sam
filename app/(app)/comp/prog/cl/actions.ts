"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { lines } from "@/lib/audit-programme";

/* AUD-02 · checklists: templates per entity (sections, items = rule codes + house wording / guidance). Compliance desk. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); if (!desk(s)) throw new Error("Compliance desk only."); return s; }
const touch = (id: string) => { revalidatePath(`/comp/prog/cl/${id}`); revalidatePath("/comp/prog"); };

/** Create a checklist for a module of a programme (same code), or from scratch. */
export async function createChecklist(fd: FormData) {
  const s = await me();
  const entity = String(fd.get("entity")); const code = (str(fd, "code") ?? "CL").toUpperCase();
  const { data: ex } = await db().from("checklists").select("id").eq("entity", entity).eq("code", code).maybeSingle();
  let id = (ex as { id: string } | null)?.id;
  if (!id) {
    const domain = str(fd, "domain");
    let regulation = str(fd, "regulation");
    if (!regulation) { const key = domain === "CAMO" || domain === "CAE" ? "continuing-airworthiness" : domain === "ATO" || domain === "FSTD" ? "aircrew" : "air-operations"; const { data: r } = await db().from("regulations").select("id").eq("key", key).maybeSingle(); regulation = (r as { id: string } | null)?.id ?? null; }
    const { data, error } = await db().from("checklists").insert({ entity, code, title: str(fd, "title") ?? code, domain, regulation_id: regulation, created_by: s.person?.id ?? null }).select("id").single();
    if (error) throw new Error(error.message); id = data.id;
  }
  const moduleId = str(fd, "module");
  if (moduleId) await db().from("audit_modules").update({ checklist_id: id }).eq("id", moduleId);
  const prog = str(fd, "programme"); if (prog) revalidatePath(`/comp/prog/${prog}`);
  touch(id!); redirect(`/comp/prog/cl/${id}`);
}
export async function saveChecklist(fd: FormData) {
  await me(); const id = String(fd.get("id"));
  await db().from("checklists").update({ title: str(fd, "title") ?? "Checklist", domain: str(fd, "domain"), regulation_id: str(fd, "regulation"), note: str(fd, "note"), updated_at: new Date().toISOString() }).eq("id", id);
  touch(id);
}
export async function saveSection(fd: FormData) {
  await me(); const cl = String(fd.get("checklist")); const id = str(fd, "id");
  const row = { checklist_id: cl, code: str(fd, "code"), title: str(fd, "title") ?? "Section", ord: Number(fd.get("ord") ?? 0) || 0 };
  if (id) await db().from("checklist_sections").update(row).eq("id", id); else await db().from("checklist_sections").insert(row);
  touch(cl);
}
export async function removeSection(fd: FormData) {
  await me(); const cl = String(fd.get("checklist")); await db().from("checklist_sections").delete().eq("id", String(fd.get("id"))); touch(cl);
}
/** Items: one per line — "ORO.GEN.200", "ORO.GEN.200 | question | guidance", "AMC1 ORO.GEN.200(a)(3)" (ref kept). */
export async function addItems(fd: FormData) {
  await me(); const cl = String(fd.get("checklist")); const section = str(fd, "section"); const reg = str(fd, "regulation");
  const { data: last } = await db().from("checklist_items").select("ord").eq("checklist_id", cl).order("ord", { ascending: false }).limit(1);
  let ord = ((last ?? [])[0] as { ord: number } | undefined)?.ord ?? 0;
  const rows = lines(str(fd, "items")).map((l) => {
    const [head, question, guidance] = l.split("|").map((x) => x.trim());
    const m = head.match(/^((?:AMC|GM|CS)\d*\s+)?([A-Z]{2,4}(?:\.[A-Z0-9-]+)+)(.*)$/i);
    const code = m ? m[2].toUpperCase() : head.toUpperCase(); const ref = m && (m[1] || m[3].trim()) ? head : null;
    return { checklist_id: cl, section_id: section, ord: ++ord, code, ref, regulation_id: reg, question: question || null, guidance: guidance || null };
  });
  if (rows.length) { const { error } = await db().from("checklist_items").insert(rows); if (error) throw new Error(error.message); }
  touch(cl);
}
export async function saveItem(fd: FormData) {
  await me(); const cl = String(fd.get("checklist")); const id = String(fd.get("id"));
  const row: Record<string, unknown> = { code: (str(fd, "code") ?? "").toUpperCase(), ref: str(fd, "ref"), question: str(fd, "question"), guidance: str(fd, "guidance"), section_id: str(fd, "section"), ord: Number(fd.get("ord") ?? 0) || 0 };
  if (fd.get("reviewed")) { row.review_flag = false; row.review_note = null; }
  await db().from("checklist_items").update(row).eq("id", id);
  touch(cl);
}
export async function removeItem(fd: FormData) {
  await me(); const cl = String(fd.get("checklist")); await db().from("checklist_items").update({ active: false }).eq("id", String(fd.get("id"))); touch(cl);
}
export async function reviewedItem(fd: FormData) {
  await me(); const cl = String(fd.get("checklist")); await db().from("checklist_items").update({ review_flag: false, review_note: null }).eq("id", String(fd.get("id"))); touch(cl);
}
