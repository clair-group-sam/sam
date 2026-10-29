// Leon (ASJMT + ASJFR, one Leon account): read-only GraphQL API. Key = refresh token (Leon › Settings › API keys), server side only.
// https://apidoc.leonsoftware.com/authentication/ApiKey/ — POST /access_token/refresh/ → access token (30 min), then Bearer on /api/graphql/.
let cached: { token: string; until: number } | null = null;

const base = () => { const op = process.env.LEON_OPERATOR; if (!op || !/^[a-z0-9-]+$/i.test(op)) throw new Error("LEON_OPERATOR is not set."); return `https://${op}.leon.aero`; };

export const leonConfigured = () => !!process.env.LEON_REFRESH_TOKEN && !!process.env.LEON_OPERATOR;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60e3) return cached.token;
  const rt = process.env.LEON_REFRESH_TOKEN; if (!rt) throw new Error("LEON_REFRESH_TOKEN is not set.");
  const r = await fetch(`${base()}/access_token/refresh/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: rt }).toString(), cache: "no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(`Leon token refused (${r.status}).`);
  let token = text.trim();
  try { const j = JSON.parse(text) as Record<string, unknown>; token = String(j.access_token ?? j.accessToken ?? j.token ?? ""); } catch { /* plain text token */ }
  if (!token || token.length < 20) throw new Error("Leon returned no access token.");
  cached = { token, until: Date.now() + 25 * 60e3 };
  return token;
}

export async function leonGql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${base()}/api/graphql/`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` }, body: JSON.stringify({ query, variables }), cache: "no-store" });
  const j = (await r.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!r.ok || !j) throw new Error(`Leon API error (${r.status}).`);
  if (j.errors?.length && !j.data) throw new Error(`Leon: ${j.errors.map((e) => e.message).join("; ").slice(0, 400)}`);
  return j.data as T;
}

/** Field names and types of a GraphQL type (to map the journey log without guessing). */
export async function leonType(name: string) {
  const d = await leonGql<{ __type: { name: string; kind: string; fields: { name: string; type: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType: { name: string | null } | null } | null } }[] | null; inputFields: { name: string; type: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType: { name: string | null } | null } | null } }[] | null } | null }>(
    `query($n: String!) { __type(name: $n) { name kind fields { name type { name kind ofType { name kind ofType { name } } } } inputFields { name type { name kind ofType { name kind ofType { name } } } } } }`, { n: name });
  const t = d.__type; if (!t) return null;
  const tn = (x: { name: string | null; kind: string; ofType?: { name: string | null; kind?: string; ofType?: { name: string | null } | null } | null }) => x.name ?? x.ofType?.name ?? x.ofType?.ofType?.name ?? x.kind;
  return { name: t.name, kind: t.kind, fields: (t.fields ?? t.inputFields ?? []).map((f) => `${f.name}: ${tn(f.type as never)}${f.type.kind === "LIST" || f.type.ofType?.kind === "LIST" ? "[]" : ""}`) };
}

/** ASJMT = Maltese register (9H-), ASJFR = French register (F-). */
export const entityOfRegistration = (reg: string | null | undefined) => (!reg ? null : /^9H/i.test(reg.replace(/\s/g, "")) ? "ASJMT" : /^F/i.test(reg.replace(/\s/g, "")) ? "ASJFR" : null);
