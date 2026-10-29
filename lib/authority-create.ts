import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, routeFor, syncTasks, today, type AuthorityFile, type FileType } from "@/lib/authority";

export type NewFileInput = { entity: string; type_code: string; title?: string | null; owner_role?: string | null; trigger_kind?: string | null; trigger_note?: string | null; triggered_at?: string | null; target_date?: string | null;
  revision_id?: string | null; finding_ref?: string | null; aircraft_reg?: string | null; np_post_code?: string | null; moc_ref?: string | null };
/** Opens an authority file from a type — the one rule for the app form and the Teams bot: route and checklist copied from the type, Inbox task for the owner. */
export async function createAuthorityFile(db: SupabaseClient, actor: { personId: string | null; name: string }, input: NewFileInput, via: "app" | "teams" = "app"): Promise<AuthorityFile> {
  const { data: t } = await db.from("authority_file_types").select("*").eq("code", input.type_code).maybeSingle();
  if (!t) throw new Error("Unknown type");
  const type = t as FileType;
  if (!type.entities.includes(input.entity)) throw new Error(`Type ${type.code} is not offered for ${input.entity}`);
  const route = routeFor(type, input.entity);
  const triggered = input.triggered_at ?? today();
  const row = {
    entity: input.entity, type_code: type.code, title: input.title?.trim() || type.name, stage: "draft",
    category: route.category, authority: route.authority, portal: route.portal,
    owner_role: input.owner_role ?? type.default_owner_role, owner_person: null,
    trigger_kind: input.trigger_kind ?? null, trigger_note: input.trigger_note ?? null,
    revision_id: input.revision_id ?? null, finding_ref: input.finding_ref ?? null, aircraft_reg: input.aircraft_reg ?? null, np_post_code: input.np_post_code ?? null, moc_ref: input.moc_ref ?? null,
    triggered_at: triggered, target_date: input.target_date ?? addDays(triggered, type.target_days + 14),
    created_by: actor.personId,
  };
  const { data: created, error } = await db.from("authority_files").insert(row).select("*").single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the file");
  const f = created as AuthorityFile;
  if (type.checklist?.length) await db.from("authority_file_items").insert(type.checklist.map((c, i) => ({ file_id: f.id, ord: i + 1, key: c.key, label: c.label, role: c.role ?? null, required: c.required !== false })));
  await db.from("authority_file_events").insert({ file_id: f.id, kind: "created", who: actor.name, actor: actor.personId, note: `File opened from type ${type.code}${via === "teams" ? " (via Teams)" : ""}`, meta: { type: type.code, portal: route.portal, via } });
  await db.from("audit_log").insert({ actor: actor.personId, entity: f.entity, object_type: "authority_file", object_id: f.id, action: "authority_file_created", after: { ...row, via } });
  await syncTasks(db, f);
  return f;
}
