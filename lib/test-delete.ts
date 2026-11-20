"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isTestData } from "@/lib/testdata";
import { fail } from "@/lib/fail";

/** Test sessions leave objects behind (a report, a published manual, an ERP exercise) that count in the statistics until they
 *  are removed. A super admin removes them here — and only an object whose title says "test" (lib/testdata). Anything real that
 *  still points to it stops the removal, with the reason. Written in the audit log. */
export async function deleteTestObject(fd: FormData) {
  const s = await getSession(); if (!s) fail("Not signed in");
  if (!s.superadmin || s.viewAs) fail("Super admin only");
  if (fd.get("confirm") !== "on") fail("Tick the confirmation to delete");
  const kind = String(fd.get("kind") ?? ""); const id = String(fd.get("id") ?? ""); const db = supabaseAdmin();
  let entity = ""; let label = ""; let back = "/";
  const gone = (e: { message: string } | null) => { if (e) fail(`Not deleted: something still refers to it (${e.message.slice(0, 180)})`); };
  if (kind === "report") {
    const { data } = await db.from("reports").select("id,entity,headline,headline_en").eq("id", id).maybeSingle();
    const r = data as { id: string; entity: string; headline: string | null; headline_en: string | null } | null; if (!r) fail("Report not found");
    if (!isTestData(r.headline, r.headline_en)) fail("Only a report whose title says “test” can be deleted");
    entity = r.entity; label = `report ${r.id} ${r.headline ?? ""}`; back = "/safe/reports";
    await db.from("tasks").update({ status: "done" }).like("link", `/safe/reports/${r.id}%`).eq("status", "open");
    gone((await db.from("reports").delete().eq("id", r.id)).error);
  } else if (kind === "manual") {
    const { data } = await db.from("manuals").select("id,entity,code,title").eq("id", id).maybeSingle();
    const m = data as { id: string; entity: string; code: string; title: string } | null; if (!m) fail("Manual not found");
    if (!isTestData(m.code, m.title)) fail("Only a manual whose code or title says “test” can be deleted");
    entity = m.entity; label = `manual ${m.code} ${m.title}`; back = "/docs/lib";
    await db.from("tasks").update({ status: "done" }).like("link", `/docs/manual/${m.id}%`).eq("status", "open");
    gone((await db.from("revisions").delete().eq("manual_id", m.id)).error);
    gone((await db.from("manuals").delete().eq("id", m.id)).error);
  } else if (kind === "exercise") {
    const { data } = await db.from("erp_exercises").select("id,entity,scenario").eq("id", id).maybeSingle();
    const x = data as { id: string; entity: string; scenario: string } | null; if (!x) fail("Exercise not found");
    if (!isTestData(x.scenario)) fail("Only an exercise whose scenario says “test” can be deleted");
    entity = x.entity; label = `ERP exercise ${x.scenario}`; back = "/erp/exer";
    gone((await db.from("erp_exercises").delete().eq("id", x.id)).error);
  } else fail("Unknown kind");
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: kind, object_id: id, action: "test_object_deleted", after: { what: label, by: s.name } });
  revalidatePath(back); revalidatePath("/home/tasks");
  redirect(back);
}
