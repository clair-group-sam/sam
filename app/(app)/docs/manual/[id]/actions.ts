"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";
import { getSession } from "@/lib/session";

/** Reading acknowledgement: one row per (revision, person), kept forever (readers tab, Read tracking). */
export async function acknowledge(formData: FormData) {
  const revisionId = String(formData.get("revision_id") ?? "");
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s?.person || !revisionId) return;
  const sb = await supabaseServer();
  await sb.from("readings").upsert({ revision_id: revisionId, person_id: s.person.id, acknowledged_at: new Date().toISOString(), via: "app" }, { onConflict: "revision_id,person_id" });
  revalidatePath(`/docs/manual/${manualId}`);
}
