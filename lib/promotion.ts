// SAF-09 Safety promotion: bulletins, notices, surveys — audience, numbers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { basePost, type Session } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
import { PROMO_KIND } from "@/lib/promotion-shared";
export * from "@/lib/promotion-shared";

/** The safety desk writes and publishes; NP and AM may write a draft too. */
export const mayWrite = (s: Session) => isSafetyDesk(s) || s.role === "np" || s.role === "am";
export const mayPublish = (s: Session) => isSafetyDesk(s);

const OFFICE_NONE = new Set(["USER", "CREW", "EXT", ""]);
const NP_POSTS = new Set(["AM", "SM", "CMM", "NPFO", "NPCA", "NPGO", "NPCT", "NPMT", "CFI", "HT", "CTKI", "FSO", "MAM", "QM", "NP"]);
/** People of the entity in the audience (people.roles holds the posts; no post = crew / staff). */
export async function audiencePeople(db: SupabaseClient, entity: string, audience: string): Promise<string[]> {
  const { data } = await db.from("people").select("id,roles").contains("entities", [entity]).limit(2000);
  const rows = (data ?? []) as { id: string; roles: string[] | null }[];
  const posts = (r: { roles: string[] | null }) => (r.roles ?? []).map((x) => basePost(String(x).toUpperCase())).filter((x) => !OFFICE_NONE.has(x));
  return rows.filter((r) => audience === "all" ? true : audience === "crew" ? posts(r).length === 0 : audience === "office" ? posts(r).length > 0 : posts(r).some((p) => NP_POSTS.has(p))).map((r) => r.id);
}

export async function nextPromoNumber(db: SupabaseClient, entity: string, kind: string, year = new Date().getUTCFullYear()): Promise<string> {
  const prefix = `${PROMO_KIND[kind]?.short ?? "SB"}-${entity}-${year}-`;
  const { data } = await db.from("safety_promotions").select("number").eq("entity", entity).like("number", `${prefix}%`);
  const max = Math.max(0, ...((data ?? []) as { number: string }[]).map((x) => Number(x.number.slice(prefix.length)) || 0));
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}
