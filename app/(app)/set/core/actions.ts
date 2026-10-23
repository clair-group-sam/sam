"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { appliedVersions, applyMigration, localMigrations } from "@/lib/migrate";

export type ApplyResult = { applied: string[]; error: string | null };

/** Settings › Core: apply the pending migrations, in order, stopping at the first error. SUPERADMIN / CMM only. */
export async function applyPending(formData: FormData): Promise<void> {
  const s = await getSession();
  if (!s || !(s.roles.includes("SUPERADMIN") || s.roles.includes("CMM"))) throw new Error("Not allowed");
  const upTo = String(formData.get("up_to") ?? "");
  const done = await appliedVersions();
  if (!done.ok) throw new Error(done.error);
  const pending = localMigrations().filter((m) => !done.versions.includes(m.version)).filter((m) => !upTo || m.version <= upTo);
  const db = supabaseAdmin();
  const applied: string[] = []; let error: string | null = null;
  for (const m of pending) {
    const r = await applyMigration(m);
    if (!r.ok) { error = `${m.file}: ${r.error}`; break; }
    applied.push(m.file);
  }
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: null, object_type: "database", object_id: "migrations", action: error ? "migrations_failed" : "migrations_applied", after: { applied, error } });
  revalidatePath("/set/core");
  if (error) throw new Error(error);
}
