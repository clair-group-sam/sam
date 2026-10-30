// ECCAIRS 2 M2M API (EASA "E2 API Guide for Organisations" v1.2 — received from E2 Support on 30/10/2026; v1.1 from TM-CAD on 30/03/2026).
// Base URLs: sandbox / UAT https://api.uat.aviationreporting.eu (portal e2.uat.aviationreporting.eu) · production https://api.aviationreporting.eu.
// v1.2: login on the Spring Boot 3 authorization server (same endpoint) · new usermgmt/autofilled-attributes.
// OAuth 2.1 client credentials: POST {BASE}/idp/oauth2/token (client_id = M2M user, client_secret = its password) → Bearer, 1 h.
// The calling IP must be whitelisted by EASA: calls go through the fixed-IP proxy (lib/proxy-fetch, FIXIE_URL). Phases: sandbox → UAT (regulator checks) → production, one M2M user each.
// Methods used by S.A.M.: occurrences/create (taxonomy-code JSON) · occurrences/edit · occurrences/change-status ·
// occurrences/reporter/original-report/search (all reports of the organisation) · occurrences/fields/{e2Id} · frontfile-api/files/migrate (E5X).
import { proxyFetch } from "@/lib/proxy-fetch";
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
  // v1.2: client_id / client_secret in the body (client_secret_post); some servers want them as HTTP Basic (client_secret_basic) — try both.
  let r = await proxyFetch(url, { method: "POST", headers: { "content-type": form }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret, scope: "openid" }).toString() });
  if (r.status === 401 || r.status === 400) {
    const basic = Buffer.from(`${encodeURIComponent(c.id)}:${encodeURIComponent(c.secret)}`).toString("base64");
    const r2 = await proxyFetch(url, { method: "POST", headers: { "content-type": form, authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "client_credentials", scope: "openid" }).toString() });
    if (r2.ok || r2.status !== 401) r = r2;
  }
  const raw = await r.text(); let j: { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null = null; try { j = JSON.parse(raw); } catch { /* not JSON */ }
  if (!r.ok || !j?.access_token) throw new Error(`ECCAIRS token refused (${r.status}${j?.error ? ` ${j.error}` : ""}${j?.error_description ? `: ${j.error_description}` : ""}) — check the M2M user (activated, password) and that the IP is whitelisted by EASA.`.slice(0, 300));
  cache.set(k, { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 }); return j.access_token;
}
type E2 = { data?: unknown; errorDetails?: string; returnCode?: number };
export async function e2(entity: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<E2> {
  const c = eccairsConfig(entity); if (!c) throw new Error(`ECCAIRS is not configured for ${entity}.`);
  const r = await proxyFetch(`${c.base}${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${await token(entity, c)}`, "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const j = (await r.json().catch(() => null)) as E2 | null;
  if (!r.ok || !j) throw new Error(`ECCAIRS ${path} → ${r.status}`);
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
/** Selected attributes of one report, e.g. ["24.ATTRIBUTES.452"] (report identification), as taxonomy codes. */
export const reportFields = (entity: string, e2Id: string, fields: string[]) => e2(entity, `/occurrences/fields/${encodeURIComponent(e2Id)}`, { method: "POST", body: fields });

/** v1.2 · the autofilled attributes of the organisation (connection check without touching any report). */
export const autofilledAttributes = (entity: string) => e2(entity, "/usermgmt/autofilled-attributes?taxonomyReferenceId=1");
/** The released taxonomy of the authority (ECCAIRS Aviation 5.1.0.0 in the general case). */
export const taxonomyVersion = (entity: string) => e2(entity, "/taxonomy-service/released-taxonomy");
