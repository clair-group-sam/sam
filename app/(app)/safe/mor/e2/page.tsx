import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isSafetyDesk, PHASES } from "@/lib/safety";
import { E2_ATTR, E2_ENTITIES, eccairsConfig, eccairsEnv } from "@/lib/eccairs";
import { e2Context, withLongValues } from "@/lib/eccairs-map";
import { loadTax, saveMap, testLink, loadLong, proposeMaps } from "./actions";

/* ECC-01 · Safety › MOR / ECCAIRS › E2 link: connection, cached taxonomy, and the correspondences S.A.M. uses to code a report
 * (occurrence class, phase, report type / risk category → occurrence category, event type, aircraft type, operator, State). */
type Sp = { ent?: string; msg?: string; q?: string };
const FIELDS: { field: string; label: string; entity: number; attribute: number; ours: (db: Awaited<ReturnType<typeof ours>>, entity: string) => string[] }[] = [
  { field: "occurrence_class", label: "Occurrence class", entity: E2_ENTITIES.OCCURRENCE, attribute: E2_ATTR.OCC_CLASS, ours: (o) => o.classes },
  { field: "phase", label: "Phase of flight", entity: E2_ENTITIES.AIRCRAFT, attribute: E2_ATTR.AC_FLIGHT_PHASE, ours: () => PHASES },
  { field: "report_type", label: "Report type → occurrence category", entity: E2_ENTITIES.OCCURRENCE, attribute: E2_ATTR.OCC_CATEGORY, ours: (o) => o.types },
  { field: "risk_category", label: "Risk category → occurrence category", entity: E2_ENTITIES.OCCURRENCE, attribute: E2_ATTR.OCC_CATEGORY, ours: (o) => o.risks },
  { field: "event_type", label: "Event type", entity: E2_ENTITIES.EVENTS, attribute: E2_ATTR.EVENT_TYPE, ours: (o) => o.events },
  { field: "aircraft_type", label: "Aircraft type (fleet)", entity: E2_ENTITIES.AIRCRAFT, attribute: E2_ATTR.AC_TYPE, ours: (o) => o.acTypes },
  { field: "operator", label: "Operator (entity)", entity: E2_ENTITIES.AIRCRAFT, attribute: E2_ATTR.AC_OPERATOR, ours: (_, e) => [e] },
  { field: "operation_type", label: "Operation type (entity)", entity: E2_ENTITIES.AIRCRAFT, attribute: E2_ATTR.AC_OPERATION_TYPE, ours: (_, e) => [e] },
  { field: "state", label: "State of occurrence (entity default)", entity: E2_ENTITIES.OCCURRENCE, attribute: E2_ATTR.STATE, ours: (_, e) => [e] },
];
async function ours(db: ReturnType<typeof supabaseAdmin>, entity: string) {
  const [{ data: rp }, { data: ac }] = await Promise.all([db.from("reports").select("occurrence_class,report_type,risk_category,event_type").eq("entity", entity).limit(5000), db.from("aircraft").select("type_code,model").eq("entity", entity)]);
  const rows = (rp ?? []) as { occurrence_class: string | null; report_type: string | null; risk_category: string | null; event_type: string | null }[];
  const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return { classes: u(rows.map((r) => r.occurrence_class)), types: u(rows.map((r) => r.report_type)), risks: u(rows.map((r) => r.risk_category)), events: u(rows.map((r) => r.event_type)).slice(0, 200), acTypes: u(((ac ?? []) as { type_code: string | null; model: string | null }[]).map((x) => x.type_code ?? x.model)) };
}
export default async function E2Admin({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login"); if (!isSafetyDesk(s)) redirect("/safe/mine");
  const sp = await searchParams; const scope = s.entity === "ALL" ? (s.group ? ENTS4 : s.entities) : [s.entity];
  const entity = sp.ent && scope.includes(sp.ent) ? sp.ent : scope[0];
  const db = supabaseAdmin();
  const [ctx0, o, { data: subs }] = await Promise.all([e2Context(db, entity), ours(db, entity), db.from("eccairs_submissions").select("at,kind,requested_status,ok,e2_id,e2_status,error,report_id").eq("entity", entity).order("at", { ascending: false }).limit(15)]);
  // long lists: the fleet's types and the entity's name are looked up by name, plus whatever the desk searches (?q=)
  const { data: fleet } = await db.from("aircraft").select("type_code,model").eq("entity", entity);
  let ctx = ctx0;
  for (const f of ((fleet ?? []) as { type_code: string | null; model: string | null }[]).slice(0, 12)) ctx = await withLongValues(db, ctx, { entity, registry: f });
  ctx = await withLongValues(db, ctx, { entity, q: sp.q ?? null });
  const longCount = ctx.taxonomy && ctx.long.length ? (await db.from("eccairs_values").select("value_id", { count: "exact", head: true }).eq("taxonomy_id", ctx.taxonomy.taxonomy_id).in("value_list_id", ctx.long)).count ?? 0 : 0;
  const cfg = !!eccairsConfig(entity); const env = eccairsEnv(entity);
  const vals = (listId: number | null | undefined) => (listId ? ctx.values.filter((v) => v.value_list_id === listId) : []);
  const listOf = (e: number, a: number) => ctx.attrs.find((x) => x.entity_code === e && x.attribute_code === a)?.value_list_id ?? null;
  return (
    <>
      <PageHeader eyebrow="Safety, MOR / ECCAIRS, E2 link" title="ECCAIRS 2 from S.A.M." sub="Machine-to-machine link per entity: connection test, the authority's taxonomy cached in S.A.M., and the correspondences between our values and E2 codes. S.A.M. proposes a coded report; the safety desk reviews and sends."
        right={<div className="flex gap-2 items-center">{scope.length > 1 && <div className="tabs" style={{ margin: 0 }}>{scope.map((e) => <Link key={e} href={`/safe/mor/e2?ent=${e}`} className={"tab" + (e === entity ? " on" : "")}>{e}</Link>)}</div>}<Link className="btn" href="/safe/mor">MOR register</Link></div>} />
      {sp.msg && <div className="card mb-4"><div className="cb">{sp.msg}</div></div>}
      <section className="card mb-4"><div className="ch"><span><b>{ENT[entity]?.name ?? entity}</b> <span className="mini">· {ENT[entity]?.auth}</span></span><span className={"pill " + (cfg ? "green" : "")}>{cfg ? `Configured, ${env}` : "Not configured"}</span></div>
        <div className="cb">
          <p className="mini mb-2">Sandbox = EASA organisation for S.A.M. (M2M user created 30/10/2026, base api.uat.aviationreporting.eu, outgoing IP through the fixed-IP proxy). UAT and production users come from the competent authority ({ENT[entity]?.auth}) once the sandbox works. Each test or load costs a few proxy requests (free plan: 500 / month).</p>
          <div className="flex gap-2 flex-wrap">
            <form action={testLink}><input type="hidden" name="entity" value={entity} /><button className="btn" disabled={!cfg}>Test the connection</button></form>
            <form action={loadTax}><input type="hidden" name="entity" value={entity} /><button className="btn primary" disabled={!cfg}>{ctx.taxonomy ? "Reload the taxonomy" : "Load the taxonomy"}</button></form>
            <form action={loadLong}><input type="hidden" name="entity" value={entity} /><button className="btn" disabled={!cfg || !ctx.taxonomy} title="Aircraft make/model (~20 000) and operators (~17 000): cached once, searched by name">{longCount ? "Reload the long lists" : "Load the long lists (aircraft types, operators)"}</button></form>
          </div>
          {ctx.taxonomy && <p className="mini mt-2">Taxonomy <b>{ctx.taxonomy.name} {ctx.taxonomy.version}</b> loaded {ctx.taxonomy.loaded_at.slice(0, 16).replace("T", " ")} ({ctx.taxonomy.env}) · {ctx.attrs.length} attributes · {ctx.values.length} values in {new Set(ctx.values.map((v) => v.value_list_id)).size} lists{longCount ? ` · long lists: ${longCount} aircraft types and operators` : " · long lists not cached yet"}.</p>}
        </div></section>
      <section className="card mb-4"><div className="ch"><span className="eyebrow">Correspondences, S.A.M. value → E2 value</span><span className="flex gap-2 items-center"><form action={proposeMaps}><input type="hidden" name="entity" value={entity} /><button className="btn sm" disabled={!ctx.taxonomy} title="Occurrence classes, phases and event types that S.A.M. can read from the names — where nothing is set yet; the desk confirms">Propose by name</button></form><form method="get" className="flex gap-1 items-center"><input type="hidden" name="ent" value={entity} /><input name="q" className="inp" defaultValue={sp.q ?? ""} placeholder="search the long lists (e.g. Mustang, Astonjet)" style={{ marginTop: 0, width: 280 }} /><button className="btn sm">Search</button></form><span className="mini">{ctx.maps.length} set</span></span></div>
        <div className="cb" style={{ padding: 0 }}>
          {!ctx.taxonomy ? <p className="p-4 mini">Load the taxonomy first: the lists come from it.</p> : <table className="tbl"><thead><tr><th>Field</th><th>Our value</th><th>E2 value</th><th></th></tr></thead><tbody>
            {FIELDS.flatMap((F) => { const lid = listOf(F.entity, F.attribute); const list = vals(lid); return F.ours(o, entity).map((our) => { const m = ctx.maps.find((x) => x.field === F.field && x.our_value === our); return (
              <tr key={F.field + our}><td><b>{F.label}</b><div className="mini mono">{F.entity}.{F.attribute}{lid ? ` · list ${lid}` : " · list not cached"}</div></td><td>{our}</td>
                <td><form action={saveMap} className="flex gap-1" id={`m-${F.field}-${our}`}><input type="hidden" name="entity" value={entity} /><input type="hidden" name="field" value={F.field} /><input type="hidden" name="our_value" value={our} /><input type="hidden" name="attribute_code" value={F.attribute} />
                  {list.length ? <select name="value_id" className="inp" defaultValue={m?.value_id ?? ""} style={{ marginTop: 0, maxWidth: 420 }}><option value="">—</option>{list.map((v) => <option key={v.value_id} value={v.value_id}>{v.level && v.level > 1 ? "· ".repeat(v.level - 1) : ""}{v.description}</option>)}</select> : <input name="value_id" className="inp mono" defaultValue={m?.value_id ?? ""} placeholder="E2 value id" style={{ marginTop: 0, width: 140 }} />}
                  <button className="btn sm">Save</button>{m && <button className="btn sm" name="what" value="remove">×</button>}</form></td>
                <td className="mini">{m ? (m.note?.startsWith("proposed") ? <span title={m.note}>proposed, to confirm</span> : "set") : <span className="late">missing</span>}</td></tr>); }); })}
          </tbody></table>}
        </div></section>
      {(subs ?? []).length > 0 && <section className="card"><div className="ch"><span className="eyebrow">Last exchanges with E2</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{((subs ?? []) as { at: string; kind: string; requested_status: string | null; ok: boolean; e2_id: string | null; e2_status: string | null; error: string | null; report_id: string }[]).map((h, i) => <tr key={i}><td className="mini">{h.at.slice(0, 16).replace("T", " ")}</td><td><Link href={`/safe/reports/${h.report_id}`} className="mono">{h.report_id}</Link></td><td>{h.kind}{h.requested_status ? ` → ${h.requested_status}` : ""}</td><td>{h.ok ? <span className="pill green">{h.e2_id} {h.e2_status}</span> : <span className="pill red">refused</span>}{h.error && <div className="mini">{h.error}</div>}</td></tr>)}</tbody></table></div></section>}
    </>
  );
}
