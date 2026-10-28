// TMS-01 · Teams bot "S.A.M." — Bot Framework over plain HTTPS (no SDK): token, JWT check of incoming activities,
// proactive cards in the personal chat, conversation references, Adaptive Cards with Universal Actions (Action.Execute).
// Vercel: TEAMS_APP_ID (id of the S.A.M. app in the Teams catalog, for proactive installation), GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
// (the Azure Bot uses the S.A.M. app registration), optional TEAMS_SERVICE_URL (default EMEA).
import { createPublicKey, verify as cryptoVerify } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_ID, TENANT_ID } from "@/lib/msgraph-user";
import { basePost } from "@/lib/session";

export const SERVICE_URL = (process.env.TEAMS_SERVICE_URL ?? "https://smba.trafficmanager.net/emea/").replace(/\/?$/, "/");
export const teamsConfigured = () => !!process.env.GRAPH_CLIENT_SECRET;
/** Catalog id of the S.A.M. app in the Clair Group tenant (published by IT on 28/10/2026); TEAMS_APP_ID overrides it. Not a secret. */
export const TEAMS_APP_ID = process.env.TEAMS_APP_ID?.trim() || "a8d6b7eb-5ad8-4f65-ae1a-5fe8b7c0f1b3";
/** RSC permissions declared in teams/manifest.json — keep both in sync. */
export const RSC_PERMISSIONS = ["ChannelMessage.Read.Group", "ChatMessage.Read.Chat"] as const;
export const teamsInstallConfigured = () => teamsConfigured() && !!TEAMS_APP_ID;

/* ---------- tokens ---------- */
let botTok: { v: string; exp: number } | null = null;
async function clientToken(scope: string): Promise<string> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: process.env.GRAPH_CLIENT_SECRET!.trim(), scope, grant_type: "client_credentials" });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(j.error_description?.split("\n")[0] ?? `token HTTP ${r.status}`);
  return j.access_token;
}
export async function botToken(): Promise<string> {
  if (botTok && botTok.exp > Date.now() + 60_000) return botTok.v;
  const v = await clientToken("https://api.botframework.com/.default");
  botTok = { v, exp: Date.now() + 50 * 60_000 };
  return v;
}
const graphToken = () => clientToken("https://graph.microsoft.com/.default");

/* ---------- incoming JWT (Bot Framework → our endpoint) ---------- */
type Jwk = { kid: string; kty: string; n: string; e: string; x5c?: string[] };
// Two possible issuers: the Bot Framework service (multi-tenant bots) or Entra ID of our tenant (Single Tenant bots, which is what IT created).
const ISSUERS: Record<string, string> = {
  "https://api.botframework.com": "https://login.botframework.com/v1/.well-known/openidconfiguration",
  [`https://login.microsoftonline.com/${TENANT_ID}/v2.0`]: `https://login.microsoftonline.com/${TENANT_ID}/v2.0/.well-known/openid-configuration`,
  [`https://sts.windows.net/${TENANT_ID}/`]: `https://login.microsoftonline.com/${TENANT_ID}/.well-known/openid-configuration`,
};
const jwksByIssuer = new Map<string, { keys: Jwk[]; at: number }>();
async function keys(issuer: string, fresh = false): Promise<Jwk[]> {
  const have = jwksByIssuer.get(issuer);
  if (!fresh && have && Date.now() - have.at < 12 * 3600_000) return have.keys;
  const cfg = (await (await fetch(ISSUERS[issuer])).json()) as { jwks_uri: string };
  const j = (await (await fetch(cfg.jwks_uri)).json()) as { keys: Jwk[] };
  jwksByIssuer.set(issuer, { keys: j.keys, at: Date.now() });
  return j.keys;
}
const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
/** True when the Authorization header is a valid token for this bot: known issuer, audience = our app id, not expired, signature. */
export async function verifyBotJwt(authorization: string | null): Promise<{ ok: boolean; reason?: string }> {
  try {
    const t = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const [h, p, sig] = t.split(".");
    if (!h || !p || !sig) return { ok: false, reason: "no token" };
    const header = JSON.parse(b64(h).toString("utf8")) as { alg: string; kid: string };
    const payload = JSON.parse(b64(p).toString("utf8")) as { iss: string; aud: string; exp: number; serviceurl?: string };
    if (header.alg !== "RS256") return { ok: false, reason: "alg" };
    if (!ISSUERS[payload.iss]) return { ok: false, reason: `issuer ${payload.iss}` };
    if (payload.aud !== CLIENT_ID && payload.aud !== `api://${CLIENT_ID}`) return { ok: false, reason: "audience" };
    if (payload.exp * 1000 < Date.now() - 5 * 60_000) return { ok: false, reason: "expired" };
    let k = (await keys(payload.iss)).find((x) => x.kid === header.kid);
    if (!k) k = (await keys(payload.iss, true)).find((x) => x.kid === header.kid);
    if (!k) return { ok: false, reason: "key" };
    const pub = createPublicKey({ key: { kty: k.kty, n: k.n, e: k.e }, format: "jwk" });
    const good = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), pub, b64(sig));
    return good ? { ok: true } : { ok: false, reason: "signature" };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
}

/* ---------- Bot Connector REST ---------- */
export type ConvRef = { conversation_id: string; service_url: string };
async function connector(ref: ConvRef, method: "POST" | "PUT", path: string, body: unknown): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await fetch(`${ref.service_url.replace(/\/?$/, "/")}v3/conversations/${encodeURIComponent(ref.conversation_id)}/activities${path}`, {
      method, headers: { authorization: `Bearer ${await botToken()}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!r.ok) return { ok: false, error: j.error?.message ?? `connector HTTP ${r.status}` };
    return { ok: true, id: j.id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
export const sendCard = (ref: ConvRef, card: unknown, summary = "S.A.M.") => connector(ref, "POST", "", { type: "message", summary, attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] });
export const updateCard = (ref: ConvRef, activityId: string, card: unknown, summary = "S.A.M.") => connector(ref, "PUT", `/${encodeURIComponent(activityId)}`, { type: "message", id: activityId, summary, attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] });
export const sendText = (ref: ConvRef, text: string) => connector(ref, "POST", "", { type: "message", text, textFormat: "markdown" });
/** Members of a conversation (email, aadObjectId) — what lets us match a Teams user to a person without Graph. */
export async function members(ref: ConvRef): Promise<{ id: string; aadObjectId?: string; email?: string; userPrincipalName?: string; name?: string }[]> {
  const r = await fetch(`${ref.service_url.replace(/\/?$/, "/")}v3/conversations/${encodeURIComponent(ref.conversation_id)}/members`, { headers: { authorization: `Bearer ${await botToken()}` } });
  return r.ok ? ((await r.json()) as { id: string; aadObjectId?: string; email?: string; userPrincipalName?: string; name?: string }[]) : [];
}

/* ---------- conversation references ---------- */
export type TeamsConv = { person_id: string; teams_user_id: string | null; aad_object_id: string | null; conversation_id: string; service_url: string; tenant_id: string | null };
export async function conversationOf(db: SupabaseClient, personId: string): Promise<TeamsConv | null> {
  const { data } = await db.from("teams_conversations").select("*").eq("person_id", personId).maybeSingle();
  return (data as TeamsConv | null) ?? null;
}
/** Person for a Teams user: by Entra object id, else by the e-mail the conversation members carry (and the oid is then kept). */
export async function personFor(db: SupabaseClient, from: { id?: string; aadObjectId?: string }, ref: ConvRef, tenantId?: string, installedBy = "user"): Promise<{ id: string; display_name: string; roles: string[]; email: string | null } | null> {
  type P = { id: string; display_name: string; roles: string[]; email: string | null };
  let p: P | null = null;
  if (from.aadObjectId) { const { data } = await db.from("people").select("id,display_name,roles,email").eq("entra_oid", from.aadObjectId).maybeSingle(); p = (data as P | null) ?? null; }
  if (!p) {
    const ms = await members(ref);
    const me = ms.find((m) => (from.aadObjectId && m.aadObjectId === from.aadObjectId) || (from.id && m.id === from.id)) ?? (ms.length === 1 ? ms[0] : undefined);
    const mail = me?.email ?? me?.userPrincipalName;
    if (mail) { const { data } = await db.from("people").select("id,display_name,roles,email").ilike("email", mail).maybeSingle(); p = (data as P | null) ?? null; }
    if (p && from.aadObjectId) await db.from("people").update({ entra_oid: from.aadObjectId }).eq("id", p.id).is("entra_oid", null);
  }
  if (p) await db.from("teams_conversations").upsert({ person_id: p.id, teams_user_id: from.id ?? null, aad_object_id: from.aadObjectId ?? null, conversation_id: ref.conversation_id, service_url: ref.service_url, tenant_id: tenantId ?? null, installed_by: installedBy, updated_at: new Date().toISOString() }, { onConflict: "person_id" });
  return p;
}
/** Opens the personal chat with the bot for a person who never opened it: installs the S.A.M. app for them through Graph
 *  (TeamsAppInstallation.ReadWriteAndConsentSelfForUser.All, because the manifest declares RSC permissions). `lastInstallError` keeps the reason of the last failure for Settings › Integrations. */
export let lastInstallError: string | null = null;
export async function ensureConversation(db: SupabaseClient, person: { id: string; email: string | null }): Promise<TeamsConv | null> {
  const have = await conversationOf(db, person.id);
  if (have) return have;
  lastInstallError = null;
  if (!teamsInstallConfigured()) { lastInstallError = "TEAMS_APP_ID / GRAPH_CLIENT_SECRET missing"; return null; }
  if (!person.email) { lastInstallError = "the person has no e-mail in S.A.M."; return null; }
  const fail = (step: string, r: Response, body: string) => { lastInstallError = `${step}: HTTP ${r.status} ${body.slice(0, 300)}`; return null; };
  try {
    const t = await graphToken();
    const H = { authorization: `Bearer ${t}`, "content-type": "application/json" };
    const u = encodeURIComponent(person.email);
    const appId = TEAMS_APP_ID;
    // The manifest declares RSC permissions (ChannelMessage.Read.Group, ChatMessage.Read.Chat — iteration 2), so Graph requires
    // the caller to consent to them at install time: permission TeamsAppInstallation.ReadWriteAndConsentSelfForUser.All + consentedPermissionSet.
    const body = {
      "teamsApp@odata.bind": `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${appId}`,
      consentedPermissionSet: { resourceSpecificPermissions: RSC_PERMISSIONS.map((permissionValue) => ({ permissionValue, permissionType: "application" })) },
    };
    const inst = await fetch(`https://graph.microsoft.com/v1.0/users/${u}/teamwork/installedApps`, { method: "POST", headers: H, body: JSON.stringify(body) });
    if (!inst.ok && inst.status !== 409) {
      // which application permissions the token actually carries (Entra consent is visible here, not in the portal)
      let roles = "?"; try { roles = (JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()) as { roles?: string[] }).roles?.join(", ") || "none"; } catch { /* keep ? */ }
      return fail(`install (token roles: ${roles})`, inst, await inst.text());
    }
    const lr = await fetch(`https://graph.microsoft.com/v1.0/users/${u}/teamwork/installedApps?$expand=teamsApp&$filter=teamsApp/id eq '${appId}'`, { headers: H });
    if (!lr.ok) return fail("list", lr, await lr.text());
    const list = (await lr.json()) as { value?: { id: string }[] };
    const instId = list.value?.[0]?.id;
    if (!instId) { lastInstallError = `list: app ${appId} not installed for ${person.email} (empty result)`; return null; }
    // The chat id: either Graph gives it (needs a ReadWriteSelfForUser-class role, which the AndConsent variant does not carry for this
    // endpoint), or the bot has just received the conversationUpdate that Teams sends on installation and stored it — poll for it.
    const cr = await fetch(`https://graph.microsoft.com/v1.0/users/${u}/teamwork/installedApps/${instId}/chat`, { headers: H });
    if (cr.ok) {
      const chat = (await cr.json()) as { id?: string };
      if (chat.id) {
        const row: TeamsConv = { person_id: person.id, teams_user_id: null, aad_object_id: null, conversation_id: chat.id, service_url: SERVICE_URL, tenant_id: TENANT_ID };
        await db.from("teams_conversations").upsert({ ...row, installed_by: "graph", updated_at: new Date().toISOString() }, { onConflict: "person_id" });
        return row;
      }
    }
    const chatErr = cr.ok ? "chat: no id in the answer" : `chat: HTTP ${cr.status} ${(await cr.text()).slice(0, 200)}`;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await conversationOf(db, person.id);
      if (got) return got;
    }
    lastInstallError = `${inst.status === 409 ? "app already installed" : "app installed"}, but the bot received no conversationUpdate within 12 s (${chatErr}). Open the S.A.M. app once in Teams, or retry.`;
    return null;
  } catch (e) { lastInstallError = `exception: ${e instanceof Error ? e.message : String(e)}`; return null; }
}

/* ---------- cards ---------- */
export type TaskRow = { id: string; title: string; detail: string | null; due: string | null; entity: string; kind: string; status: string; link: string | null; owner_person: string | null; owner_role: string | null; teams?: { conversation_id: string; service_url: string; activity_id: string } | null; answer?: string | null; answered_via?: string | null };
const KIND_LABEL: Record<string, string> = { authority: "Authority file", authority_followup: "Authority follow-up", reading: "Read & acknowledge", certificate_validity: "Validity", finding: "Finding", action: "Action", signature: "Signature", project: "Project", risk_acceptance: "Risk acceptance", risk_review: "Risk review", status_review: "Status review" };
const fr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
export function origin(): string { return (process.env.SAM_ORIGIN ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://sam-jet-sigma.vercel.app")).replace(/\/$/, ""); }

/** The card of one task: what it is, when, buttons Done / Not yet (+ comment) / Open in S.A.M. Once answered, the same card shows the answer and no button. */
export function taskCard(t: TaskRow, state?: { answered: "done" | "not_yet"; by: string; at: string; comment?: string | null }): unknown {
  const kind = KIND_LABEL[t.kind] ?? t.kind.replace(/_/g, " ");
  const url = t.link ? `${origin()}${t.link}` : origin();
  const body: unknown[] = [
    { type: "TextBlock", text: `${t.entity} · ${kind}`, size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: t.title, size: "Medium", weight: "Bolder", wrap: true },
  ];
  if (t.detail) body.push({ type: "TextBlock", text: t.detail, wrap: true, spacing: "Small" });
  const facts: { title: string; value: string }[] = [];
  if (t.due) facts.push({ title: "Due", value: fr(t.due) });
  if (t.owner_role && !t.owner_person) facts.push({ title: "For", value: t.owner_role });
  if (facts.length) body.push({ type: "FactSet", facts, spacing: "Small" });
  const actions: unknown[] = [];
  if (state) {
    body.push({ type: "TextBlock", text: `${state.answered === "done" ? "✓ Done" : "Not yet"} — ${state.by}, ${state.at}${state.comment ? ` · “${state.comment}”` : ""}`, wrap: true, color: state.answered === "done" ? "Good" : "Attention", weight: "Bolder", spacing: "Medium" });
  } else {
    body.push({ type: "Input.Text", id: "comment", placeholder: "Comment (optional — required for Not yet)", isMultiline: true, spacing: "Medium" });
    actions.push({ type: "Action.Execute", title: "Done", verb: "task_done", data: { taskId: t.id }, style: "positive" }, { type: "Action.Execute", title: "Not yet", verb: "task_not_yet", data: { taskId: t.id } });
  }
  actions.push({ type: "Action.OpenUrl", title: "Open in S.A.M.", url });
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, actions, msteams: { width: "Full" } };
}
export function infoCard(title: string, text: string, link?: string): unknown {
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: "S.A.M.", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" }, { type: "TextBlock", text: title, size: "Medium", weight: "Bolder", wrap: true }, { type: "TextBlock", text, wrap: true }], actions: link ? [{ type: "Action.OpenUrl", title: "Open in S.A.M.", url: `${origin()}${link}` }] : [] };
}

/* ---------- who gets a task ---------- */
type Person = { id: string; display_name: string; roles: string[]; email: string | null; entities: string[]; is_group_function: boolean };
/** People a task is addressed to: the named person, or the holders (and deputies) of the post in the task's entity. */
export async function recipientsOf(db: SupabaseClient, t: Pick<TaskRow, "owner_person" | "owner_role" | "entity">): Promise<Person[]> {
  if (t.owner_person) { const { data } = await db.from("people").select("id,display_name,roles,email,entities,is_group_function").eq("id", t.owner_person).maybeSingle(); return data ? [data as Person] : []; }
  if (!t.owner_role) return [];
  const { data } = await db.from("people").select("id,display_name,roles,email,entities,is_group_function").limit(500);
  const post = basePost(t.owner_role);
  return ((data ?? []) as Person[]).filter((p) => (p.is_group_function || p.entities.includes(t.entity)) && p.roles.some((r) => basePost(r) === post));
}

/** Sends the card of each task to its recipients (best effort, never throws); the first delivery is kept on the task for later updates. */
export async function notifyTasks(db: SupabaseClient, tasks: TaskRow[]): Promise<number> {
  if (!teamsConfigured()) return 0;
  let n = 0;
  for (const t of tasks) {
    try {
      const people = await recipientsOf(db, t);
      let first: { conversation_id: string; service_url: string; activity_id: string } | null = null;
      for (const p of people) {
        const conv = await ensureConversation(db, p);
        if (!conv) continue;
        const r = await sendCard(conv, taskCard(t), t.title);
        if (r.ok && r.id) { n++; if (!first) first = { conversation_id: conv.conversation_id, service_url: conv.service_url, activity_id: r.id }; }
      }
      if (first) await db.from("tasks").update({ teams: first }).eq("id", t.id);
    } catch { /* Teams is a channel, never a blocker */ }
  }
  return n;
}
/** Convenience for callers that just inserted rows: fetch what was inserted and notify. */
export async function notifyTasksByRef(db: SupabaseClient, refId: string): Promise<void> {
  const { data } = await db.from("tasks").select("*").eq("ref_id", refId).eq("status", "open").is("teams", null);
  if (data?.length) await notifyTasks(db, data as TaskRow[]);
}
