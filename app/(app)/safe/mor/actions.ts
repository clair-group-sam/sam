"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafetyDesk } from "@/lib/safety";

/** Record a follow-up sent to the authority: the 30-day report or the final (3-month) report (376/2014 art. 13(4)). */
export async function recordFollowup(fd: FormData) {
  const s = await getSession(); if (!s || !isSafetyDesk(s)) throw new Error("Reserved to the safety desk.");
  const id = String(fd.get("id")); const kind = fd.get("kind") === "final" ? "final" : "followup"; const ref = String(fd.get("ref") ?? "").trim() || null;
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("entity").eq("id", id).maybeSingle();
  const e = (data as { entity: string } | null)?.entity; if (!e || !s.entities.includes(e)) throw new Error("Report outside your scope.");
  const now = new Date().toISOString();
  await db.from("reports").update(kind === "final" ? { mor_final_at: now, mor_final_ref: ref } : { mor_followup_at: now, mor_followup_ref: ref }).eq("id", id);
  await db.from("report_events").insert({ report_id: id, kind: "mor", actor: s.person?.id ?? null, note: `${kind === "final" ? "Final (3-month) report" : "30-day follow-up report"} sent to the authority${ref ? ` — ${ref}` : ""}` });
  await db.from("tasks").update({ status: "done" }).eq("kind", kind === "final" ? "mor_final" : "mor_followup").eq("ref_id", id).eq("status", "open");
  if (kind === "final") await db.from("tasks").update({ status: "done" }).eq("kind", "mor_followup").eq("ref_id", id).eq("status", "open");
  revalidatePath("/safe/mor"); revalidatePath(`/safe/reports/${id}`);
}
