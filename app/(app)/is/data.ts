import type { Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type Sys = { id: string; entity: string; name: string; kind: string | null; provider: string | null; hosting: string | null; data: string | null; owner_role: string | null; criticality: string; safety_relevant: boolean; active: boolean;
  ref: string | null; short: string | null; dept: string | null; zone: string | null; scope: string[] | null; resp: string | null; contract: string | null; ops_impact: string | null; purpose: string | null; status: string; attention: string | null; ring: number | null; source: string | null; note: string | null; subcontractor_id: string | null };
export type Flow = { id: string; entity: string; from_system: string; to_system: string; data: string | null; means: string | null; contract_ref: string | null; is_clause: boolean | null; criticality: string; active: boolean };
export type Risk = { id: string; entity: string; system_id: string | null; system: string | null; threat: string; likelihood: number | null; severity: number | null; status: string; due: string | null; owner_role: string | null; reviewed_on: string | null };
export type Inc = { id: string; entity: string; occurred_on: string; title: string; reported: boolean; status: string };

/** Part-IS data of the working entity (or every entity in Group view). */
export async function isData(s: Session) {
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin();
  const q = (t: string) => { let x = db.from(t).select("*").limit(2000); if (scope) x = x.in("entity", scope); return x; };
  const [a, b, c, d] = await Promise.all([q("is_systems"), q("is_flows"), q("is_risks"), q("is_incidents")]);
  return {
    systems: ((a.data ?? []) as Sys[]).filter((x) => x.active !== false),
    flows: ((b.data ?? []) as Flow[]).filter((x) => x.active !== false),
    risks: (c.data ?? []) as Risk[],
    incidents: (d.data ?? []) as Inc[],
  };
}
export const score = (r: Risk) => (r.likelihood ?? 0) * (r.severity ?? 0);
export const level = (n: number) => (n >= 15 ? "red" : n >= 8 ? "amber" : n > 0 ? "green" : "");

/** Group view: the cartography lists a system once even when several entities use it. */
export function onePerRef(systems: Sys[]): Sys[] {
  const seen = new Set<string>(); const out: Sys[] = [];
  for (const x of systems) { const k = x.ref ?? x.id; if (seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}
export const ATT: Record<string, [string, string]> = { critical: ["red", "Critical"], serious: ["amber", "To address"], warning: ["", "To monitor"] };
