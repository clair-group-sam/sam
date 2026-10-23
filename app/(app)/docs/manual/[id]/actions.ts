"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { isCmm, ownsManual } from "@/lib/revisions";
import type { Manual } from "@/lib/docs";

/** Reading acknowledgement: one row per (revision, person), kept forever (readers tab, Read tracking). Closes the reading task. */
export async function acknowledge(formData: FormData) {
  const revisionId = String(formData.get("revision_id") ?? "");
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s?.person || !revisionId) return;
  const sb = await supabaseServer();
  await sb.from("readings").upsert({ revision_id: revisionId, person_id: s.person.id, acknowledged_at: new Date().toISOString(), via: "app" }, { onConflict: "revision_id,person_id" });
  await supabaseAdmin().from("tasks").update({ status: "done" }).eq("kind", "reading").eq("owner_person", s.person.id).eq("ref_id", revisionId).eq("status", "open");
  revalidatePath(`/docs/manual/${manualId}`); revalidatePath("/home/tasks");
}

/** Who must read this manual (CMM or the owner NP). Tokens: ALL · ROLE:<post> · PERSON:<id>. */
export async function saveAudience(formData: FormData) {
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s) return;
  const db = supabaseAdmin();
  const { data: m } = await db.from("manuals").select("*").eq("id", manualId).maybeSingle();
  if (!m) return;
  const manual = m as Manual;
  if (!(isCmm(s) || ownsManual(s, manual.owner_role))) return;
  if (!s.group && !s.entities.includes(manual.entity)) return;
  const tokens = [
    ...(formData.get("all") ? ["ALL"] : []),
    ...formData.getAll("post").map((p) => `ROLE:${String(p)}`),
    ...formData.getAll("person").map((p) => `PERSON:${String(p)}`),
  ];
  await db.from("manual_audiences").delete().eq("manual_id", manual.id);
  await db.from("manual_audiences").insert((tokens.length ? tokens : ["NONE"]).map((token) => ({ manual_id: manual.id, token })));
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: manual.entity, object_type: "manual", object_id: manual.id, action: "audience", after: { tokens } });
  revalidatePath(`/docs/manual/${manual.id}`);
}

/** ★ favourite manuals, shown in the Library shortcuts across entities. */
export async function toggleFavourite(formData: FormData) {
  const manualId = String(formData.get("manual_id") ?? "");
  const s = await getSession();
  if (!s?.person || !manualId) return;
  const db = supabaseAdmin();
  const { data: f } = await db.from("manual_favourites").select("manual_id").eq("person_id", s.person.id).eq("manual_id", manualId).maybeSingle();
  if (f) await db.from("manual_favourites").delete().eq("person_id", s.person.id).eq("manual_id", manualId);
  else await db.from("manual_favourites").insert({ person_id: s.person.id, manual_id: manualId });
  revalidatePath(`/docs/manual/${manualId}`); revalidatePath("/docs/lib");
}
