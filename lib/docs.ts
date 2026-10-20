import { supabaseServer } from "@/lib/supabase-server";
import type { Session } from "@/lib/session";

export type Manual = { id: string; entity: string; code: string; title: string; owner_role: string; needs_signature: boolean; to_tmcad_repository: boolean; path: string | null };
export type Revision = { id: string; manual_id: string; issue: number; rev: string; step: string; authority_route: string | null; authority_ref: string | null; summary: string | null; published_at: string | null; created_at: string };
export type Section = { id: string; ord: number; ref: string; title: string | null; body: { html?: string; text?: string; pages?: string[] }; changed: boolean };
export type Certificate = { id: string; entity: string; scope: string; registration: string | null; kind: string; title: string; issuer: string | null; valid_until: string | null; file_path: string | null };

export const STEP_LABEL: Record<string, string> = {
  draft: "Draft", approved_np: "Approved by NP", approved_compliance: "Approved by Compliance", signed: "Signed",
  with_civil_aviation: "With civil aviation", published: "Published", repository: "Repository",
};
export const STEPS = ["draft", "approved_np", "approved_compliance", "signed", "with_civil_aviation", "published", "repository"];

export function entityFilter<T extends { eq: (c: string, v: string) => T }>(q: T, s: Session, col = "entity"): T {
  return s.entity === "ALL" ? q : q.eq(col, s.entity);
}

/** Manuals in scope with their current (latest published) and working (unpublished) revisions. */
export async function listManuals(s: Session): Promise<{ manual: Manual; current: Revision | null; working: Revision | null }[]> {
  const sb = await supabaseServer();
  let mq = sb.from("manuals").select("*").order("path").order("code");
  if (s.entity !== "ALL") mq = mq.eq("entity", s.entity);
  const { data: manuals } = await mq;
  const ids = (manuals ?? []).map((m: Manual) => m.id);
  if (!ids.length) return [];
  const { data: revs } = await sb.from("revisions").select("*").in("manual_id", ids).order("published_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false });
  const byManual = new Map<string, Revision[]>();
  for (const r of (revs ?? []) as Revision[]) { const a = byManual.get(r.manual_id) ?? []; a.push(r); byManual.set(r.manual_id, a); }
  return (manuals as Manual[]).map((manual) => {
    const rs = byManual.get(manual.id) ?? [];
    const current = rs.filter((r) => r.step === "published" || r.step === "repository").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0] ?? null;
    const working = rs.find((r) => r.step !== "published" && r.step !== "repository") ?? null;
    return { manual, current, working };
  });
}

export function folderOf(m: Manual): string {
  return (m.path ?? "Unfiled").split(" › ")[0];
}
export function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - Date.now()) / 86400000);
}
