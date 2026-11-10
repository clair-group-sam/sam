// ECCAIRS 2 M2M API (EASA "E2 API Guide for Organisations" v1.2 — received from E2 Support on 30/10/2026; v1.1 from TM-CAD on 30/03/2026).
// Base URLs: sandbox / UAT https://api.uat.aviationreporting.eu (portal e2.uat.aviationreporting.eu) · production https://api.aviationreporting.eu.
// v1.2: login on the Spring Boot 3 authorization server (same endpoint) · new usermgmt/autofilled-attributes.
// OAuth 2.1 client credentials: POST {BASE}/idp/oauth2/token (client_id = M2M user, client_secret = its password) → Bearer, 1 h.
// The calling IP must be whitelisted by EASA: calls go through the fixed-IP proxy (lib/proxy-fetch, FIXIE_URL). Phases: sandbox → UAT (regulator checks) → production, one M2M user each.
// Methods used by S.A.M.: occurrences/create (taxonomy-code JSON) · occurrences/edit · occurrences/change-status ·
// occurrences/reporter/original-report/search (all reports of the organisation) · occurrences/fields/{e2Id} · frontfile-api/files/migrate (E5X).
import { proxyFetch } from "@/lib/proxy-fetch";
import type { SupabaseClient } from "@supabase/supabase-js";
type Cfg = { base: string; id: string; secret: string };
const cache = new Map<string, { token: string; until: number }>();

/** Per entity: ECCAIRS_<ENT>_BASE_URL / _CLIENT_ID / _CLIENT_SECRET; else the shared ECCAIRS_BASE_URL / ECCAIRS_CLIENT_ID / ECCAIRS_CLIENT_SECRET (the EASA sandbox organisation, one M2M user for the group). */
export function eccairsConfig(entity: string): Cfg | null {
  const base = process.env[`ECCAIRS_${entity}_BASE_URL`] ?? process.env.ECCAIRS_BASE_URL; const id = process.env[`ECCAIRS_${entity}_CLIENT_ID`] ?? process.env.ECCAIRS_CLIENT_ID; const secret = process.env[`ECCAIRS_${entity}_CLIENT_SECRET`] ?? process.env.ECCAIRS_CLIENT_SECRET;
  return base && id && secret ? { base: base.replace(/\/$/, ""), id, secret } : null;
}
export const eccairsEnv = (entity: string) => { const b = process.env[`ECCAIRS_${entity}_BASE_URL`] ?? process.env.ECCAIRS_BASE_URL ?? ""; return /sandbox/i.test(b) || (/uat/i.test(b) && !process.env[`ECCAIRS_${entity}_CLIENT_ID`]) ? "sandbox" : /uat|test/i.test(b) ? "UAT" : b ? "production" : null; };

async function token(entity: string, c: Cfg): Promise<string> {
  const k = `${entity}:${c.base}`; const hit = cache.get(k); if (hit && hit.until > Date.now() + 60e3) return hit.token;
  const url = `${c.base}/idp/oauth2/token`; const form = "application/x-www-form-urlencoded";
  // v1.2: client_id / client_secret in the body (client_secret_post), NO scope (the sandbox answers invalid_scope to "openid", 09/11/2026); fallback HTTP Basic.
  let r = await proxyFetch(url, { method: "POST", headers: { "content-type": form }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret }).toString() });
  if (r.status === 401 || r.status === 400) {
    const basic = Buffer.from(`${encodeURIComponent(c.id)}:${encodeURIComponent(c.secret)}`).toString("base64");
    const r2 = await proxyFetch(url, { method: "POST", headers: { "content-type": form, authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "client_credentials" }).toString() });
    if (r2.ok || r2.status !== 401) r = r2;
  }
  const raw = await r.text(); let j: { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null = null; try { j = JSON.parse(raw); } catch { /* not JSON */ }
  if (!r.ok || !j?.access_token) throw new Error(`ECCAIRS token refused (${r.status}${j?.error ? ` ${j.error}` : ""}${j?.error_description ? `: ${j.error_description}` : ""}) — check the M2M user (activated, password) and that the IP is whitelisted by EASA.`.slice(0, 300));
  cache.set(k, { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 }); return j.access_token;
}
/** Diagnostic of the token step only (no secret leaves): what is configured and how the authorization server answers each client-auth variant. */
export async function tokenDiagnostic(entity: string): Promise<Record<string, unknown>> {
  const c = eccairsConfig(entity); if (!c) return { configured: false };
  const url = `${c.base}/idp/oauth2/token`; const form = "application/x-www-form-urlencoded";
  const out: Record<string, unknown> = { base: c.base, client_id: c.id, client_id_length: c.id.length, secret_length: c.secret.length, secret_has_spaces: /\s/.test(c.secret), secret_has_quotes: /["']/.test(c.secret) };
  const tryOne = async (name: string, init: { headers: Record<string, string>; body: string }) => {
    try { const r = await proxyFetch(url, { method: "POST", ...init }); const txt = await r.text(); out[name] = { status: r.status, body: txt.slice(0, 200), www_authenticate: r.headers.get("www-authenticate") }; } catch (e) { out[name] = { error: (e as Error).message }; }
  };
  await tryOne("post_body_openid", { headers: { "content-type": form }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret, scope: "openid" }).toString() });
  await tryOne("post_body_noscope", { headers: { "content-type": form }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret }).toString() });
  const alt = process.env.ECCAIRS_ALT_CLIENT_ID; // e.g. the M2M user's e-mail, to test whether the server expects it instead of the username
  if (alt) await tryOne("post_body_alt_id", { headers: { "content-type": form }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: alt, client_secret: c.secret, scope: "openid" }).toString() });
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  await tryOne("basic_raw", { headers: { "content-type": form, authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "client_credentials" }).toString() });
  const basicEnc = Buffer.from(`${encodeURIComponent(c.id)}:${encodeURIComponent(c.secret)}`).toString("base64");
  await tryOne("basic_urlencoded", { headers: { "content-type": form, authorization: `Basic ${basicEnc}` }, body: new URLSearchParams({ grant_type: "client_credentials" }).toString() });
  try { const r = await proxyFetch(`${c.base}/idp/.well-known/openid-configuration`); out.well_known = { status: r.status, body: (await r.text()).slice(0, 600) }; } catch (e) { out.well_known = { error: (e as Error).message }; }
  try { const r = await proxyFetch(`${c.base}/auth/api/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "password", username: c.id, password: c.secret }) }); out.legacy_password_grant = { status: r.status, body: (await r.text()).slice(0, 200) }; } catch (e) { out.legacy_password_grant = { error: (e as Error).message }; }
  return out;
}
type E2 = { data?: unknown; errorDetails?: string; returnCode?: number };
export async function e2(entity: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<E2> {
  const c = eccairsConfig(entity); if (!c) throw new Error(`ECCAIRS is not configured for ${entity}.`);
  const r = await proxyFetch(`${c.base}${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${await token(entity, c)}`, "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const raw = await r.text(); let j: E2 | null = null; try { j = JSON.parse(raw) as E2; } catch { j = null; }
  if (!r.ok || !j) throw new Error(`ECCAIRS ${path} → ${r.status}${raw ? `: ${raw.replace(/\s+/g, " ").slice(0, 1800)}` : ""}`);
  if (j.returnCode !== 1 && j.errorDetails) throw new Error(`ECCAIRS: ${j.errorDetails}`.slice(0, 400));
  return j;
}
export type E2Report = { e2Id: string; version: string; reportStatus: string; creationDate: string; responsibleEntity: string; reportedByMe: boolean };
/** Every original report of the organisation (paged). */
export async function listReports(entity: string, status = ["DRAFT", "SENT", "PROCESSED", "ARCHIVED"]): Promise<E2Report[]> {
  const out: E2Report[] = [];
  for (let skip = 0; skip < 5000; skip += 100) {
    const j = await e2(entity, `/occurrences/reporter/original-report/search?&$skip=${skip}&$top=100`, { method: "POST", body: { status, reportedByMe: false } });
    const el = ((j.data as { elements?: E2Report[] } | null)?.elements ?? []); out.push(...el); if (el.length < 100) break;
  }
  return out;
}
/** Selected attributes of one report, e.g. ["24.ATTRIBUTES.438"] (report identification), as taxonomy codes. */
export const reportFields = (entity: string, e2Id: string, fields: string[]) => e2(entity, `/occurrences/fields/${encodeURIComponent(e2Id)}`, { method: "POST", body: fields });

/** v1.2 · the autofilled attributes of the organisation (connection check without touching any report). */
export const autofilledAttributes = (entity: string) => e2(entity, "/usermgmt/autofilled-attributes?taxonomyReferenceId=1");
/** The released taxonomy of the authority (ECCAIRS Aviation 5.1.0.0 in the general case). */
export const taxonomyVersion = (entity: string) => e2(entity, "/taxonomy-service/released-taxonomy");

/* ---------- ECC-01 · original reports: create / edit / status / read ---------- */
export type TaxonomyCodes = { "24": { ATTRIBUTES?: Record<string, unknown[]>; ENTITIES?: Record<string, { ID: string; ATTRIBUTES?: Record<string, unknown[]>; ENTITIES?: Record<string, unknown[]>; LINKS?: Record<string, string[]> }[]> } };
export type E2Created = { e2Id: string; status: string; version: string; orInitialDate?: string };
/** POST occurrences/create — a new original report, SENT (default of E2) or DRAFT. The caller decides; nothing is sent without it. */
export async function createOccurrence(entity: string, taxonomyCodes: TaxonomyCodes, status: "DRAFT" | "SENT"): Promise<E2Created> {
  const j = await e2(entity, "/occurrences/create", { method: "POST", body: { type: "REPORT", status, taxonomyCodes } });
  return j.data as E2Created;
}
/** PUT occurrences/edit — only the attributes given change; the rest stays in E2. versionType MINOR keeps a SENT report sent. */
export async function editOccurrence(entity: string, e2Id: string, taxonomyCodes: TaxonomyCodes, versionType: "DRAFT" | "MINOR" = "MINOR"): Promise<E2Created> {
  const j = await e2(entity, "/occurrences/edit", { method: "PUT", body: { e2Id, versionType, taxonomyCodes } });
  return j.data as E2Created;
}
/** POST occurrences/change-status — DRAFT → SENT (the report reaches the authority) or back. */
export async function changeOccurrenceStatus(entity: string, e2Id: string, status: "DRAFT" | "SENT"): Promise<E2Created> {
  const j = await e2(entity, "/occurrences/change-status", { method: "POST", body: { e2Id, status, versionType: "MINOR" } });
  return j.data as E2Created;
}
export const occurrenceExists = async (entity: string, e2Id: string) => (await e2(entity, `/occurrences/exists/${encodeURIComponent(e2Id)}`)).data;
export const getOccurrence = async (entity: string, e2Id: string) => (await e2(entity, `/occurrences/get/${encodeURIComponent(e2Id)}`)).data;

/* ---------- ECC-01 · taxonomy cache (the authority's released taxonomy, read through the API) ---------- */
/** The entities S.A.M. fills and the attributes it reads the lists of (ECCAIRS Aviation 5.1 codes, ECG chapter 2 / DGAC guide). */
export const E2_ENTITIES = { OCCURRENCE: 24, AIRCRAFT: 4, AERODROME: 1, EVENTS: 14, NARRATIVE: 22, REPORTER_TEXT: 53 } as const;
export const E2_ATTR = {
  REPORT_ID: 452, HEADLINE: 601, UTC_DATE: 477, LOCAL_DATE: 433, LOCATION: 440, STATE: 454, OCC_CLASS: 431, OCC_CATEGORY: 430,
  NARRATIVE_LANG: 424, NARRATIVE: 425, REPORTER_LANG: 1091, REPORTER_TEXT: 1092, REPORTING_ENTITY: 447, REPORT_STATUS: 800,
  DAMAGE: 432, INJURY: 451, WEATHER_RELEVANT: 606, AVIATION_SECTOR: 1088, ATTACHMENTS: 793, DETECTION: 746,
  AC_REGISTRATION: 244, AC_TYPE: 21, AC_MSN: 254, AC_CALLSIGN: 54, AC_OPERATOR: 215, AC_OPERATION_TYPE: 214, AC_CATEGORY: 32, AC_STATE_OF_REGISTRY: 281,
  AC_LAST_DEPARTURE: 167, AC_DESTINATION: 228, AC_FLIGHT_PHASE: 121, AD_INDICATOR: 5, AD_LOCATION: 641, EVENT_TYPE: 390,
} as const;
/** How E2 expects each value in the JSON (API guide §8.3, "ECCAIRS-DataTypes"): most values are bare (ids, strings, dates);
 * a value-list "with additional text" travels as { content: [id], AdditionalText }, a memo as { text }. Learnt from the sandbox's answers. */
export const E2_SHAPE: Record<number, "content" | "text" | "encoded"> = { 454: "content", 21: "content", 425: "text", 1092: "text" };
/** Attributes whose value lists S.A.M. caches (the long lists — aircraft types, aerodromes — are read on demand instead). */
export const E2_LISTS_TO_CACHE: { entity: number; attributes: number[] }[] = [
  { entity: 24, attributes: [E2_ATTR.STATE, E2_ATTR.OCC_CLASS, E2_ATTR.OCC_CATEGORY, E2_ATTR.DAMAGE, E2_ATTR.INJURY, E2_ATTR.WEATHER_RELEVANT, E2_ATTR.AVIATION_SECTOR, E2_ATTR.DETECTION, E2_ATTR.REPORT_STATUS] },
  { entity: 4, attributes: [E2_ATTR.AC_OPERATION_TYPE, E2_ATTR.AC_CATEGORY, E2_ATTR.AC_STATE_OF_REGISTRY, E2_ATTR.AC_FLIGHT_PHASE, E2_ATTR.WEATHER_RELEVANT] },
  { entity: 14, attributes: [E2_ATTR.EVENT_TYPE] },
  { entity: 1, attributes: [E2_ATTR.AD_LOCATION] },
  { entity: 22, attributes: [E2_ATTR.NARRATIVE_LANG] },
  { entity: 53, attributes: [E2_ATTR.REPORTER_LANG] },
];
type TaxAttr = { taxonomyCode: number; description: string; detailed?: string; explanation?: string; minInstance?: number | string | null; maxInstance?: number | string | null; attributeDataType?: { name?: string } | string | null; dataType?: { name?: string } | string | null; valueList?: { id?: number } | null; attributeValueListId?: number | null; valueListId?: number | null };
type TaxEntity = { taxonomyCode: number; description: string; attributesList?: { childrenAttributes?: TaxAttr[] } };
const dtName = (a: TaxAttr) => { const d = a.attributeDataType ?? a.dataType; return typeof d === "string" ? d : d?.name ?? null; };
const vlId = (a: TaxAttr) => a.valueList?.id ?? a.attributeValueListId ?? a.valueListId ?? null;

/** Reads the released taxonomy of the entity's authority: the entities we fill with all their attributes, then the value lists we need.
 *  Idempotent; a few dozen API calls (Fixie free plan: 500 / month — run it when the taxonomy changes, not every day). */
export async function loadTaxonomy(db: SupabaseClient, entity: string): Promise<{ taxonomyId: number; name: string; version: string; attributes: number; values: number }> {
  const tv = (await taxonomyVersion(entity)).data as { id: number; name: string; version: string }[] | { id: number; name: string; version: string };
  const t = Array.isArray(tv) ? tv[0] : tv; if (!t?.id) throw new Error("ECCAIRS returned no released taxonomy.");
  let nA = 0, nV = 0; const lists = new Map<number, number>(); // value list id → first attribute (for the log)
  for (const ent of [E2_ENTITIES.OCCURRENCE, E2_ENTITIES.AIRCRAFT, E2_ENTITIES.AERODROME, E2_ENTITIES.EVENTS, E2_ENTITIES.NARRATIVE, E2_ENTITIES.REPORTER_TEXT]) {
    const j = await e2(entity, `/taxonomy-service/external/entity/${ent}?taxonomyId=${t.id}`);
    const en = j.data as TaxEntity | null; const attrs = en?.attributesList?.childrenAttributes ?? [];
    for (const a of attrs) {
      const vl = vlId(a);
      const { error } = await db.from("eccairs_attributes").upsert({ taxonomy_id: t.id, entity_code: ent, attribute_code: a.taxonomyCode, description: a.description ?? a.detailed ?? String(a.taxonomyCode), explanation: a.explanation ?? null, data_type: dtName(a), value_list_id: vl, min_instance: a.minInstance == null ? null : String(a.minInstance), max_instance: a.maxInstance == null ? null : String(a.maxInstance), loaded_at: new Date().toISOString() }, { onConflict: "taxonomy_id,entity_code,attribute_code" });
      if (error) throw new Error(`eccairs_attributes ${ent}.${a.taxonomyCode}: ${error.message}`);
      nA++;
      const wanted = E2_LISTS_TO_CACHE.find((x) => x.entity === ent)?.attributes.includes(a.taxonomyCode);
      if (vl && wanted && !lists.has(vl)) lists.set(vl, a.taxonomyCode);
    }
  }
  for (const [vl] of lists) {
    const j = await e2(entity, `/taxonomy-service/external/value-lists/${vl}?taxonomyId=${t.id}`);
    // 9.0.0.2 (sandbox, 09/11/2026): the values come as `listOfValues`; older servers used `valueListModels`
    type VLV = { identifier?: number; valueId?: number; id?: number; description?: string; detailed?: string; parent?: number | null; parentIdentifier?: number | null; level?: number | null; active?: boolean | number | null };
    const d = j.data as { listOfValues?: VLV[]; valueListModels?: VLV[] } | null;
    const rows = (d?.listOfValues ?? d?.valueListModels ?? []).map((v) => ({ taxonomy_id: t.id, value_list_id: vl, value_id: v.identifier ?? v.valueId ?? v.id ?? 0, description: v.description ?? v.detailed ?? String(v.identifier ?? v.id), detailed: v.detailed ?? null, parent: v.parent ?? v.parentIdentifier ?? null, level: v.level ?? null, active: v.active !== false && v.active !== 0 })).filter((r) => r.value_id);
    for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from("eccairs_values").upsert(rows.slice(i, i + 500), { onConflict: "taxonomy_id,value_list_id,value_id" }); if (error) throw new Error(`eccairs_values list ${vl}: ${error.message}`); }
    nV += rows.length;
  }
  await db.from("eccairs_taxonomies").upsert({ entity, taxonomy_id: t.id, name: t.name, version: t.version, env: eccairsEnv(entity), loaded_at: new Date().toISOString(), attributes: nA, values: nV }, { onConflict: "entity" });
  return { taxonomyId: t.id, name: t.name, version: t.version, attributes: nA, values: nV };
}
