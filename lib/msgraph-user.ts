// Microsoft Graph with the USER's delegated rights (Morning coffee phase 2): Calendars.Read, Mail.Read, Chat.Read,
// ChannelMessage.Read.All, offline_access — granted by IT on 26/10 with admin consent. Read-only: nothing is marked read,
// moved or sent. The refresh token is stored encrypted (AES-256-GCM), server side only, one per person.
// Vercel: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET (same app as the sign-in); optional SAM_TOKEN_KEY.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const GRAPH_SCOPES = "https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Chat.Read https://graph.microsoft.com/ChannelMessage.Read.All offline_access";
/** Scopes asked at sign-in (Supabase Azure provider). */
export const SIGNIN_SCOPES = "openid profile email offline_access User.Read Calendars.Read Mail.Read Chat.Read ChannelMessage.Read.All";

const key = () => createHash("sha256").update((process.env.SAM_TOKEN_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") + ":sam-graph-tokens").digest();
function seal(plain: string): string {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function open(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export const graphConfigured = () => !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);

type Stored = { r?: string; a?: string; exp?: number };
const read = (sealed: string): Stored => { const v = open(sealed); return v.startsWith("{") ? (JSON.parse(v) as Stored) : { r: v }; };
/** Keeps the refresh token and, when given, the access token received at sign-in (valid about an hour). */
export async function saveTokens(personId: string, t: { refresh?: string | null; access?: string | null; expiresIn?: number }) {
  const db = supabaseAdmin();
  const { data } = await db.from("graph_tokens").select("refresh_enc").eq("person_id", personId).maybeSingle();
  const prev: Stored = data ? (() => { try { return read((data as { refresh_enc: string }).refresh_enc); } catch { return {}; } })() : {};
  const next: Stored = { r: t.refresh || prev.r, a: t.access || prev.a, exp: t.access ? Date.now() + (t.expiresIn ?? 3000) * 1000 : prev.exp };
  await db.from("graph_tokens").upsert({ person_id: personId, refresh_enc: seal(JSON.stringify(next)), updated_at: new Date().toISOString() }, { onConflict: "person_id" });
}
export const saveRefreshToken = (personId: string, refresh: string) => saveTokens(personId, { refresh });
export async function hasGraph(personId: string): Promise<boolean> {
  if (!graphConfigured()) return false;
  const { data } = await supabaseAdmin().from("graph_tokens").select("person_id").eq("person_id", personId).maybeSingle();
  return !!data;
}

/** A fresh access token for this person (the rotated refresh token is stored back). */
export async function userToken(personId: string): Promise<string> {
  if (!graphConfigured()) throw new Error("Microsoft Graph is not configured in Vercel (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET).");
  const db = supabaseAdmin();
  const { data } = await db.from("graph_tokens").select("refresh_enc").eq("person_id", personId).maybeSingle();
  if (!data) throw new Error("Microsoft not connected yet: sign out of S.A.M. and sign in again.");
  const st = read((data as { refresh_enc: string }).refresh_enc);
  if (st.a && st.exp && st.exp - Date.now() > 120_000) return st.a; // access token from the sign-in, still valid
  if (!st.r) throw new Error("Microsoft session expired: sign out of S.A.M. and sign in again.");
  const body = new URLSearchParams({ client_id: process.env.GRAPH_CLIENT_ID!, client_secret: process.env.GRAPH_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: st.r, scope: GRAPH_SCOPES });
  const r = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body });
  const j = (await r.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!j.access_token) {
    const detail = (j.error_description ?? "").split("\n")[0].replace(/Trace ID.*$/i, "").trim();
    console.error("[graph] refresh failed", j.error, detail, "refresh-token shape:", st.r.length, st.r.slice(0, 4));
    // only a dead token is forgotten (expired, revoked, password changed); other errors are shown as they are
    const dead = j.error === "invalid_grant" && /AADSTS(70008|700082|50173|50133|700084)\b/.test(detail);
    if (dead) await db.from("graph_tokens").delete().eq("person_id", personId);
    throw new Error(dead ? "Microsoft session expired: sign out of S.A.M. and sign in again." : `Microsoft refused the connection (${j.error ?? r.status}${detail ? ": " + detail.slice(0, 220) : ""}).`);
  }
  await saveTokens(personId, { refresh: j.refresh_token, access: j.access_token, expiresIn: (j as { expires_in?: number }).expires_in });
  return j.access_token;
}

export async function graphGet<T>(token: string, path: string, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { authorization: `Bearer ${token}`, ...headers }, cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error((j as { error?: { message?: string } }).error?.message ?? `Graph HTTP ${r.status}`);
  return j;
}
export async function graphPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error((j as { error?: { message?: string } }).error?.message ?? `Graph HTTP ${r.status}`);
  return j;
}
