import { cache } from "react";
import { normEntity } from "@/lib/entity-codes";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase-server";
import { ENTS4, homeFor, type RoleKey } from "@/lib/nav";

export type Person = {
  id: string; email: string; display_name: string; home_entity: string | null; entities: string[]; roles: string[];
  is_group_function: boolean; job_title: string | null;
};
export type Session = {
  userId: string; email: string; name: string; initials: string; person: Person | null;
  role: RoleKey; roles: string[]; entities: string[]; group: boolean;
  /** Current entity filter: an entity code, or "ALL" for group functions. */
  entity: string; home: string;
};

export const NP_ROLES = ["NPFO", "NPCA", "NPGO", "NPCT", "NPMT", "CFI", "HT", "CTKI", "FSO", "MAM", "NP", "SMD", "QM"];
/**
 * Deputies hold the same rights as the post they deputise. Accepted spellings: DEPUTY_X, DEPUTY-X, DEP_X, X_DEPUTY, X_DEP, X-D,
 * and the short forms DAM (deputy AM), DCMM (deputy CMM), DSM (deputy SM). Returns the base post, e.g. "NPFO_DEP" → "NPFO".
 */
export function basePost(role: string): string {
  const r = role.trim().toUpperCase();
  if (["DAM", "DCMM", "DSM"].includes(r)) return r.slice(1);
  return r.replace(/^(DEPUTY|DEP)[_\s-]+/, "").replace(/[_\s-]+(DEPUTY|DEP|D)$/, "");
}
export function isDeputy(role: string): boolean { return basePost(role) !== role.trim().toUpperCase(); }
/** Manual PDF download (DOC-13): AM, nominated persons, CMM / SM — and the deputy of each. */
export function canDownloadPdf(roles: string[]): boolean {
  return roles.map(basePost).some((x) => ["AM", "CMM", "SM", "SUPERADMIN"].includes(x) || NP_ROLES.includes(x) || x.startsWith("NP"));
}
export function roleKeyFrom(roles: string[]): RoleKey {
  const r = roles.map(basePost);
  if (r.some((x) => ["SUPERADMIN", "CMM", "SM", "COMPLIANCE"].includes(x))) return "cmm";
  if (r.includes("AM")) return "am";
  if (r.some((x) => NP_ROLES.includes(x) || x.startsWith("NP"))) return "np";
  return "user";
}
export function initialsOf(name: string): string {
  return name.split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}

/** One auth round-trip per request (layout + page share it). */
export const getSession = cache(async (): Promise<Session | null> => {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: p } = await sb.from("people").select("id,email,display_name,home_entity,entities,roles,is_group_function,job_title").eq("auth_uid", user.id).maybeSingle();
  const person = (p as Person | null) ?? null;
  const roles = person?.roles ?? [];
  const role = roleKeyFrom(roles);
  const group = !!person?.is_group_function;
  const entities = group ? ENTS4 : (person?.entities ?? []);
  const name = person?.display_name || (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || user.email || "";
  const store = await cookies();
  const wanted = (() => { const v = store.get("sam_ent")?.value; return v && v !== "ALL" ? normEntity(v) : v; })(); // old cookies (AJD…) still work
  let entity = group ? "ALL" : (person?.home_entity ?? entities[0] ?? "ALL");
  if (wanted && (wanted === "ALL" ? group : entities.includes(wanted))) entity = wanted;
  return { userId: user.id, email: user.email ?? "", name, initials: initialsOf(name), person, role, roles, entities, group, entity, home: homeFor(role) };
});
