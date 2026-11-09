import type { SupabaseClient } from "@supabase/supabase-js";
import { E2_ATTR, E2_ENTITIES, getOccurrence, type TaxonomyCodes } from "@/lib/eccairs";
import { ENT } from "@/lib/nav";

/* ECC-02 · From a S.A.M. safety report to an E2 original report (taxonomyCodes JSON, ECCAIRS Aviation 5.1).
 * What is sent is what the safety desk reviews on the screen: S.A.M. proposes, codes from the cached taxonomy, the desk corrects,
 * then sends as DRAFT (visible to us only in E2) or SENT (reaches the authority). The narrative is the DE-IDENTIFIED MOR draft,
 * never the reporter's text; the reporter's identity never leaves S.A.M. (376/2014 art. 16). */

export type E2Field = { key: string; label: string; entity: number; attribute: number; kind: "text" | "date" | "list" | "lists" | "number"; value: string | string[] | null; listId?: number | null; required?: boolean; hint?: string; from?: string };
export type ReportForE2 = { id: string; entity: string; event_date: string | null; event_time_utc: string | null; aircraft: string | null; flight_ref: string | null; phase: string | null; location: string | null; headline: string; headline_en: string | null; narrative: string; narrative_en: string | null; language: string | null; report_type: string | null; occurrence_class: string | null; risk_category: string | null; event_type: string | null; complements: Record<string, string> | null; e2_id: string | null; e2_payload: TaxonomyCodes | null };
export type AnalysisForE2 = { mor_draft: string | null; adrep: string | null; mor_status: string | null } | null;
type Attr = { entity_code: number; attribute_code: number; description: string; data_type: string | null; value_list_id: number | null; min_instance: number | null };
type Val = { value_list_id: number; value_id: number; description: string; parent: number | null; level: number | null };
type Map = { field: string; our_value: string; attribute_code: number; value_id: number | null };

/** The value lists and maps a review screen needs, in one read. */
export async function e2Context(db: SupabaseClient, entity: string) {
  const { data: tx } = await db.from("eccairs_taxonomies").select("*").eq("entity", entity).maybeSingle();
  const t = tx as { taxonomy_id: number; name: string; version: string; loaded_at: string; env: string | null } | null;
  if (!t) return { taxonomy: null, attrs: [] as Attr[], values: [] as Val[], maps: [] as Map[] };
  const [{ data: at }, { data: mp }] = await Promise.all([
    db.from("eccairs_attributes").select("entity_code,attribute_code,description,data_type,value_list_id,min_instance").eq("taxonomy_id", t.taxonomy_id).range(0, 4999),
    db.from("eccairs_value_maps").select("field,our_value,attribute_code,value_id").eq("entity", entity),
  ]);
  // PostgREST caps a page at 1 000 rows: the values are read page by page
  const values: Val[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data } = await db.from("eccairs_values").select("value_list_id,value_id,description,parent,level").eq("taxonomy_id", t.taxonomy_id).eq("active", true).order("value_list_id").order("value_id").range(from, from + 999);
    const page = (data ?? []) as Val[]; values.push(...page); if (page.length < 1000) break;
  }
  return { taxonomy: t, attrs: (at ?? []) as Attr[], values, maps: (mp ?? []) as Map[] };
}
export type E2Context = Awaited<ReturnType<typeof e2Context>>;
const listOf = (ctx: E2Context, entity: number, attribute: number) => ctx.attrs.find((a) => a.entity_code === entity && a.attribute_code === attribute)?.value_list_id ?? null;
const mapped = (ctx: E2Context, field: string, our: string | null | undefined) => { if (!our) return null; const m = ctx.maps.find((x) => x.field === field && x.our_value.toLowerCase() === our.toLowerCase()); return m?.value_id != null ? String(m.value_id) : null; };
/** Finds a value by its description in a list (exact, then contains) — used for the proposals, the desk confirms. */
export function findValue(ctx: E2Context, listId: number | null, text: string | null | undefined): string | null {
  if (!listId || !text) return null; const t = text.trim().toLowerCase(); const vs = ctx.values.filter((v) => v.value_list_id === listId);
  return (vs.find((v) => v.description.toLowerCase() === t) ?? vs.find((v) => v.description.toLowerCase().startsWith(t)) ?? vs.find((v) => v.description.toLowerCase().includes(t)))?.value_id.toString() ?? null;
}
const OPERATOR_STATE: Record<string, string> = { ASJMT: "Malta", ASJFR: "France", ASFFR: "France", ASTFR: "France" };
const OPERATION_TYPE: Record<string, string> = { ASJMT: "Commercial air transport", ASJFR: "Commercial air transport", ASFFR: "Flight training / instructional", ASTFR: "Not applicable" };
const CLASS_WORDS: Record<string, string> = { accident: "Accident", "serious incident": "Serious incident", incident: "Incident", "major incident": "Major incident", "significant incident": "Significant incident", observation: "Observation", "occurrence without safety effect": "Occurrence without safety effect", "not determined": "Not determined" };

/** The fields S.A.M. proposes for the report, each with where it comes from. Lists are resolved through the maps, then by name. */
export function proposeFields(r: ReportForE2, a: AnalysisForE2, ctx: E2Context, extra: { registry?: { registration: string; type_code: string | null; model: string | null; msn: string | null } | null }): E2Field[] {
  const O = E2_ENTITIES.OCCURRENCE, A = E2_ENTITIES.AIRCRAFT, EV = E2_ENTITIES.EVENTS, N = E2_ENTITIES.NARRATIVE;
  const L = (e: number, at: number) => listOf(ctx, e, at);
  const cls = (r.occurrence_class ?? "").toLowerCase(); const clsName = Object.entries(CLASS_WORDS).find(([k]) => cls.includes(k))?.[1] ?? (a?.mor_status === "mandatory" ? "Incident" : "Occurrence without safety effect");
  const headline = (r.headline_en ?? r.headline).slice(0, 200);
  const narrative = a?.mor_draft?.trim() || null;
  const reg = r.aircraft?.trim() || extra.registry?.registration || null;
  const f: E2Field[] = [
    { key: "report_id", label: "Report identification", entity: O, attribute: E2_ATTR.REPORT_ID, kind: "text", value: r.id, required: true, from: "S.A.M. report number" },
    { key: "headline", label: "Headline", entity: O, attribute: E2_ATTR.HEADLINE, kind: "text", value: headline, required: true, from: r.headline_en ? "English headline" : "headline" },
    { key: "utc_date", label: "UTC date", entity: O, attribute: E2_ATTR.UTC_DATE, kind: "date", value: r.event_date, required: true, from: "event date" },
    { key: "local_date", label: "Local date of occurrence", entity: O, attribute: E2_ATTR.LOCAL_DATE, kind: "date", value: r.event_date, from: "event date" },
    { key: "location", label: "Location of occurrence", entity: O, attribute: E2_ATTR.LOCATION, kind: "text", value: r.location ?? (r.flight_ref ? `Flight ${r.flight_ref}` : null), required: true, hint: "A place name, or a departure–arrival pair (LFPB – LFMN). Never empty: write “Not reported”." },
    { key: "state", label: "State / area of occurrence", entity: O, attribute: E2_ATTR.STATE, kind: "list", listId: L(O, E2_ATTR.STATE), value: mapped(ctx, "state", r.entity) ?? findValue(ctx, L(O, E2_ATTR.STATE), OPERATOR_STATE[r.entity]), required: true, from: "entity's State unless the location says otherwise" },
    { key: "occ_class", label: "Occurrence class", entity: O, attribute: E2_ATTR.OCC_CLASS, kind: "list", listId: L(O, E2_ATTR.OCC_CLASS), value: mapped(ctx, "occurrence_class", r.occurrence_class) ?? findValue(ctx, L(O, E2_ATTR.OCC_CLASS), clsName), required: true, from: r.occurrence_class ? "occurrence class of the report" : "MOR decision" },
    { key: "occ_category", label: "Occurrence category", entity: O, attribute: E2_ATTR.OCC_CATEGORY, kind: "lists", listId: L(O, E2_ATTR.OCC_CATEGORY), value: [mapped(ctx, "report_type", r.report_type), mapped(ctx, "risk_category", r.risk_category), findValue(ctx, L(O, E2_ATTR.OCC_CATEGORY), a?.adrep)].filter((x): x is string => !!x), required: true, from: a?.adrep ? "ADREP category proposed by S.A.M." : "report type / risk category" },
    { key: "event_type", label: "Event type", entity: EV, attribute: E2_ATTR.EVENT_TYPE, kind: "lists", listId: L(EV, E2_ATTR.EVENT_TYPE), value: [mapped(ctx, "event_type", r.event_type), findValue(ctx, L(EV, E2_ATTR.EVENT_TYPE), r.event_type?.split("/").pop())].filter((x): x is string => !!x), required: true, from: r.event_type ? "event type of the report" : "to choose" },
    { key: "narrative_lang", label: "Narrative language", entity: N, attribute: E2_ATTR.NARRATIVE_LANG, kind: "list", listId: L(N, E2_ATTR.NARRATIVE_LANG), value: findValue(ctx, L(N, E2_ATTR.NARRATIVE_LANG), "English"), required: true },
    { key: "narrative", label: "Narrative (de-identified)", entity: N, attribute: E2_ATTR.NARRATIVE, kind: "text", value: narrative, required: true, from: narrative ? "MOR draft (de-identified by S.A.M.)" : "no MOR draft yet — run the analysis or write it", hint: "Only the de-identified text goes to the authority; the reporter's own words and identity stay in S.A.M." },
    { key: "weather", label: "Weather relevant", entity: A, attribute: E2_ATTR.WEATHER_RELEVANT, kind: "list", listId: L(A, E2_ATTR.WEATHER_RELEVANT), value: findValue(ctx, L(A, E2_ATTR.WEATHER_RELEVANT), "No") },
    { key: "ac_registration", label: "Aircraft registration", entity: A, attribute: E2_ATTR.AC_REGISTRATION, kind: "text", value: reg, from: "report / fleet" },
    { key: "ac_type", label: "Aircraft type (manufacturer / model)", entity: A, attribute: E2_ATTR.AC_TYPE, kind: "list", listId: L(A, E2_ATTR.AC_TYPE), value: mapped(ctx, "aircraft_type", extra.registry?.type_code) ?? mapped(ctx, "aircraft_type", extra.registry?.model), from: extra.registry?.type_code ? `fleet: ${extra.registry.type_code}` : "fleet registry", hint: "Long ICAO list — mapped once per type in Safety › MOR / ECCAIRS › Correspondences." },
    { key: "ac_msn", label: "Aircraft serial number", entity: A, attribute: E2_ATTR.AC_MSN, kind: "text", value: extra.registry?.msn ?? null, from: "fleet" },
    { key: "ac_callsign", label: "Call sign", entity: A, attribute: E2_ATTR.AC_CALLSIGN, kind: "text", value: r.flight_ref?.replace(/[\s-]/g, "") ?? null, from: "flight reference" },
    { key: "ac_operator", label: "Operator", entity: A, attribute: E2_ATTR.AC_OPERATOR, kind: "list", listId: L(A, E2_ATTR.AC_OPERATOR), value: mapped(ctx, "operator", r.entity), from: "entity (mapped once)" },
    { key: "ac_operation_type", label: "Operation type", entity: A, attribute: E2_ATTR.AC_OPERATION_TYPE, kind: "list", listId: L(A, E2_ATTR.AC_OPERATION_TYPE), value: mapped(ctx, "operation_type", r.entity) ?? findValue(ctx, L(A, E2_ATTR.AC_OPERATION_TYPE), OPERATION_TYPE[r.entity]), from: ENT[r.entity]?.qual ?? "entity" },
    { key: "ac_phase", label: "Flight phase", entity: A, attribute: E2_ATTR.AC_FLIGHT_PHASE, kind: "list", listId: L(A, E2_ATTR.AC_FLIGHT_PHASE), value: mapped(ctx, "phase", r.phase) ?? findValue(ctx, L(A, E2_ATTR.AC_FLIGHT_PHASE), r.phase?.split(" / ")[0]), from: r.phase ? `phase “${r.phase}”` : "to choose" },
    { key: "ac_departure", label: "Last departure point", entity: A, attribute: E2_ATTR.AC_LAST_DEPARTURE, kind: "text", value: r.complements?.departure ?? r.complements?.from ?? null, from: "complements" },
    { key: "ac_destination", label: "Planned destination", entity: A, attribute: E2_ATTR.AC_DESTINATION, kind: "text", value: r.complements?.destination ?? r.complements?.to ?? null, from: "complements" },
  ];
  return f;
}

/** Builds the taxonomyCodes from the reviewed fields: only filled attributes, entities as arrays with #id_number#. */
export function buildTaxonomyCodes(fields: E2Field[]): { codes: TaxonomyCodes; missing: string[] } {
  const occ: Record<string, unknown[]> = {}; const ents: Record<string, { ID: string; ATTRIBUTES: Record<string, unknown[]> }[]> = {};
  const missing: string[] = [];
  const put = (f: E2Field, vals: unknown[]) => {
    if (f.entity === E2_ENTITIES.OCCURRENCE) { occ[String(f.attribute)] = vals; return; }
    const k = String(f.entity); if (!ents[k]) ents[k] = [{ ID: "#id_number#", ATTRIBUTES: {} }]; ents[k][0].ATTRIBUTES[String(f.attribute)] = vals;
  };
  for (const f of fields) {
    const empty = f.value === null || f.value === "" || (Array.isArray(f.value) && !f.value.length);
    if (empty) { if (f.required) missing.push(f.label); continue; }
    if (f.kind === "list") put(f, [Number(f.value)]);
    else if (f.kind === "lists") put(f, (f.value as string[]).map(Number));
    else if (f.kind === "number") put(f, [Number(f.value)]);
    else put(f, [String(f.value)]);
  }
  const codes: TaxonomyCodes = { "24": { ATTRIBUTES: occ, ...(Object.keys(ents).length ? { ENTITIES: ents } : {}) } };
  return { codes, missing };
}

/** Evening job · the status of every report S.A.M. sent (or recorded) in E2, mirrored on the report. A handful of calls per entity. */
export async function syncE2(db: SupabaseClient, entity: string): Promise<number> {
  const { data } = await db.from("reports").select("id,e2_id,e2_status").eq("entity", entity).not("e2_id", "is", null).not("e2_status", "in", "(CLOSED,ARCHIVED,DELETED)").limit(200);
  let n = 0;
  for (const r of (data ?? []) as { id: string; e2_id: string; e2_status: string | null }[]) {
    try {
      const g = await getOccurrence(entity, r.e2_id) as { status?: string; version?: string } | null;
      if (!g) continue;
      const patch: Record<string, unknown> = { e2_synced_at: new Date().toISOString() };
      if (g.status && g.status !== r.e2_status) { patch.e2_status = g.status; await db.from("report_events").insert({ report_id: r.id, kind: "mor", actor: null, note: `ECCAIRS: status ${g.status}${g.version ? ` (v${g.version})` : ""}` }); }
      if (g.version) patch.e2_version = g.version;
      await db.from("reports").update(patch).eq("id", r.id);
      await db.from("eccairs_submissions").insert({ entity, report_id: r.id, env: null, kind: "sync", response: g, ok: true, e2_id: r.e2_id, e2_version: g.version ?? null, e2_status: g.status ?? null });
      n++;
    } catch (e) { await db.from("eccairs_submissions").insert({ entity, report_id: r.id, kind: "sync", ok: false, e2_id: r.e2_id, error: (e as Error).message.slice(0, 500) }); }
  }
  return n;
}
