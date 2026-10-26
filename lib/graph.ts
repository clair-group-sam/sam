// Microsoft Graph mail (application permission Mail.Send, limited by Exchange RBAC to the sender mailbox).
// Set in Vercel: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MAIL_FROM (e.g. compliance@clair-group.com).

import { CLIENT_ID, TENANT_ID } from "@/lib/msgraph-user";

export function mailConfigured(): boolean {
  return !!(process.env.GRAPH_CLIENT_SECRET && process.env.MAIL_FROM);
}

async function token(): Promise<string> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: process.env.GRAPH_CLIENT_SECRET!.trim(), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body });
  const j = (await r.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(j.error_description?.split("\n")[0] ?? `token HTTP ${r.status}`);
  return j.access_token;
}

/** One message, recipients in Bcc (they do not see each other). Graph accepts up to 500 recipients per message. */
export async function sendMail(opts: { bcc: string[]; subject: string; html: string }): Promise<{ ok: boolean; sent: number; error?: string }> {
  if (!mailConfigured()) return { ok: false, sent: 0, error: "e-mail not configured" };
  const to = [...new Set(opts.bcc.filter(Boolean))];
  if (!to.length) return { ok: true, sent: 0 };
  try {
    const t = await token();
    let sent = 0;
    for (let i = 0; i < to.length; i += 450) {
      const chunk = to.slice(i, i + 450);
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MAIL_FROM!)}/sendMail`, {
        method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { subject: opts.subject, body: { contentType: "HTML", content: opts.html }, toRecipients: [{ emailAddress: { address: process.env.MAIL_FROM } }], bccRecipients: chunk.map((a) => ({ emailAddress: { address: a } })) }, saveToSentItems: true }),
      });
      if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } }; return { ok: false, sent, error: j.error?.message ?? `sendMail HTTP ${r.status}` }; }
      sent += chunk.length;
    }
    return { ok: true, sent };
  } catch (e) {
    return { ok: false, sent: 0, error: (e as Error).message };
  }
}
