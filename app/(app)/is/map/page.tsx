import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import IsCartography, { type CartoData, type CartoSys } from "@/components/IsCartography";

/* Part-IS · Map: the Cartographie Part-IS drawn as it was (nebula per entity, department map, table), now fed by the registers.
 * Editing happens in the Systems register and Interfaces & contracts; a system's panel opens its line. */
const TO_CARTO: Record<string, string> = { ASJMT: "AJD", ASJFR: "ASJ", ASFFR: "ASF", ASTFR: "GRP", GRP: "GRP" };
const STATUS: Record<string, string> = { confirmed: "confirme", to_confirm: "a_confirmer", awaiting: "attente" };
// departments that use the transverse systems (Cartographie V7.1, CSM decision 22/07/2026)
const USE: [string, string][] = [["m365", "fo"], ["m365", "camo"], ["m365", "go"], ["m365", "training"], ["m365", "caa"], ["m365", "asf"], ["webman", "fo"], ["webman", "camo"], ["webman", "go"], ["webman", "training"], ["leon", "fo"], ["leon", "go"]];

type Row = { id: string; entity: string; ref: string | null; name: string; short: string | null; dept: string | null; zone: string | null; scope: string[] | null; resp: string | null; contract: string | null; ops_impact: string | null; hosting: string | null; provider: string | null; purpose: string | null; data: string | null; status: string; attention: string | null; note: string | null; source: string | null; active: boolean };

export default async function IsMap() {
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const [{ data: sd }, { data: fd }] = await Promise.all([
    db.from("is_systems").select("*").eq("active", true).order("name").limit(3000),
    db.from("is_flows").select("from_system,to_system,entity,active").eq("active", true).limit(3000),
  ]);
  const rows = (sd ?? []) as Row[];
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const k = r.ref ?? r.id; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const DATA: CartoSys[] = [...groups.entries()].map(([id, rs]) => {
    const ajd = rs.find((r) => r.entity === "ASJMT"), asj = rs.find((r) => r.entity === "ASJFR");
    const base = ajd ?? rs[0];
    const mine = rs.find((r) => r.entity === s.entity) ?? base;
    const ent = (base.scope?.length ? base.scope : rs.map((r) => r.entity)).map((e) => TO_CARTO[e] ?? e);
    return {
      id, name: base.name, short: base.short ?? "", dept: base.dept ?? "", zone: base.zone ?? "trans", ent: [...new Set(ent)],
      resp: base.zone === "pending" ? null : base.resp, respAsj: asj && ajd && asj.resp !== ajd.resp ? asj.resp ?? undefined : undefined,
      contract: base.zone === "pending" ? null : base.contract, impact: base.ops_impact ?? "?", hosting: base.hosting ?? "?", provider: base.provider ?? "?",
      purpose: base.purpose ?? "", dataT: base.data ?? "", status: STATUS[base.status] ?? "confirme", risk: base.attention,
      notes: (base.note ?? "").split("\n").map((x) => x.trim()).filter(Boolean), src: base.source ?? "", link: `/is/systems?open=${mine.id}#edit`,
    };
  });
  const idOf = new Map(DATA.map((d) => [d.name.toLowerCase(), d.id]));
  const EDGES: CartoData["EDGES"] = [];
  const seen = new Set<string>();
  for (const f of (fd ?? []) as { from_system: string; to_system: string }[]) {
    const a = idOf.get(f.from_system.toLowerCase()), b = idOf.get(f.to_system.toLowerCase());
    if (!a || !b || seen.has(a + ">" + b)) continue; seen.add(a + ">" + b); EDGES.push({ from: a, to: b, kind: "data" });
  }
  const ids = new Set(DATA.map((d) => d.id));
  for (const [from, toZone] of USE) if (ids.has(from)) EDGES.push({ from, toZone, kind: "use" });
  const e = s.entity;
  const data: CartoData = { DATA, EDGES, mode: "neb", neb: e === "ASJFR" || e === "ASFFR" ? "ASJASF" : "AJD", view: e === "ASJMT" ? "AJD" : e === "ASJFR" || e === "ASFFR" ? "ASJASF" : "all" };
  return (
    <>
      <PageHeader eyebrow="Part-IS, Map" title="Information flow map" sub="The Cartographie Part-IS, now drawn from the registers. Nebula: the systems orbit the entity in three responsibility sectors (own contracts, Clair Group, authorities), criticality by colour and ring, dashed ray when the contract holder or IS clauses are to confirm. Click the centre for the department map, a system for its detail."
        right={<div className="flex gap-2"><Link className="btn" href="/is/flows">Interfaces</Link><Link className="btn" href="/is/systems">Edit the systems</Link></div>} />
      {DATA.length ? <IsCartography data={data} /> : <section className="card"><div className="cb mini">No system recorded yet. Add them in <Link className="underline" href="/is/systems">Systems register</Link>.</div></section>}
    </>
  );
}
