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
export const graphToken = () => clientToken("https://graph.microsoft.com/.default");

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
/** Personal chats are "a:…" or "19:…@unq.gbl.spaces"; group chats end with @thread.v2, channels with @thread.tacv2 (+ ";messageid=…"). */
export const isPersonalConversation = (id: string) => !/@thread\.(v2|tacv2|skype)/i.test(id);
export async function conversationOf(db: SupabaseClient, personId: string): Promise<TeamsConv | null> {
  const { data } = await db.from("teams_conversations").select("*").eq("person_id", personId).maybeSingle();
  const c = (data as TeamsConv | null) ?? null;
  if (c && !isPersonalConversation(c.conversation_id)) { await db.from("teams_conversations").delete().eq("person_id", personId); return null; } // a group chat slipped in: forget it
  return c;
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
  // only a PERSONAL chat is kept as the person's conversation (a group chat or a channel must never receive their cards)
  if (p && isPersonalConversation(ref.conversation_id)) await db.from("teams_conversations").upsert({ person_id: p.id, teams_user_id: from.id ?? null, aad_object_id: from.aadObjectId ?? null, conversation_id: ref.conversation_id, service_url: ref.service_url, tenant_id: tenantId ?? null, installed_by: installedBy, updated_at: new Date().toISOString() }, { onConflict: "person_id" });
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
export type TaskRow = { id: string; title: string; detail: string | null; due: string | null; entity: string; kind: string; status: string; link: string | null; owner_person: string | null; owner_role: string | null; ref_id?: string | null; created_at?: string; teams?: { conversation_id: string; service_url: string; activity_id: string } | null; answer?: string | null; answered_via?: string | null; answered_at?: string | null; teams_notified_at?: string | null };
const KIND_LABEL: Record<string, string> = { authority: "CAA application", authority_followup: "Authority follow-up", reading: "Read & acknowledge", certificate_validity: "Validity", finding: "Finding", action: "Action", action_verify: "Verify an action", action_effectiveness: "Effectiveness", mitigation: "Mitigation", signature: "Signature", project: "Project", risk_acceptance: "Risk acceptance", risk_review: "Risk review", risk_intolerable: "Intolerable risk", safety_report: "Safety report", safety_question: "Question on your report", status_review: "Status review" };
/** Kinds that can be answered from the card. The others need the app (a manual to read, evidence to attach, a decision to record, a signature). */
export const ANSWERABLE_KINDS = new Set(["action", "action_verify", "mitigation", "authority", "authority_followup", "project", "finding", "status_review"]);
const NEEDS_APP: Record<string, string> = { reading: "Open the manual in S.A.M. and acknowledge it there.", certificate_validity: "Drop the renewed document in S.A.M.", safety_report: "Acknowledge and classify the report in S.A.M.", safety_question: "Answer in S.A.M. (My reports).", risk_acceptance: "Record the decision in S.A.M.", risk_review: "Reassess the hazard in S.A.M.", risk_intolerable: "Decide in S.A.M.", action_effectiveness: "Record the effectiveness in S.A.M.", signature: "Sign in S.A.M." };
const fr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const todayISO = () => new Date().toISOString().slice(0, 10);
export function origin(): string { return (process.env.SAM_ORIGIN ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://sam-jet-sigma.vercel.app")).replace(/\/$/, ""); }
const hhmmUTC = (iso?: string | null) => { const d = iso ? new Date(iso) : new Date(); return `${fr(d.toISOString())} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
export type CardState = { answered: "done" | "not_yet" | "closed" | "superseded"; by: string; at: string; comment?: string | null };
/** The final state of a task, as shown on its cards: answered from Teams, done in the app, or superseded. */
export function stateOf(t: TaskRow, by?: string | null): CardState | undefined {
  if (t.status === "open") return undefined;
  if (t.answered_via === "teams") return { answered: t.answer != null && t.status === "open" ? "not_yet" : "done", by: by ?? "via Teams", at: hhmmUTC(t.answered_at), comment: t.answer };
  if (t.status === "done") return { answered: "closed", by: by ?? "in S.A.M.", at: hhmmUTC(t.answered_at), comment: t.answer };
  return { answered: "superseded", by: t.status, at: hhmmUTC() };
}

/** The card of one task: what it is, when, buttons Done / Not yet (+ comment) / Open in S.A.M. Once answered, the same card shows the answer and no button. */
export type CardOpts = { actions?: unknown[]; hint?: string; doneTitle?: string; commentHint?: string };
export function taskCard(t: TaskRow, state?: CardState, opts: CardOpts = {}): unknown {
  const kind = KIND_LABEL[t.kind] ?? t.kind.replace(/_/g, " ");
  const url = t.link ? `${origin()}${t.link}` : origin();
  const body: unknown[] = [
    { type: "TextBlock", text: `${t.entity} · ${kind}`, size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: t.title, size: "Medium", weight: "Bolder", wrap: true },
  ];
  if (t.detail) body.push({ type: "TextBlock", text: t.detail, wrap: true, spacing: "Small" });
  const facts: { title: string; value: string }[] = [];
  if (t.due) facts.push({ title: "Due", value: fr(t.due) + (t.due < todayISO() ? " — overdue" : "") });
  if (t.owner_role && !t.owner_person) facts.push({ title: "For", value: t.owner_role });
  if (facts.length) body.push({ type: "FactSet", facts, spacing: "Small" });
  const actions: unknown[] = [];
  if (state) {
    const label = state.answered === "done" ? "✓ Done" : state.answered === "not_yet" ? "Not yet" : state.answered === "closed" ? "✓ Done" : "No longer needed";
    body.push({ type: "TextBlock", text: `${label} — ${state.by}, ${state.at}${state.comment ? ` · “${state.comment}”` : ""}`, wrap: true, color: state.answered === "done" || state.answered === "closed" ? "Good" : state.answered === "not_yet" ? "Attention" : "Default", weight: "Bolder", spacing: "Medium" });
  } else if (opts.actions) {
    if (opts.hint) body.push({ type: "TextBlock", text: opts.hint, wrap: true, isSubtle: true, spacing: "Medium" });
    body.push({ type: "Input.Text", id: "comment", placeholder: opts.commentHint ?? "Comment", isMultiline: true, spacing: "Small" });
    actions.push(...opts.actions);
  } else if (ANSWERABLE_KINDS.has(t.kind)) {
    body.push({ type: "Input.Text", id: "comment", placeholder: opts.commentHint ?? "Comment (optional — required for Not yet)", isMultiline: true, spacing: "Medium" });
    actions.push({ type: "Action.Execute", title: opts.doneTitle ?? "Done", verb: "task_done", data: { taskId: t.id }, style: "positive" }, { type: "Action.Execute", title: "Not yet", verb: "task_not_yet", data: { taskId: t.id } });
  } else {
    body.push({ type: "TextBlock", text: NEEDS_APP[t.kind] ?? "Answer in S.A.M.", wrap: true, isSubtle: true, spacing: "Medium" });
  }
  actions.push({ type: "Action.OpenUrl", title: "Open in S.A.M.", url });
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, actions, msteams: { width: "Full" } };
}
/** The card of a task with the buttons its kind calls for: stage moves for Compliance on an authority file, accept / send back on a verification,
 *  Done with the evidence note on a safety action, plain Done / Not yet otherwise. */
export async function cardFor(db: SupabaseClient, t: TaskRow, state?: CardState): Promise<unknown> {
  if (state) return taskCard(t, state);
  try {
    if (t.kind === "authority" && t.ref_id) {
      const { movesFrom } = await import("@/lib/authority");
      const { data: f } = await db.from("authority_files").select("id,stage,type_code,owner_role,owner_person").eq("id", t.ref_id).maybeSingle();
      const file = f as { id: string; stage: string; type_code: string } | null;
      if (file && file.stage !== "draft") {
        const { data: ty } = await db.from("authority_file_types").select("needs_signature").eq("code", file.type_code).maybeSingle();
        // Compliance moves from the card — except the submission itself (COM-03: Submit stays a deliberate act with its reference) and standby
        const moves = movesFrom(file.stage as never, !!(ty as { needs_signature?: boolean } | null)?.needs_signature).filter((m) => m.by === "cmm" && m.to !== "standby" && !(m.to === "submitted" && file.stage === "ready")).slice(0, 3);
        if (moves.length) return taskCard(t, undefined, { hint: `Stage: ${file.stage}. Compliance only.`, commentHint: "Note (required for the moves marked *)", actions: moves.map((m) => ({ type: "Action.Execute", title: `${m.label}${m.needsNote ? " *" : ""}`, verb: "file_move", style: m.primary ? "positive" : undefined, data: { taskId: t.id, fileId: file.id, to: m.to } })) });
      }
      return taskCard(t);
    }
    if (t.kind === "action_verify") return taskCard(t, undefined, { hint: "Safety desk: accept the completion (closed; effectiveness checked later) or send it back to the owner with what is missing.", commentHint: "Note (required to send back)", actions: [
      { type: "Action.Execute", title: "Accept & close", verb: "action_verify", style: "positive", data: { taskId: t.id, verdict: "accept" } },
      { type: "Action.Execute", title: "Send back", verb: "action_verify", data: { taskId: t.id, verdict: "back" } }] });
    if (t.kind === "action") return taskCard(t, undefined, { doneTitle: "Done — with this note as evidence", commentHint: "What was done, and where the evidence is (required for Done)" });
  } catch { /* fall through to the plain card */ }
  return taskCard(t);
}
/** One card listing several tasks (new batch, or the morning digest): title, due, entity — and the Inbox. */
export function listCard(title: string, intro: string, tasks: TaskRow[], link = "/home/tasks"): unknown {
  const t0 = todayISO();
  const rows = tasks.slice(0, 10).map((t) => ({ type: "ColumnSet", spacing: "Small", columns: [
    { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: `**${t.title}**`, wrap: true }, { type: "TextBlock", text: `${t.entity} · ${KIND_LABEL[t.kind] ?? t.kind.replace(/_/g, " ")}`, size: "Small", isSubtle: true, spacing: "None" }] },
    { type: "Column", width: "auto", items: [{ type: "TextBlock", text: t.due ? fr(t.due) : "", size: "Small", color: t.due && t.due < t0 ? "Attention" : "Default", weight: t.due && t.due < t0 ? "Bolder" : "Default" }] },
  ] }));
  const body: unknown[] = [
    { type: "TextBlock", text: "S.A.M.", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: title, size: "Medium", weight: "Bolder", wrap: true },
    { type: "TextBlock", text: intro, wrap: true },
    ...rows,
  ];
  if (tasks.length > 10) body.push({ type: "TextBlock", text: `… and ${tasks.length - 10} more in your Inbox.`, isSubtle: true, wrap: true });
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, actions: [{ type: "Action.OpenUrl", title: "Open my Inbox", url: `${origin()}${link}` }], msteams: { width: "Full" } };
}
export function infoCard(title: string, text: string, link?: string): unknown {
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: "S.A.M.", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" }, { type: "TextBlock", text: title, size: "Medium", weight: "Bolder", wrap: true }, { type: "TextBlock", text, wrap: true }], actions: link ? [{ type: "Action.OpenUrl", title: "Open in S.A.M.", url: `${origin()}${link}` }] : [] };
}

/* ---------- who gets a task ---------- */
type Person = { id: string; display_name: string; roles: string[]; email: string | null; entities: string[]; is_group_function: boolean };
const isFor = (p: Person, t: Pick<TaskRow, "owner_person" | "owner_role" | "entity">) => t.owner_person ? p.id === t.owner_person : !!t.owner_role && (p.is_group_function || p.entities.includes(t.entity)) && p.roles.some((r) => basePost(r) === basePost(t.owner_role!));
/** People a task is addressed to: the named person, or the holders (and deputies) of the post in the task's entity. */
export async function recipientsOf(db: SupabaseClient, t: Pick<TaskRow, "owner_person" | "owner_role" | "entity">): Promise<Person[]> {
  if (t.owner_person) { const { data } = await db.from("people").select("id,display_name,roles,email,entities,is_group_function").eq("id", t.owner_person).maybeSingle(); return data ? [data as Person] : []; }
  if (!t.owner_role) return [];
  const { data } = await db.from("people").select("id,display_name,roles,email,entities,is_group_function").limit(500);
  return ((data ?? []) as Person[]).filter((p) => isFor(p, t));
}
type CardRow = { id: number; task_id: string; person_id: string; conversation_id: string; service_url: string; activity_id: string; card_kind: string; updated_at: string | null };
const BATCH_ABOVE = 4; // more new tasks than this for one person at once → one list card instead of one card each

/** Sends the cards of new tasks to their recipients (best effort, never throws). Each delivery is recorded in teams_cards; every task is marked notified. */
export async function notifyTasks(db: SupabaseClient, tasks: TaskRow[]): Promise<number> {
  if (!teamsConfigured() || !tasks.length) return 0;
  let n = 0;
  try {
    const { data } = await db.from("people").select("id,display_name,roles,email,entities,is_group_function").limit(500);
    const people = (data ?? []) as Person[];
    const perPerson = new Map<string, TaskRow[]>();
    for (const t of tasks) for (const p of people) if (isFor(p, t)) perPerson.set(p.id, [...(perPerson.get(p.id) ?? []), t]);
    for (const [pid, mine] of perPerson) {
      const p = people.find((x) => x.id === pid)!;
      const conv = await ensureConversation(db, p);
      if (!conv) continue;
      const rows: Omit<CardRow, "id" | "updated_at">[] = [];
      if (mine.length > BATCH_ABOVE) {
        const r = await sendCard(conv, listCard(`${mine.length} new items for you`, "Answer each one from your Inbox.", mine), `${mine.length} new items`);
        if (r.ok && r.id) { n++; for (const t of mine) rows.push({ task_id: t.id, person_id: pid, conversation_id: conv.conversation_id, service_url: conv.service_url, activity_id: r.id, card_kind: "batch" }); }
      } else {
        for (const t of mine) { const r = await sendCard(conv, await cardFor(db, t), t.title); if (r.ok && r.id) { n++; rows.push({ task_id: t.id, person_id: pid, conversation_id: conv.conversation_id, service_url: conv.service_url, activity_id: r.id, card_kind: "task" }); } }
      }
      if (rows.length) await db.from("teams_cards").upsert(rows, { onConflict: "task_id,person_id", ignoreDuplicates: true });
    }
  } catch { /* Teams is a channel, never a blocker */ }
  await db.from("tasks").update({ teams_notified_at: new Date().toISOString() }).in("id", tasks.map((t) => t.id));
  return n;
}
/** Convenience for callers that just inserted rows: fetch what was inserted and notify. */
export async function notifyTasksByRef(db: SupabaseClient, refId: string): Promise<void> {
  const { data } = await db.from("tasks").select("*").eq("ref_id", refId).eq("status", "open").is("teams_notified_at", null);
  if (data?.length) await notifyTasks(db, data as TaskRow[]);
}
/** Refreshes every card of a task with its final state (all recipients), except the one being answered right now (Teams replaces it itself). */
export async function refreshCards(db: SupabaseClient, t: TaskRow, state: CardState | undefined, exceptConversation?: string): Promise<void> {
  const { data } = await db.from("teams_cards").select("*").eq("task_id", t.id).is("updated_at", null);
  for (const c of (data ?? []) as CardRow[]) {
    if (c.card_kind === "task" && c.conversation_id !== exceptConversation) await updateCard(c, c.activity_id, taskCard(t, state), t.title);
    await db.from("teams_cards").update({ updated_at: new Date().toISOString() }).eq("id", c.id);
  }
}

/* ---------- the sweep: one entry point for every task created anywhere ---------- */
let lastSweep = 0;
/** Notifies the open tasks nobody told Teams about yet, and refreshes the cards of tasks closed from the app. Cheap, idempotent, throttled per instance. */
export async function sweepTeams(db: SupabaseClient, force = false): Promise<{ notified: number; refreshed: number }> {
  const out = { notified: 0, refreshed: 0 };
  if (!teamsConfigured()) return out;
  if (!force && Date.now() - lastSweep < 45_000) return out;
  lastSweep = Date.now();
  try {
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { data: fresh } = await db.from("tasks").select("*").eq("status", "open").is("teams_notified_at", null).gt("created_at", since).order("created_at").limit(60);
    if (fresh?.length) out.notified = await notifyTasks(db, fresh as TaskRow[]);
    const { data: stale } = await db.from("teams_cards").select("task_id, tasks!inner(*)").is("updated_at", null).neq("tasks.status", "open").limit(40);
    const seen = new Set<string>();
    for (const row of (stale ?? []) as unknown as { task_id: string; tasks: TaskRow }[]) {
      if (seen.has(row.task_id)) continue; seen.add(row.task_id);
      await refreshCards(db, row.tasks, stateOf(row.tasks)); out.refreshed++;
    }
  } catch { /* never a blocker */ }
  return out;
}

/* ---------- morning digest ---------- */
/** Once a day, one card per person with a Teams conversation: what is overdue and what is due within 7 days. Nothing when the Inbox is clear. */
export async function morningDigest(db: SupabaseClient): Promise<number> {
  if (!teamsConfigured()) return 0;
  const t0 = todayISO();
  const { data: convs } = await db.from("teams_conversations").select("*, digest_sent_on").limit(500);
  const { data: ppl } = await db.from("people").select("id,display_name,roles,email,entities,is_group_function").limit(500);
  const { data: open } = await db.from("tasks").select("*").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(2000);
  const people = (ppl ?? []) as Person[]; const tasks = (open ?? []) as TaskRow[];
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  let n = 0;
  for (const c of (convs ?? []) as (TeamsConv & { digest_sent_on: string | null })[]) {
    if (c.digest_sent_on === t0) continue;
    const p = people.find((x) => x.id === c.person_id); if (!p) continue;
    const mine = tasks.filter((t) => isFor(p, t));
    const overdue = mine.filter((t) => t.due && t.due < t0); const week = mine.filter((t) => t.due && t.due >= t0 && t.due <= horizon);
    if (!overdue.length && !week.length) continue;
    const title = `${overdue.length ? `${overdue.length} overdue` : ""}${overdue.length && week.length ? " · " : ""}${week.length ? `${week.length} due this week` : ""}`;
    const r = await sendCard(c, listCard(`Good morning ${p.display_name.split(" ")[0]} — ${title}`, `${mine.length} item${mine.length > 1 ? "s" : ""} in your Inbox in all.`, [...overdue, ...week]), "Your day in S.A.M.");
    if (r.ok) { n++; await db.from("teams_conversations").update({ digest_sent_on: t0 }).eq("person_id", c.person_id); }
  }
  return n;
}
