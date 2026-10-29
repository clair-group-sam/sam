// Morning coffee phase 2: today's Outlook agenda, unread mail since the previous evening, Teams unread chats and channel mentions.
// Delegated, read-only (nothing marked read, moved or sent). Private / Personal mails and events are never read beyond their flag.
import { graphGet, graphPost } from "@/lib/msgraph-user";
import { callClaude } from "@/lib/ai";
import type { Session } from "@/lib/session";

export type AgendaItem = { start: string; end: string; allDay: boolean; subject: string; location?: string; join?: string; link?: string; sam?: { label: string; link: string }; busy: boolean };
export type Agenda = { items: AgendaItem[]; free: { from: string; to: string }[] };
export type MailItem = { from: string; subject: string; at: string; summary: string; action: boolean; link?: string; count?: number };
export type MailGroups = { total: number; groups: { name: string; items: MailItem[] }[] };
export type TeamsItem = { name: string; preview: string; at: string; link?: string };
export type TeamsRecap = { chats: TeamsItem[]; mentions: TeamsItem[] };
export type SamTarget = { label: string; link: string; match: string };

const TZH = { Prefer: 'outlook.timezone="Europe/Paris"' };
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const mins = (localIso: string) => Number(localIso.slice(11, 13)) * 60 + Number(localIso.slice(14, 16));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Today's agenda (Paris time) + free slots of 30 min or more between 08:00 and 18:00; meetings linked to the S.A.M. object they name. */
export async function agenda(token: string, day: string, targets: SamTarget[], nowMin = 0): Promise<Agenda> {
  type Ev = { subject?: string; start: { dateTime: string }; end: { dateTime: string }; isAllDay: boolean; isCancelled?: boolean; showAs?: string; sensitivity?: string; location?: { displayName?: string }; onlineMeeting?: { joinUrl?: string } | null; webLink?: string; responseStatus?: { response?: string } };
  const q = `/me/calendarView?startDateTime=${day}T00:00:00&endDateTime=${day}T23:59:59&$select=subject,start,end,isAllDay,isCancelled,showAs,sensitivity,location,onlineMeeting,webLink,responseStatus&$orderby=start/dateTime&$top=60`;
  const { value } = await graphGet<{ value: Ev[] }>(token, q, TZH);
  const items: AgendaItem[] = [];
  for (const e of value ?? []) {
    if (e.isCancelled || e.responseStatus?.response === "declined") continue;
    const priv = e.sensitivity === "private" || e.sensitivity === "personal";
    const subject = priv ? "Private appointment" : (e.subject || "(no subject)");
    const low = subject.toLowerCase();
    const sam = priv ? undefined : targets.find((t) => t.match.length >= 3 && (t.match.length <= 8 ? new RegExp(`\\b${t.match.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`, "i").test(subject) : low.includes(t.match.toLowerCase())));
    items.push({ start: e.start.dateTime.slice(0, 16), end: e.end.dateTime.slice(0, 16), allDay: e.isAllDay, subject, location: priv ? undefined : e.location?.displayName || undefined, join: priv ? undefined : e.onlineMeeting?.joinUrl, link: e.webLink, sam: sam ? { label: sam.label, link: sam.link } : undefined, busy: !["free", "workingElsewhere"].includes(e.showAs ?? "busy") });
  }
  // free slots
  const busy = items.filter((i) => i.busy && !i.allDay).map((i) => [Math.max(480, mins(i.start)), Math.min(1080, i.end.slice(0, 10) > day ? 1440 : mins(i.end))]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const free: { from: string; to: string }[] = []; let cur = Math.max(480, Math.ceil(nowMin / 15) * 15); // from now on, in quarters
  for (const [a, b] of busy) { if (a - cur >= 30) free.push({ from: hm(cur), to: hm(a) }); cur = Math.max(cur, b); }
  if (1080 - cur >= 30) free.push({ from: hm(cur), to: hm(1080) });
  return { items, free };
}

const AUTH = /(transport\.gov\.mt|aviation-civile\.gouv\.fr|dgac|easa\.europa\.eu|osac\.aero|centrik\.net|developpement-durable\.gouv\.fr|ecologie\.gouv\.fr)$/i;
const INTERNAL = /(clair-group\.com|astonjet\.(com|fr|mt)|astonfly\.(com|fr)|astontec\.(com|fr)|aston-?jet|aston-?fly)$/i;
const NOTIF = /(no-?reply|do-?not-?reply|notification|notifications|mailer|alerts?|bounce|news(letter)?)@/i;
// FB-001 · one-time codes (security / verification / login codes, OTP, 2FA) are never summarised nor sent to the assistant: the code must not appear in a recap.
const OTP = /((security|verification|one[- ]?time|confirmation|login|sign[- ]?in|authentication|access|2fa|mfa|recovery)\s*(code|pin|passcode)|\bcode\s+(de\s+)?(s[ée]curit[ée]|v[ée]rification|confirmation|connexion|validation)|\bOTP\b|\bpasscode\b|\bvotre code\b|\byour code\b)/i;
const isOtp = (subject: string, preview: string) => OTP.test(subject) || (OTP.test(preview) && /\b\d{4,8}\b/.test(preview));
const hideCode = (t: string) => t.replace(/\b\d{4,8}\b/g, "••••••");

/** Unread mail in the Inbox since the previous evening, grouped, one line each + "Action" marker (SAM). Private / Personal left out. */
export async function mail(token: string, s: Session, since: string): Promise<MailGroups> {
  type M = { id: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; receivedDateTime: string; bodyPreview?: string; importance?: string; webLink?: string; inferenceClassification?: string; categories?: string[]; conversationId?: string; singleValueExtendedProperties?: { id: string; value: string }[] };
  const q = `/me/mailFolders/inbox/messages?$filter=isRead eq false and receivedDateTime ge ${since}&$select=id,subject,from,receivedDateTime,bodyPreview,importance,webLink,inferenceClassification,categories,conversationId&$expand=singleValueExtendedProperties($filter=id eq 'Integer 0x0036')&$orderby=receivedDateTime desc&$top=60`;
  const { value } = await graphGet<{ value: M[] }>(token, q);
  // sensitivity (MAPI 0x0036): 1 = Personal, 2 = Private — left out
  const keep = (value ?? []).filter((m) => !["1", "2"].includes(String(m.singleValueExtendedProperties?.[0]?.value ?? "0")) && !(m.categories ?? []).some((c) => /^(private|personal|priv[ée]|personnel)$/i.test(c)));
  const groupOf = (m: M) => {
    const a = (m.from?.emailAddress?.address ?? "").toLowerCase();
    if (AUTH.test(a.split("@")[1] ?? "")) return "Authorities";
    if (NOTIF.test(a) || m.inferenceClassification === "other") return "Notifications";
    if (INTERNAL.test(a.split("@")[1] ?? "")) return "Internal";
    return "External";
  };
  // One line per CONVERSATION (Outlook conversationId): the exchanges of a thread are recapped together, never one line per mail.
  const otp = keep.map((m) => isOtp(m.subject ?? "", m.bodyPreview ?? ""));
  const cleanSubj = (t: string) => t.replace(/^\s*((re|tr|fw|fwd|aw|wg|r)\s*:\s*|\[ext(ernal)?\]\s*)+/gi, "").trim();
  type Th = { key: string; msgs: M[] };
  const threads = new Map<string, Th>();
  keep.forEach((m, i) => {
    const key = otp[i] ? `otp:${m.id}` : (m.conversationId ?? `s:${cleanSubj(m.subject ?? "").toLowerCase()}`);
    const t = threads.get(key) ?? { key, msgs: [] }; t.msgs.push(m); threads.set(key, t);
  });
  const list = [...threads.values()].map((t) => { t.msgs.sort((x, y) => x.receivedDateTime.localeCompare(y.receivedDateTime)); return t; });
  const groupOfThread = (t: Th) => {
    const gs = t.msgs.map(groupOf);
    return gs.includes("Authorities") ? "Authorities" : gs.every((g) => g === "Notifications") ? "Notifications" : gs.includes("External") ? "External" : gs.includes("Internal") ? "Internal" : gs[gs.length - 1];
  };
  const nameOf = (m: M) => m.from?.emailAddress?.name || m.from?.emailAddress?.address || "?";
  let lines: { i: number; s: string; a: boolean }[] = [];
  const forAi = list.map((t, i) => ({ t, i })).filter(({ t }) => !t.key.startsWith("otp:"));
  if (forAi.length) {
    try {
      const payload = forAi.map(({ t, i }) => ({ i, subject: cleanSubj(t.msgs[t.msgs.length - 1].subject ?? ""), group: groupOfThread(t), messages: t.msgs.slice(-8).map((m) => ({ from: `${nameOf(m)} <${m.from?.emailAddress?.address ?? ""}>`, at: m.receivedDateTime.slice(11, 16), preview: (m.bodyPreview ?? "").slice(0, t.msgs.length > 3 ? 220 : 300) })) }));
      const { text } = await callClaude({ agent: "coffee", personId: s.person?.id ?? null, entity: null, maxTokens: 3000,
        system: `You sort the unread e-mails of ${s.name} (${s.roles.join(", ") || "staff"}, compliance & safety in an aviation group). Each item is ONE conversation (one or several unread messages of the same thread). Write ONE line in English per conversation (max 30 words) that recaps the exchange as a whole — who said what and where it stands now (e.g. "Arthur and Kevin agreed the audit goes in ASJFR OPS; Pierre-Franck still asks for the M.A.201 reference") — never message by message. Set "a" to true only when ${s.name.split(" ")[0]} has to do something (answer, decide, sign, submit, a deadline, an authority request). Newsletters and automatic notifications are never an action unless they announce a deadline or a finding. Never invent. Answer ONLY with JSON: [{"i":0,"s":"…","a":false}]`,
        user: JSON.stringify(payload) });
      const m = /\[[\s\S]*\]/.exec(text); if (m) lines = JSON.parse(m[0]);
    } catch { lines = []; }
  }
  const order = ["Authorities", "Internal", "External", "Notifications"];
  const groups = order.map((name) => ({ name, items: [] as MailItem[] }));
  list.forEach((t, i) => {
    const last = t.msgs[t.msgs.length - 1];
    const g = groups[order.indexOf(groupOfThread(t))];
    if (t.key.startsWith("otp:")) { g.items.push({ from: nameOf(last), subject: hideCode(last.subject || "Security code"), at: last.receivedDateTime, summary: "One-time code — not shown here (expires quickly, read it in Outlook).", action: false, link: last.webLink }); return; }
    const l = lines.find((x) => x.i === i);
    const people = [...new Set(t.msgs.map(nameOf))];
    g.items.push({ from: people.length > 3 ? `${people.slice(0, 3).join(", ")} +${people.length - 3}` : people.join(", "), subject: cleanSubj(last.subject || "(no subject)"), at: last.receivedDateTime, count: t.msgs.length,
      summary: l?.s ?? (last.bodyPreview ?? "").slice(0, 140), action: l ? !!l.a : t.msgs.some((m) => m.importance === "high"), link: last.webLink });
  });
  // FB-005 · identical automatic notifications (same sender, same subject once numbers are removed) are shown once, with a count
  const norm = (t: string) => t.replace(/\(?[0-9a-f]{7,40}\)?/gi, "").replace(/\d+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const g of groups) {
    if (g.name !== "Notifications") continue;
    const seen = new Map<string, MailItem & { n: number }>();
    for (const it of g.items) { const k = it.from.toLowerCase() + "|" + norm(it.subject); const cur = seen.get(k); if (cur) { cur.n++; if (it.at > cur.at) cur.at = it.at; cur.action = cur.action || it.action; } else seen.set(k, { ...it, n: 1 }); }
    g.items = [...seen.values()].map(({ n, ...it }) => (n > 1 ? { ...it, count: (it.count ?? 1) * n, summary: `${n} similar notifications since the last recap — ${it.summary}` } : it));
  }
  for (const g of groups) g.items.sort((a, b) => Number(b.action) - Number(a.action) || b.at.localeCompare(a.at));
  return { total: keep.length, groups: groups.filter((g) => g.items.length) };
}

/** Teams: chats with an unread last message (not mine), and channel messages naming me since the previous evening. */
export async function teams(token: string, since: string, s?: Session): Promise<TeamsRecap> {
  const me = await graphGet<{ id: string; displayName: string }>(token, "/me?$select=id,displayName");
  type C = { id: string; topic?: string | null; chatType: string; webUrl?: string; viewpoint?: { lastMessageReadDateTime?: string }; lastMessagePreview?: { createdDateTime: string; isDeleted?: boolean; body?: { content?: string }; from?: { user?: { id?: string; displayName?: string } } } };
  const { value } = await graphGet<{ value: C[] }>(token, "/me/chats?$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc&$top=50");
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const chats: TeamsItem[] = [];
  for (const c of value ?? []) {
    const p = c.lastMessagePreview; if (!p || p.isDeleted) continue;
    if (p.from?.user?.id === me.id) continue;
    if (p.createdDateTime < weekAgo) continue;
    const read = c.viewpoint?.lastMessageReadDateTime;
    if (read && read >= p.createdDateTime) continue;
    const who = p.from?.user?.displayName ?? "";
    chats.push({ name: c.topic || who || (c.chatType === "meeting" ? "Meeting chat" : "Chat"), preview: (c.topic && who ? who + ": " : "") + strip(p.body?.content ?? "").slice(0, 140), at: p.createdDateTime, link: c.webUrl });
  }
  // channel messages that name me (Microsoft Search), since the previous evening, not written by me
  const mentions: TeamsItem[] = [];
  try {
    type H = { summary?: string; resource?: { createdDateTime?: string; from?: { emailAddress?: { name?: string } }; channelIdentity?: { teamId?: string; channelId?: string } | null; webLink?: string; subject?: string } };
    const r = await graphPost<{ value?: { hitsContainers?: { hits?: H[] }[] }[] }>(token, "/search/query", { requests: [{ entityTypes: ["chatMessage"], query: { queryString: `"${me.displayName}"` }, from: 0, size: 25 }] });
    // one line per channel conversation (all authors together), recapped as a whole
    const per = new Map<string, { at: string; link?: string; authors: Set<string>; parts: string[] }>();
    for (const h of r.value?.[0]?.hitsContainers?.[0]?.hits ?? []) {
      const x = h.resource; if (!x?.channelIdentity?.channelId) continue;              // channel posts only (chats are above)
      if (!/<c0>/i.test(h.summary ?? "")) continue;                                    // my name really is in the text
      if ((x.createdDateTime ?? "") < since) continue;
      const who = x.from?.emailAddress?.name ?? "Channel";
      if (who === me.displayName) continue;
      const k = x.channelIdentity.channelId;
      const cur = per.get(k) ?? { at: x.createdDateTime ?? "", link: x.webLink, authors: new Set<string>(), parts: [] };
      cur.authors.add(who); cur.parts.push(`${who}: ${strip(h.summary ?? x.subject ?? "").slice(0, 200)}`);
      per.set(k, cur);                                                                 // hits come newest first: at / link = latest
    }
    const groups = [...per.values()];
    let recaps: { i: number; s: string }[] = [];
    if (s && groups.some((g) => g.parts.length > 1)) {
      try {
        const { text } = await callClaude({ agent: "coffee", personId: s.person?.id ?? null, entity: null, maxTokens: 1200,
          system: `Each item is ONE Teams channel conversation where ${s.name} is named. Recap the exchange as a whole in ONE English line (max 30 words): who said what and what is expected from ${s.name.split(" ")[0]}. Never message by message, never invent. Answer ONLY JSON: [{"i":0,"s":"…"}]`,
          user: JSON.stringify(groups.map((g, i) => ({ i, messages: [...g.parts].reverse() }))) });
        const m = /\[[\s\S]*\]/.exec(text); if (m) recaps = JSON.parse(m[0]);
      } catch { recaps = []; }
    }
    groups.forEach((g, i) => {
      const who = [...g.authors];
      mentions.push({ name: `${who.length > 2 ? who.slice(0, 2).join(", ") + ` +${who.length - 2}` : who.join(", ")}${g.parts.length > 1 ? ` · ${g.parts.length} messages` : ""}`, preview: recaps.find((x) => x.i === i)?.s ?? g.parts[0].slice(0, 180), at: g.at, link: g.link });
    });
  } catch { /* search unavailable: chats are still shown */ }
  return { chats: chats.slice(0, 20), mentions: mentions.slice(0, 15) };
}
