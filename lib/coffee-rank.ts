// Morning coffee · Lot 1 (03/11, Guillaume): ONE list for the person, all sources mixed, ranked by importance in 4 tiers,
// with why and what to do, and the first three things on top. Rules first (a floor no item can fall below), then SAM ranks
// inside the rules and writes the lines; SAM never drops an item. Without the assistant, the rule ranking is shown.
import type { Session } from "@/lib/session";
import { callClaude } from "@/lib/ai";
import type { Line, Recap } from "@/lib/coffee";

export type Tier = 1 | 2 | 3 | 4;
export const TIERS: Record<Tier, { title: string; hint: string }> = {
  1: { title: "Do now", hint: "regulatory clock, overdue, meeting to prepare, authority waiting" },
  2: { title: "Today", hint: "due today, someone waits for your answer, authority, AM" },
  3: { title: "To know", hint: "information, what moved, this week" },
  4: { title: "Can wait", hint: "notifications, copies, later" },
};
export type Src = { kind: "sam" | "mail" | "teams" | "agenda"; label: string; link?: string | null };
export type RankItem = { id: string; tier: Tier; title: string; why: string; action: string; entity?: string; sources: Src[]; badge?: "for-you" | "you-wait"; topic?: string;
  /** Lot 3 · what "Not important" / "Important" / "Tomorrow" remember: the sender (mail), the chat (Teams) or the S.A.M. link */
  key?: string; keyLabel?: string; draftable?: boolean; ctx?: string };
export type Ranked = { top: string[]; items: RankItem[]; by: "sam" | "rules" };

type Cand = RankItem & { max: Tier; text: string };
const cap = (t: number, max: Tier): Tier => Math.max(1, Math.min(max, t)) as Tier;

/** Every element of the recap becomes a candidate with its rule tier (= the worst tier it may get). */
export function candidates(r: Omit<Recap, "synthesis">, nowHm: string): Cand[] {
  const c: Cand[] = [];
  const sam = (l: Line, id: string, tier: Tier, why: string, action: string) => c.push({ id, tier, max: tier, key: `sam:${l.link ?? l.title}`, keyLabel: l.title, title: `${l.ctx ? l.ctx + " › " : ""}${l.title}`, why, action, entity: l.entity, sources: [{ kind: "sam", label: l.label, link: l.link }], text: `${l.label} · ${l.ctx ?? ""} ${l.title}${l.due ? " · due " + l.due : ""}${l.note ? ", " + l.note : ""}` });
  r.mor.forEach((l, i) => sam(l, `mor${i}`, 1, `MOR clock — ${l.label}`, "Decide mandatory / voluntary, file if needed"));
  r.overdue.forEach((l, i) => sam(l, `ov${i}`, 1, `Overdue since ${l.due}`, "Do it or move the date"));
  r.today.forEach((l, i) => sam(l, `td${i}`, 2, "Due today", "Do it today"));
  r.validities.forEach((l, i) => { const d = l.label === "Expired" ? -1 : parseInt(l.label); sam(l, `va${i}`, d <= 7 ? 1 : d <= 30 ? 2 : 3, l.label === "Expired" ? "Expired" : `Ends in ${l.label}`, "Check the renewal"); });
  r.week.forEach((l, i) => sam(l, `wk${i}`, 3, `Due ${l.due}`, "Plan it"));
  r.readings.forEach((l, i) => sam(l, `rd${i}`, 3, "To read and acknowledge", "Read it"));
  r.moved.forEach((l, i) => sam(l, `mv${i}`, 3, "Moved since last evening", "Check"));
  (r.agenda?.items ?? []).forEach((a, i) => {
    if (a.allDay || !a.busy || a.end.slice(11) <= nowHm) return;
    const startsSoon = a.start.slice(11) <= addHm(nowHm, 120);
    c.push({ id: `ag${i}`, key: `agenda:${a.subject.toLowerCase()}`, keyLabel: a.subject, tier: startsSoon ? 2 : 3, max: startsSoon ? 2 : 3, title: `${a.start.slice(11)}–${a.end.slice(11)} ${a.subject}`, why: startsSoon ? "Meeting within 2 h" : "Meeting today", action: a.sam ? `Prepare, ${a.sam.label}` : "Be ready", sources: [{ kind: "agenda", label: "Meeting", link: a.sam?.link ?? a.link }], text: `meeting ${a.start.slice(11)} ${a.subject}${a.sam ? " [S.A.M. " + a.sam.label + "]" : ""}` });
  });
  (r.mail?.groups ?? []).forEach((g) => g.items.forEach((m, i) => {
    const t: Tier = g.name === "Notifications" ? (m.action ? 3 : 4) : g.name === "Authorities" ? 2 : m.action ? 2 : 3;
    c.push({ id: `ml${g.name[0]}${i}`, key: m.addr ? `mail:${m.addr}` : `mail:${m.from.toLowerCase()}`, keyLabel: m.addr || m.from, draftable: g.name !== "Notifications" && !/(no-?reply|do-?not-?reply|notification|notif|mailer|alerts?|centrik\.net)/i.test(m.addr ?? ""), tier: t, max: g.name === "Notifications" ? 4 : t, title: `${m.from} — ${m.subject}`, why: g.name === "Authorities" ? "Authority" : m.action ? "Expects something from you" : g.name, action: m.action ? "Answer or act" : "Read", badge: m.action ? "for-you" : undefined, sources: [{ kind: "mail", label: `Mail · ${g.name}${m.count && m.count > 1 ? ` · ${m.count}` : ""}`, link: m.link }], text: `mail (${g.name}) from ${m.from}: ${m.subject} — ${m.summary}` });
  }));
  (r.teams?.mentions ?? []).forEach((m, i) => c.push({ id: `tm${i}`, key: `teams:${m.name.toLowerCase()}`, keyLabel: m.name, draftable: true, tier: 2, max: 3, title: `${m.name}`, why: "You are named in a channel", action: "Answer in the channel", badge: "for-you", sources: [{ kind: "teams", label: "Teams · @mention", link: m.link }], text: `teams channel mention by ${m.name}: ${m.preview}` }));
  (r.teams?.chats ?? []).forEach((m, i) => c.push({ id: `tc${i}`, key: `teams:${m.name.toLowerCase()}`, keyLabel: m.name, draftable: true, tier: m.ask ? 2 : 3, max: m.ask ? 2 : 4, title: `${m.name}`, why: m.ask ? "Waits for your answer" : "Unread chat", action: m.ask ? "Answer" : "Read", badge: m.ask ? "for-you" : undefined, sources: [{ kind: "teams", label: `Teams · chat${m.count && m.count > 1 ? ` · ${m.count}` : ""}`, link: m.link }], text: `teams chat with ${m.name}: ${m.preview}` }));
  // Lot 2 · what the person is waiting for (sent, unanswered)
  (r.waiting ?? []).forEach((w, i) => {
    const days = Math.max(1, Math.round((Date.now() - new Date(w.since).getTime()) / 864e5));
    c.push({ id: `wt${i}`, key: `wait:${w.subject.toLowerCase()}`, keyLabel: w.subject, draftable: true, tier: 3, max: 3, title: `${w.who}, ${w.subject}`, why: `No answer for ${days} days`, action: `Chase ${w.who.split(",")[0]}`, badge: "you-wait", sources: [{ kind: w.kind, label: w.kind === "mail" ? "Mail · sent" : "Teams · sent", link: w.link }], text: `YOU are waiting: you asked ${w.who} (${w.kind}) ${days} days ago, no answer yet: ${w.subject}, ${w.preview}` });
  });
  return c;
}
function addHm(hm: string, min: number) { const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + min; return `${String(Math.min(23, Math.floor(t / 60))).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }

const plain = (c: Cand[]): Ranked => {
  const items = c.map(({ max: _m, text, ...it }) => ({ ...it, ctx: text.slice(0, 400) })).sort((a, b) => a.tier - b.tier);
  return { top: items.filter((x) => x.tier <= 2).slice(0, 3).map((x) => `${x.title} — ${x.action}`), items, by: "rules" };
};

export type Prefs = { important: string[]; muted: string[]; snoozed: { key: string; until: string }[] };
/** a word / domain rule never mutes a regulatory clock, an overdue item or a due-today item (max ≤ 2); marking that very line does.
 *  a preference matches the line's key (mail:address, teams:chat, sam:link…) or, for a domain ("@easa.europa.eu"), the mail address */
const hit = (list: string[], key?: string) => !!key && list.some((p) => { const q = p.toLowerCase(); return key === q || (q.startsWith("@") && key.startsWith("mail:") && key.endsWith(q)) || (!q.includes(":") && !q.startsWith("@") && key.includes(q)); });
function applyPrefs(c: Cand[], p: Prefs | null, day: string): Cand[] {
  if (!p) return c;
  return c.filter((x) => !p.snoozed.some((z) => z.key === x.key && z.until > day))
    .map((x) => hit(p.muted, x.key) && (x.max >= 3 || p.muted.includes(x.key ?? "")) ? { ...x, tier: 4 as Tier, max: 4 as Tier, why: "Marked not important" } : hit(p.important, x.key) ? { ...x, tier: Math.min(x.tier, 2) as Tier, max: Math.min(x.max, 2) as Tier, why: x.why || "Marked important" } : x);
}

export async function rank(s: Session, r: Omit<Recap, "synthesis">, nowHm: string, prefs: Prefs | null = null): Promise<Ranked> {
  const c = applyPrefs(candidates(r, nowHm), prefs, r.day);
  if (!c.length) return { top: [], items: [], by: "rules" };
  try {
    const { text } = await callClaude({ agent: "coffee", personId: s.person?.id ?? null, entity: null, maxTokens: 4000,
      system: `You prioritise the morning of ${s.name} (${s.roles.join(", ") || "staff"}), compliance & safety manager in an aviation group (Astonjet Ltd ASJMT, Astonjet SAS ASJFR, Astonfly ASFFR, Astontec ASTFR). It is ${nowHm} (Paris).
Each item has an id, its source text and "max": the WORST tier it may get (rules). Tiers: 1 = do now (regulatory clock, overdue, authority waiting, meeting within 2 h to prepare), 2 = today (due today, someone waits for an answer, authority, Accountable Manager), 3 = to know (information, what moved, this week), 4 = can wait (notifications, copies, later).
For EVERY item return: "t" tier (1..4, never above max), "w" why in max 8 words, "a" the concrete action in max 10 words (verb first), and "g": a short topic label (max 6 words) ONLY when two or more items are about the SAME matter (same report, manual, authority application, aircraft, person and request, e.g. a mail thread, a Teams chat and a S.A.M. task on the ECCAIRS sandbox) — the same "g" for all of them; otherwise "". Drop nothing. Then "top": the first three things to do today, each max 15 words, in order. English, factual, only from the items; never copy a code, password or key.
Answer ONLY JSON: {"top":["…"],"items":[{"id":"…","t":1,"w":"…","a":"…"}]}`,
      user: JSON.stringify(c.map((x) => ({ id: x.id, max: x.max, text: x.text.slice(0, 400) }))) });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) return plain(c);
    const j = JSON.parse(m[0]) as { top?: string[]; items?: { id: string; t: number; w?: string; a?: string; g?: string }[] };
    const byId = new Map((j.items ?? []).map((x) => [x.id, x]));
    const items = c.map(({ max, text, ...it0 }) => { const it = { ...it0, ctx: text.slice(0, 400) }; const o = byId.get(it.id); const muted = it.why === "Marked not important"; return o ? { ...it, tier: muted ? 4 as Tier : cap(o.t, max), why: muted ? it.why : o.w?.trim() || it.why, action: o.a?.trim() || it.action, topic: muted ? undefined : o.g?.trim() || undefined } : it; });
    return { top: (j.top ?? []).filter(Boolean).slice(0, 3), items: mergeTopics(items).sort((a, b) => a.tier - b.tier), by: "sam" };
  } catch { return plain(c); }
}

/** Lot 2 · the lines SAM put under the same topic become ONE line: best tier, its why / action, every source kept. */
export function mergeTopics(items: RankItem[]): RankItem[] {
  // a merged line keeps the key / draft of its best line
  const by = new Map<string, RankItem[]>(); const out: RankItem[] = [];
  for (const it of items) { if (!it.topic) { out.push(it); continue; } const k = it.topic.toLowerCase(); by.set(k, [...(by.get(k) ?? []), it]); }
  for (const g of by.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const best = [...g].sort((a, b) => a.tier - b.tier || Number(!!b.badge) - Number(!!a.badge))[0];
    out.push({ ...best, id: `g:${best.id}`, title: best.topic!, why: best.why, sources: g.flatMap((x) => x.sources), entity: g.find((x) => x.entity)?.entity, badge: g.some((x) => x.badge === "for-you") ? "for-you" : g.some((x) => x.badge === "you-wait") ? "you-wait" : undefined,
      topic: g.map((x) => x.title).join(", ").slice(0, 300) });
  }
  return out;
}
