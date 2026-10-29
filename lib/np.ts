import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChartSnapshot } from "@/lib/orgchart";

export type NpPost = { id: string; entity: string; code: string; title: string; parent_code: string | null; ord: number; holder_name: string | null; deputy_name: string | null; status: string; since: string | null; regulatory: string | null };
export const DEPUTY_LABEL: Record<string, string> = { ASTFR: "Adjoint & Suppléant", ASFFR: "Suppléant", ASJFR: "Suppléant", ASJMT: "Deputy" };

export async function postsOf(db: SupabaseClient, entity: string): Promise<NpPost[]> {
  const { data } = await db.from("np_posts").select("id,entity,code,title,parent_code,ord,holder_name,deputy_name,status,since,regulatory").eq("entity", entity).order("ord").order("code");
  return (data ?? []) as NpPost[];
}
export function snapshotOf(entity: string, posts: NpPost[]): ChartSnapshot {
  return { entity, at: new Date().toISOString().slice(0, 10), source: "S.A.M. · NP management", deputyLabel: DEPUTY_LABEL[entity] ?? "Deputy",
    posts: posts.map((p) => ({ code: p.code, title: p.title, holder: p.holder_name, deputy: p.deputy_name, parent: p.parent_code })) };
}
export async function currentSnapshot(db: SupabaseClient, entity: string): Promise<ChartSnapshot> {
  return snapshotOf(entity, await postsOf(db, entity));
}
