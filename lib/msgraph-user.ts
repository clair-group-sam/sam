// The S.A.M. app registration in Entra ID (Arthur Boutin, 20/10). Used by the sign-in, the Teams bot and the application-level Graph calls.
// S.A.M. holds no personal Microsoft token: the delegated rights on mail, calendar and chats went with Morning coffee (removed 20/11/2026).
// These ids are not secrets: the env vars win only when they are well-formed GUIDs, so a mistyped value in Vercel cannot break the connection.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLIENT_ID = GUID.test((process.env.GRAPH_CLIENT_ID ?? "").trim()) ? process.env.GRAPH_CLIENT_ID!.trim() : "f5834b34-2908-4ab2-a5ae-0673d98c7752";
export const TENANT_ID = GUID.test((process.env.GRAPH_TENANT_ID ?? "").trim()) ? process.env.GRAPH_TENANT_ID!.trim() : "e5ea6d43-2b89-4845-899c-a8240c5099d1";
/** Scopes asked at sign-in (Supabase Azure provider): identity only. Keep in step with app/login/page.tsx. */
export const SIGNIN_SCOPES = "openid profile email User.Read";
