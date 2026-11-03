"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkAll, checkRegulation, recordVersion, type Regulation } from "@/lib/regulation";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
async function reg(id: string): Promise<Regulation> { const { data } = await db().from("regulations").select("*").eq("id", id).maybeSingle(); if (!data) throw new Error("Regulation not found"); return data as Regulation; }
const touch = () => { revalidatePath("/reg/ear"); revalidatePath("/comp/watch"); revalidatePath("/home/tasks"); };

export async function checkNow(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const id = str(fd, "id");
  if (id) await checkRegulation(db(), await reg(id)); else await checkAll(db());
  touch();
}
/** When the page cannot be read (or for a text outside EASA): the new version is recorded by hand, with the same effect. */
export async function recordByHand(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const r = await reg(String(fd.get("id"))); const version = str(fd, "version");
  if (!version) throw new Error("Give the version (e.g. Revision 25, January 2027).");
  if (version === r.current_version) return;
  await recordVersion(db(), r, { version, pdf: str(fd, "pdf_url") }, s.person?.id ?? null);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: r.entities[0] ?? null, object_type: "regulation", object_id: r.id, action: "regulation_version_recorded", after: { from: r.current_version, to: version } });
  touch();
}
export async function saveRegulation(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const id = str(fd, "id");
  const page = str(fd, "page_url"); if (!page) throw new Error("Give the EASA page (or EUR-Lex) link.");
  const row = { title: str(fd, "title") ?? "Easy Access Rules", short: str(fd, "short") ?? str(fd, "title") ?? "Text", number: str(fd, "number"), page_url: page, kind: /easa\.europa\.eu\/.*easy-access-rules/.test(page) ? "ear" : "other",
    entities: fd.getAll("entities").map(String).filter(Boolean), domains: (str(fd, "domains") ?? "").split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()), sort: Number(fd.get("sort") ?? 100) || 100 };
  if (!row.entities.length) throw new Error("Pick at least one entity.");
  if (id) await db().from("regulations").update(row).eq("id", id);
  else {
    const key = (str(fd, "key") ?? page.split("/").pop() ?? "text").replace(/^easy-access-rules-/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
    const { data } = await db().from("regulations").insert({ ...row, key }).select("*").single();
    if (data) await checkRegulation(db(), data as Regulation);
  }
  touch();
}
export async function archiveRegulation(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  await db().from("regulations").update({ active: false }).eq("id", String(fd.get("id"))); touch();
}
