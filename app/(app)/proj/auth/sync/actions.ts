"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { applySync, parseLines } from "@/lib/portal-sync";

/* PRJ-05 · portal readings: record what was read, then apply the lines the Compliance desk ticked. */
async function desk() { const s = await getSession(); if (!s) redirect("/login"); if (!isCmm(s)) throw new Error("Compliance desk only."); return s; }
export async function recordReading(fd: FormData) {
  const s = await desk();
  const read_on = String(fd.get("read_on") ?? "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(read_on)) throw new Error("Date of the reading missing.");
  let raw: unknown; try { raw = JSON.parse(String(fd.get("lines") ?? "")); } catch { throw new Error("The reading is not valid JSON: paste the list as the CAA point produced it."); }
  const lines = parseLines(raw); if (!lines.length) throw new Error("No line recognised (expected: entity, number or title, status…).");
  const out = lines.filter((l) => !s.group && !s.entities.includes(l.entity)); if (out.length) throw new Error(`Out of your scope: ${[...new Set(out.map((l) => l.entity))].join(", ")}.`);
  const { data, error } = await supabaseAdmin().from("portal_readings").insert({ read_on, source: String(fd.get("source") ?? "").trim() || null, entities: [...new Set(lines.map((l) => l.entity))], lines: raw, created_by: s.person?.id ?? null }).select("id").single();
  if (error || !data) redirect(`/proj/auth/sync?err=${encodeURIComponent(`Reading not saved: ${error?.message ?? "unknown"}`)}`);
  redirect(`/proj/auth/sync/${(data as unknown as { id: string }).id}`);
}
export async function applyReading(fd: FormData) {
  const s = await desk(); const id = String(fd.get("id"));
  const picks = fd.getAll("pick").map(String).map((key) => ({ key, type: String(fd.get(`type_${key}`) ?? "") || null, title: String(fd.get(`title_${key}`) ?? "").trim() || null }));
  if (!picks.length) throw new Error("Tick at least one line.");
  const r = await applySync(supabaseAdmin(), { personId: s.person?.id ?? null, name: s.name }, id, picks);
  revalidatePath("/proj/auth"); revalidatePath("/comp/find"); revalidatePath("/dash/due"); revalidatePath("/home/tasks");
  redirect(`/proj/auth/sync/${id}?msg=${encodeURIComponent(`${r.created} file(s) opened, ${r.updated} updated`)}`);
}
