// ECCAIRS 2 M2M API (EASA "E2 API Guide for Organisations" v1.1, 01/09/2025 — received from TM-CAD on 30/03/2026).
// OAuth 2.1 client credentials: POST {BASE}/idp/oauth2/token (client_id = M2M user, client_secret = its password) → Bearer, 1 h.
// The calling IP must be whitelisted by EASA: calls go through the fixed-IP proxy (lib/proxy-fetch, FIXIE_URL). Phases: sandbox → UAT (regulator checks) → production, one M2M user each.
// Methods used by S.A.M.: occurrences/create (taxonomy-code JSON) · occurrences/edit · occurrences/change-status ·
// occurrences/reporter/original-report/search (all reports of the organisation) · occurrences/fields/{e2Id} · frontfile-api/files/migrate (E5X).
import { proxyFetch } from "@/lib/proxy-fetch";
type Cfg = { base: string; id: string; secret: string };
const cache = new Map<string, { token: string; until: number }>();

/** Per entity: ECCAIRS_BASE_URL (sandbox / UAT / production) + ECCAIRS_<ENT>_CLIENT_ID / ECCAIRS_<ENT>_CLIENT_SECRET. */
export function eccairsConfig(entity: string): Cfg | null {
  const base = process.env[`ECCAIRS_${entity}_BASE_URL`] ?? process.env.ECCAIRS_BASE_URL; const id = process.env[`ECCAIRS_${entity}_CLIENT_ID`]; const secret = process.env[`ECCAIRS_${entity}_CLIENT_SECRET`];
  return base && id && secret ? { base: base.replace(/\/$/, ""), id, secret } : null;
}
export const eccairsEnv = (entity: string) => { const b = process.env[`ECCAIRS_${entity}_BASE_URL`] ?? process.env.ECCAIRS_BASE_URL ?? ""; return /sandbox/i.test(b) ? "sandbox" : /uat|test/i.test(b) ? "UAT" : b ? "production" : null; };

async function token(entity: string, c: Cfg): Promise<string> {
  const k = `${entity}:${c.base}`; const hit = cache.get(k); if (hit && hit.until > Date.now() + 60e3) return hit.token;
  const r = await proxyFetch(`${c.base}/idp/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret, scope: "openid" }).toString() });
  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!r.ok || !j?.access_token) throw new Error(`ECCAIRS token refused (${r.status}) — check the M2M user and that the IP is whitelisted by EASA.`);
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
