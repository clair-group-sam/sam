"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

const cmm = (roles: string[]) => roles.includes("SUPERADMIN") || roles.includes("CMM") || roles.includes("SM");
const num = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s === "" ? null : Math.max(0, parseInt(s, 10) || 0); };

/** Settings › Notification rules: one row per task kind, saved as a whole. CMM / SM only. */
export async function saveRule(formData: FormData): Promise<void> {
  const s = await getSession();
  if (!s || !cmm(s.roles)) throw new Error("Not allowed");
  const kind = String(formData.get("kind") ?? "");
  if (!kind) return;
  const to = String(formData.get("escalate_to") ?? "").trim().toUpperCase();
  await supabaseAdmin().from("notification_rules").update({
    remind_days: num(formData.get("remind_days")), chase_days: num(formData.get("chase_days")), escalate_days: num(formData.get("escalate_days")),
    escalate_to: ["CMM", "SM"].includes(to) ? to : null, am_days: num(formData.get("am_days")), active: formData.get("active") === "on", updated_at: new Date().toISOString(),
  }).eq("kind", kind);
  revalidatePath("/set/notif");
}

export async function addRule(formData: FormData): Promise<void> {
  const s = await getSession();
  if (!s || !cmm(s.roles)) throw new Error("Not allowed");
  const kind = String(formData.get("kind") ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const label = String(formData.get("label") ?? "").trim();
  if (!kind || !label) return;
  await supabaseAdmin().from("notification_rules").upsert({ kind, label, remind_days: 0, chase_days: 3, escalate_days: 7, escalate_to: "CMM", am_days: 15, active: true }, { onConflict: "kind", ignoreDuplicates: true });
  revalidatePath("/set/notif");
}

/** Runs the ladder now (what the daily cron does), for testing a rule. */
export async function runNow(): Promise<void> {
  const s = await getSession();
  if (!s || !cmm(s.roles)) throw new Error("Not allowed");
  const { runEscalations } = await import("@/lib/escalation");
  const r = await runEscalations(supabaseAdmin());
  await supabaseAdmin().from("audit_log").insert({ actor: s.person?.id ?? null, entity: null, object_type: "escalation", object_id: "manual", action: "escalation_run", after: r });
  revalidatePath("/set/notif");
}
