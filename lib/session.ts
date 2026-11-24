import { cache } from "react";
import { normEntity } from "@/lib/entity-codes";
import { cookies, headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENTS4, VIEW_BASE, VIEW_RE, type ViewOption, entMode, homeFor, singleEntity, type RoleKey } from "@/lib/nav";

export type Person = {
  id: string; email: string; display_name: string; home_entity: string | null; entities: string[]; roles: string[];
  is_group_function: boolean; job_title: string | null;
};
export type Session = {
  userId: string; email: string; name: string; initials: string; person: Person | null;
  role: RoleKey; roles: string[]; entities: string[]; group: boolean;
  /** RIGHTS-04 · the posts and roles held in each organisation of the scope (`roles` is the list for the organisation worked in). */
  rolesByEntity: Record<string, string[]>;
  /** Current entity filter: an entity code, or "ALL" for group functions. */
  entity: string; home: string;
  /** The entity chosen in the top bar ("ALL" stays "ALL" even on a page that works on one entity). The layout's Shell
   *  is not re-rendered on client navigation, so it works from this and the path, not from `entity`. */
  entityPref: string;
  /** "View as" (super admin): the profile being looked at, e.g. "NPFO"; null in one's own view. */
  viewAs: string | null;
  /** The entity the person chose to land on (user menu), when it is still in their scope; null: none chosen. */
  defaultEntity: string | null;
  /** The signed-in person is a super admin, whatever the view. */
  superadmin: boolean;
  /** Super admin only: every profile that can be looked at (posts of each entity, roles given in Users, AM, user). */
  viewOptions: ViewOption[];
};

export const NP_ROLES = ["NPFO", "NPCA", "NPGO", "NPCT", "NPMT", "CFI", "HT", "CTKI", "FSO", "MAM", "NP", "SMD", "QM",
  "RE", "RN", "RRO"]; // 19/11 · Astontec (Part-CAO): Responsable Entretien, Responsable Navigabilité, Responsable de Revue d'Organisation
/**
 * Deputies hold the same rights as the post they deputise. Accepted spellings: DEPUTY_X, DEPUTY-X, DEP_X, X_DEPUTY, X_DEP, X-D,
 * and the short forms DAM (deputy AM), DCMM (deputy CMM), DSM (deputy SM). Returns the base post, e.g. "NPFO_DEP" → "NPFO".
 */
export function basePost(role: string): string {
  const r = role.trim().toUpperCase().split("@")[0];   // a right held in one organisation is written "NPFO@ASJMT"
  if (["DAM", "DCMM", "DSM"].includes(r)) return r.slice(1);
  return r.replace(/^(DEPUTY|DEP)[_\s-]+/, "").replace(/[_\s-]+(DEPUTY|DEP|D)$/, "");
}
export function isDeputy(role: string): boolean { return basePost(role) !== role.trim().toUpperCase().split("@")[0]; }
/** RIGHTS-04 · the posts and roles of a person in one organisation: the rights held there ("NPFO@ASJMT") and the ones held in every
 *  organisation (written without "@"). "ALL" or no entity: everything held anywhere. Read from sam_roles; roles when it is not loaded. */
export function rolesIn(p: { roles?: string[] | null; sam_roles?: string[] | null }, entity: string | null | undefined): string[] {
  const src = p.sam_roles?.length ? p.sam_roles : (p.roles ?? []);
  const out = [...new Set(src.filter((r) => { const e = r.split("@")[1]; return !e || !entity || entity === "ALL" || e === entity; }).map((r) => r.split("@")[0]))];
  return out.length ? out : ["USER"];
}
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

/** Every profile a super admin can look at: the posts of each entity (NP management), then the roles given to people in Users that are not posts. */
async function viewOptionsFor(): Promise<ViewOption[]> {
  const db = supabaseAdmin();
  const [{ data: posts }, { data: ppl }] = await Promise.all([db.from("np_posts").select("entity,code,title,ord").order("entity").order("ord"), db.from("people").select("roles").limit(3000)]);
  const out: ViewOption[] = []; const seen = new Set<string>();
  for (const p of (posts ?? []) as { entity: string; code: string; title: string }[]) { const code = p.code.toUpperCase(); if (!VIEW_RE.test(code) || code === "SUPERADMIN") continue; seen.add(basePost(code)); out.push({ value: `${code}@${p.entity}`, code, entity: p.entity, label: `${code}, ${p.title}` }); }
  for (const b of VIEW_BASE) if (!seen.has(b.code)) { seen.add(b.code); out.push({ value: b.code, code: b.code, entity: null, label: b.label }); }
  const others = new Set<string>();
  for (const r of ((ppl ?? []) as { roles: string[] | null }[]).flatMap((x) => x.roles ?? [])) { const c = basePost(r); if (c !== "SUPERADMIN" && VIEW_RE.test(c) && !seen.has(c)) others.add(c); }
  for (const c of [...others].sort()) out.push({ value: c, code: c, entity: null, label: c });
  return out;
}

/** True when the signed-in Microsoft account is a person whose access to S.A.M. is suspended (the sign-in page says so). */
export const isSuspended = cache(async (): Promise<boolean> => {
  try { const sb = await supabaseServer(); const { data: { user } } = await sb.auth.getUser(); if (!user) return false;
    const { data } = await supabaseAdmin().from("people").select("suspended_at").eq("auth_uid", user.id).maybeSingle();
    return !!(data as { suspended_at?: string | null } | null)?.suspended_at; } catch { return false; }
});
/** One auth round-trip per request (layout + page share it). */
export const getSession = cache(async (): Promise<Session | null> => {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: p } = await sb.from("people").select("id,email,display_name,home_entity,entities,roles,is_group_function,job_title,last_seen_at").eq("auth_uid", user.id).maybeSingle();
  const person = (p as Person | null) ?? null;
  let samRoles: string[] | null = null;
  // RIGHTS-03 · access suspended in S.A.M.: no session, at once, whatever Microsoft says (asked apart so that a missing column never locks anyone out)
  if (person) { try { const { data: su } = await supabaseAdmin().from("people").select("suspended_at,sam_roles").eq("id", person.id).maybeSingle(); if ((su as { suspended_at?: string | null } | null)?.suspended_at) return null; samRoles = (su as { sam_roles?: string[] | null } | null)?.sam_roles ?? null; } catch { /* never blocks a page */ } }
  // FB-094 · "last seen" followed the sign-in only; a session lasts for days. One write a day at most.
  const seen = (p as { last_seen_at?: string | null } | null)?.last_seen_at ?? null;
  if (person && (!seen || seen.slice(0, 10) < new Date().toISOString().slice(0, 10))) { try { await supabaseAdmin().from("people").update({ last_seen_at: new Date().toISOString() }).eq("id", person.id); } catch { /* never blocks a page */ } }
  const realRoles = person?.roles ?? [];
  const superadmin = realRoles.includes("SUPERADMIN");
  const store = await cookies();
  // "View as": a super admin sees S.A.M. as another profile does — its roles (so its menus and its rights), one entity, no group view.
  const view = superadmin ? store.get("sam_view")?.value : undefined;
  const [viewCode, viewEntRaw] = view && VIEW_RE.test(view) ? view.split("@") : [null, null];
  const viewAs = viewCode && viewCode !== "SUPERADMIN" ? viewCode : null;
  let roles = viewAs ? [viewAs] : realRoles;
  let role = roleKeyFrom(roles);
  const group = viewAs ? false : !!person?.is_group_function;
  const viewEnt = viewEntRaw && ENTS4.includes(viewEntRaw) ? viewEntRaw : (() => { const v = store.get("sam_ent")?.value; const e = v && v !== "ALL" ? normEntity(v) : null; return e && ENTS4.includes(e) ? e : person?.home_entity ?? ENTS4[0]; })();
  const entities = viewAs ? [viewEnt] : group ? ENTS4 : (person?.entities ?? []);
  const name = person?.display_name || (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || user.email || "";
  const wanted = (() => { const v = store.get("sam_ent")?.value; return v && v !== "ALL" ? normEntity(v) : v; })(); // old cookies (AJD…) still work
  // "ALL" = every entity of the person's scope: the whole group for a group function, their own entities for someone who works in several
  const mayAll = !viewAs && (group || entities.length > 1);
  const inScope = (e: string | null | undefined) => !!e && (e === "ALL" ? mayAll : entities.includes(e));
  // the entity chosen as default in the user menu (read apart: a missing column must never block a sign-in)
  let defaultEntity: string | null = null;
  if (person && !viewAs && (group || entities.length > 1)) { try { const { data: de } = await supabaseAdmin().from("people").select("default_entity").eq("id", person.id).maybeSingle(); const d = (de as { default_entity?: string | null } | null)?.default_entity ?? null; if (inScope(d)) defaultEntity = d; } catch { /* no default */ } }
  let entity = viewAs ? viewEnt : defaultEntity ?? (group ? "ALL" : (person?.home_entity ?? entities[0] ?? "ALL")); // a view works on its one entity
  if (wanted && inScope(wanted)) entity = wanted;
  // 09/11 · the Group view only on overviews and lists: a page that works on one entity gets the home entity instead
  // (the cookie keeps "ALL", so the overviews show the group again). x-sam-path is set by the middleware.
  const path = (await headers()).get("x-sam-path") ?? "";
  const entityPref = entity;
  if (entity === "ALL" && path && entMode(path) === "single") entity = singleEntity(person?.home_entity, entities);
  // RIGHTS-04 · the rights are those held in the organisation worked in ("ALL": everything held anywhere); the menus follow
  const mine = { roles: realRoles, sam_roles: samRoles };
  const rolesByEntity: Record<string, string[]> = viewAs ? { [viewEnt]: [viewAs] } : Object.fromEntries(entities.map((e) => [e, rolesIn(mine, e)]));
  if (!viewAs) { roles = rolesIn(mine, entity); role = roleKeyFrom(roles); }
  return { userId: user.id, email: user.email ?? "", name, initials: initialsOf(name), person, role, roles, rolesByEntity, entities, group, entity, entityPref, home: homeFor(role), viewAs, defaultEntity, superadmin, viewOptions: superadmin ? await viewOptionsFor() : [] };
});
