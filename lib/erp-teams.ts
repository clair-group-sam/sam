import type { SupabaseClient } from "@supabase/supabase-js";
import { RSC_PERMISSIONS, SERVICE_URL, TEAMS_APP_ID, graphToken, origin, recipientsOf, sendCard, teamsConfigured } from "@/lib/teams";
import { INFO, SCENARIOS } from "@/lib/erp";

/* ERP · Teams crisis chat (10/11/2026): at activation S.A.M. opens a group chat with the response unit, adds the S.A.M. app to it
 * and posts the alert card (what happened, scenario, primary information sheet, link to the activation). The unit then works
 * where it already talks; decisions are still logged in S.A.M.
 * Graph application permissions needed (IT): Chat.Create, TeamsAppInstallation.ReadWriteAndConsentSelfForChat.All.
 * Never throws: returns the reason when the chat could not be opened, which is written in the crisis log. */
export async function openCrisisChat(db: SupabaseClient, a: { id: string; entity: string; title: string; exercise: boolean; level: string; scenario: string; info: Record<string, string> | null }, posts: string[]): Promise<{ ok: true; chatId: string; url: string | null; members: number } | { ok: false; reason: string }> {
  if (!teamsConfigured()) return { ok: false, reason: "Teams is not configured (GRAPH_CLIENT_SECRET)" };
  try {
    const people = new Map<string, string>();
    for (const role of posts) for (const p of await recipientsOf(db, { owner_person: null, owner_role: role, entity: a.entity })) if (p.email) people.set(p.email.toLowerCase(), p.display_name);
    if (people.size < 2) return { ok: false, reason: `only ${people.size} member of the unit has an e-mail in S.A.M.` };
    const t = await graphToken();
    const H = { authorization: `Bearer ${t}`, "content-type": "application/json" };
    const topic = `${a.exercise ? "EXERCISE " : ""}ERP ${a.entity}: ${a.title}`.slice(0, 250);
    const members = [...people.keys()].map((e) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${e}')` }));
    const cr = await fetch("https://graph.microsoft.com/v1.0/chats", { method: "POST", headers: H, body: JSON.stringify({ chatType: "group", topic, members }) });
    if (!cr.ok) {
      let roles = "?"; try { roles = (JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()) as { roles?: string[] }).roles?.join(", ") || "none"; } catch { /* keep ? */ }
      return { ok: false, reason: `chat not created: HTTP ${cr.status} ${(await cr.text()).slice(0, 160)} (token roles: ${roles})` };
    }
    const chat = (await cr.json()) as { id: string; webUrl?: string };
    // add the S.A.M. app to the chat so that the bot can post in it
    const ir = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chat.id)}/installedApps`, { method: "POST", headers: H, body: JSON.stringify({
      "teamsApp@odata.bind": `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${TEAMS_APP_ID}`,
      consentedPermissionSet: { resourceSpecificPermissions: RSC_PERMISSIONS.map((permissionValue) => ({ permissionValue, permissionType: "application" })) },
    }) });
    const card = crisisCard(a);
    let sent = false, why = ir.ok || ir.status === 409 ? "" : `app not added to the chat: HTTP ${ir.status} ${(await ir.text()).slice(0, 160)}`;
    if (!why) for (let i = 0; i < 5 && !sent; i++) { // the installation takes a few seconds before the bot may post
      await new Promise((r) => setTimeout(r, 1500));
      const r = await sendCard({ conversation_id: chat.id, service_url: SERVICE_URL }, card, topic);
      sent = r.ok; if (!r.ok) why = r.error ?? "card refused";
    }
    if (!sent) return { ok: false, reason: `chat opened (${chat.webUrl ?? chat.id}) but the alert card was not posted: ${why}` };
    return { ok: true, chatId: chat.id, url: chat.webUrl ?? null, members: people.size };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
}

function crisisCard(a: { id: string; entity: string; title: string; exercise: boolean; level: string; scenario: string; info: Record<string, string> | null }): unknown {
  const facts = INFO.filter(([k]) => a.info?.[k]).map(([k, l]) => ({ title: l, value: a.info![k] }));
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", msteams: { width: "Full" },
    body: [
      { type: "TextBlock", text: a.exercise ? "EXERCISE, NOT A REAL EVENT" : a.level === "activation" ? "ERP ACTIVATED" : "ERP ALERT", weight: "Bolder", color: a.exercise ? "Warning" : "Attention", size: "Medium" },
      { type: "TextBlock", text: a.title, wrap: true, weight: "Bolder", size: "Large" },
      { type: "TextBlock", text: `${a.entity}, ${SCENARIOS.find(([k]) => k === a.scenario)?.[1] ?? a.scenario}`, wrap: true, isSubtle: true, spacing: "Small" },
      ...(facts.length ? [{ type: "FactSet", facts, spacing: "Medium" }] : []),
      { type: "TextBlock", text: "Your checklist and the response times are in S.A.M. Log every decision and call there: this chat is for talking, the S.A.M. log is the record.", wrap: true, spacing: "Medium" },
    ],
    actions: [{ type: "Action.OpenUrl", title: "Open the activation in S.A.M.", url: `${origin()}/erp/activate` }],
  };
}
