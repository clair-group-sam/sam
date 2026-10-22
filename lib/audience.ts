import type { SupabaseClient } from "@supabase/supabase-js";
import { NP_ROLES, basePost } from "@/lib/session";
import type { Manual } from "@/lib/docs";

/** Who must read a manual. Tokens: ALL · ROLE:<post> (holders and deputies) · PERSON:<uuid>. No token = ALL. */
export type Reader = { id: string; display_name: string; email: string | null; job_title: string | null; roles: string[] };
type PersonRow = Reader & { entities: string[] | null; home_entity: string | null; is_group_function: boolean };

export const POSTS = ["AM", "CMM", "SM", ...NP_ROLES.filter((r) => r !== "NP")];

export async function audienceTokens(db: SupabaseClient, manualId: string): Promise<string[]> {
  const { data } = await db.from("manual_audiences").select("token").eq("manual_id", manualId);
  const t = ((data ?? []) as { token: string }[]).map((x) => x.token);
  return t.length ? t : ["ALL"];
}

/** People of the manual's entity (and group functions, who are only readers when named by post or by name). */
export async function peopleFor(db: SupabaseClient, entity: string): Promise<PersonRow[]> {
  const { data } = await db.from("people").select("id,display_name,email,job_title,roles,entities,home_entity,is_group_function").order("display_name");
  return ((data ?? []) as PersonRow[]).filter((p) => p.is_group_function || p.home_entity === entity || (p.entities ?? []).includes(entity));
}

export function resolveReaders(people: PersonRow[], entity: string, tokens: string[]): Reader[] {
  const all = tokens.includes("ALL");
  const posts = new Set(tokens.filter((t) => t.startsWith("ROLE:")).map((t) => t.slice(5)));
  const named = new Set(tokens.filter((t) => t.startsWith("PERSON:")).map((t) => t.slice(7)));
  return people.filter((p) => {
    const staff = p.home_entity === entity || (p.entities ?? []).includes(entity);
    if (named.has(p.id)) return true;
    if (all && staff && !p.is_group_function) return true;
    return (p.roles ?? []).some((r) => posts.has(basePost(r)));
  }).map(({ id, display_name, email, job_title, roles }) => ({ id, display_name, email, job_title, roles }));
}

export async function readersOf(db: SupabaseClient, manual: Manual): Promise<Reader[]> {
  const [tokens, people] = await Promise.all([audienceTokens(db, manual.id), peopleFor(db, manual.entity)]);
  return resolveReaders(people, manual.entity, tokens);
}

export function describeTokens(tokens: string[], entityName: string, names: Map<string, string>): string {
  const parts: string[] = [];
  if (tokens.includes("ALL")) parts.push(`all staff of ${entityName}`);
  const posts = tokens.filter((t) => t.startsWith("ROLE:")).map((t) => t.slice(5));
  if (posts.length) parts.push(posts.join(", ") + " (and deputies)");
  const people = tokens.filter((t) => t.startsWith("PERSON:")).map((t) => names.get(t.slice(7)) ?? "someone");
  if (people.length) parts.push(people.join(", "));
  return parts.join(" · ") || "nobody";
}
