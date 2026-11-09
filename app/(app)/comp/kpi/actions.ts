"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { snapshotKpis } from "@/lib/compliance-kpi";

/* KPI-01 · ENR-CM-06 indicators: the desk takes the month's snapshot; the AM (or the desk on the AM's decision) sets targets. */
const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const desk = (s: Session) => s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r));
const am = (s: Session) => s.roles.map(basePost).some((r) => ["AM", "SUPERADMIN"].includes(r));
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); return s; }
const touch = () => { revalidatePath("/comp/kpi"); revalidatePath("/comp/over"); revalidatePath("/dash/cs"); };

export async function takeSnapshot(fd: FormData) {
  const s = await me(); if (!desk(s)) throw new Error("Compliance desk only.");
  const entity = str(fd, "entity"); if (!entity || !(s.group || s.entities.includes(entity))) throw new Error("Entity out of scope");
  const n = await snapshotKpis(db(), entity, str(fd, "as_of") ?? undefined);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "kpi", object_id: null, action: "kpi_snapshot", after: { n, as_of: str(fd, "as_of") } });
  await db().from("tasks").update({ status: "done" }).eq("entity", entity).eq("kind", "kpi_month").eq("status", "open");
  touch();
}
export async function saveTarget(fd: FormData) {
  const s = await me(); if (!desk(s) && !am(s)) throw new Error("Accountable Manager or Compliance desk.");
  const entity = str(fd, "entity"), code = str(fd, "code"); if (!entity || !code) throw new Error("Missing");
  const target = Number(fd.get("target")); if (!Number.isFinite(target)) throw new Error("Target must be a number");
  const alertRaw = str(fd, "alert"); const alert = alertRaw === null ? null : Number(alertRaw);
  await db().from("kpi_targets").upsert({ entity, code, target, alert: alert !== null && Number.isFinite(alert) ? alert : null, origin: str(fd, "origin"), owner_role: str(fd, "owner_role") ?? "CMM", active: true }, { onConflict: "entity,code" });
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "kpi", object_id: null, action: "kpi_target_set", after: { code, target, alert, by: am(s) ? "AM" : "CMM" } });
  touch();
}
