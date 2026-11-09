import type { SupabaseClient } from "@supabase/supabase-js";
import { attentionFrom, contractFrom, riskScore, risksOf, type IsRiskLite, type SubLite } from "@/lib/is-shared";

/* PRO-IS-01 annexes generated from the registers (10/11/2026): the perimeter of each annex, its systems by responsibility sector,
 * their contract, attention level and IS risks, the interfaces and the departments still to answer. Replaces the HTML cartography. */
export const ANNEXES: Record<string, { title: string; ents: string[]; basis: string }> = {
  AJD: { title: "PRO-IS-01 AJD, Astonjet Ltd (ASJMT)", ents: ["ASJMT"], basis: "Air operator (AOC MT-79) and Part-CAMO MT.CAMO.0079, TM-CAD. The AJD CAMO also serves Astonjet SAS." },
  ASJASF: { title: "PRO-IS-01 ASJ+ASF, Astonjet SAS (ASJFR) and Astonfly (ASFFR)", ents: ["ASJFR", "ASFFR"], basis: "Air operator Astonjet SAS and ATO Astonfly, DSAC. Airworthiness systems: see PRO-IS-01 AJD (group CAMO)." },
};
export const SECTORS: [string, string, string][] = [
  ["own", "Under the entity's responsibility", "Own contracts: Part-IS clauses to carry (IS.I.OR.235)."],
  ["grp", "Under Clair Group or another entity", "Organisations not subject to Part-IS: contractual control, audit rights, IS event reporting (IS.I.OR.215(c)), authority access (IS.I.OR.235(b))."],
  ["auth", "Authority or State channels", "Imposed channels (TM-CAD, DGAC, EU, AIFE)."],
];
type Sys = { id: string; entity: string; ref: string | null; name: string; short: string | null; dept: string | null; zone: string | null; resp: string | null; contract: string | null; ops_impact: string | null; purpose: string | null; data: string | null; hosting: string | null; provider: string | null; status: string; attention: string | null; source: string | null; subcontractor_id: string | null };
export type AnnexLine = Sys & { ents: string[]; contractState: string | null; contractTxt: string | null; level: string | null; levelFrom: boolean; risks: { threat: string; score: number; status: string }[] };

export async function annexData(db: SupabaseClient, key: string) {
  const A = ANNEXES[key];
  const [{ data: sd }, { data: fd }, { data: rd }, { data: cd }] = await Promise.all([
    db.from("is_systems").select("*").in("entity", A.ents).eq("active", true).order("name"),
    db.from("is_flows").select("*").in("entity", A.ents).eq("active", true).order("from_system"),
    db.from("is_risks").select("id,entity,system_id,system,threat,likelihood,severity,status").in("entity", A.ents),
    db.from("subcontractors").select("id,name,contract_ref,contract_until,is_clause,access_clause"),
  ]);
  const risks = (rd ?? []) as IsRiskLite[];
  const subs = new Map(((cd ?? []) as SubLite[]).map((x) => [x.id, x]));
  const by = new Map<string, Sys[]>();
  for (const r of (sd ?? []) as Sys[]) { const k = r.ref ?? r.id; by.set(k, [...(by.get(k) ?? []), r]); }
  const lines: AnnexLine[] = [...by.values()].map((rs) => {
    const b = rs[0];
    const rk = rs.flatMap((r) => risksOf(r, risks)).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i);
    const lv = attentionFrom(rk);
    const sub = rs.find((r) => r.subcontractor_id)?.subcontractor_id;
    const ct = contractFrom(sub ? subs.get(sub) : undefined);
    return { ...b, ents: rs.map((r) => r.entity), contractState: ct?.state ?? b.contract, contractTxt: ct?.txt ?? null, level: lv ?? b.attention, levelFrom: !!lv, risks: rk.map((r) => ({ threat: r.threat, score: riskScore(r), status: r.status })) };
  });
  const flows = ((fd ?? []) as { from_system: string; to_system: string; data: string | null; means: string | null; contract_ref: string | null; is_clause: boolean | null; criticality: string }[])
    .filter((f, i, a) => a.findIndex((g) => g.from_system === f.from_system && g.to_system === f.to_system) === i);
  return { A, systems: lines.filter((l) => l.status !== "awaiting"), awaiting: lines.filter((l) => l.status === "awaiting"), flows };
}
