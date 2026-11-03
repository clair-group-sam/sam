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
export type RankItem = { id: string; tier: Tier; title: string; why: string; action: string; entity?: string; sources: Src[] };
export type Ranked = { top: string[]; items: RankItem[]; by: "sam" | "rules" };

type Cand = RankItem & { max: Tier; text: string };
const cap = (t: number, max: Tier): Tier => Math.max(1, Math.min(max, t)) as Tier;

/** Every element of the recap becomes a candidate with its rule tier (= the worst tier it may get). */
export function candidates(r: Omit<Recap, "synthesis">, nowHm: string): Cand[] {
  const c: Cand[] = [];
  const sam = (l: Line, id: string, tier: Tier, why: string, action: string) => c.push({ id, tier, max: tier, title: `${l.ctx ? l.ctx + " › " : ""}${l.title}`, why, action, entity: l.entity, sources: [{ kind: "sam", label: l.label, link: l.link }], text: `${l.label} · ${l.ctx ?? ""} ${l.title}${l.due ? " · due " + l.due : ""}${l.note ? " · " + l.note : ""}` });
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
    c.push({ id: `ag${i}`, tier: startsSoon ? 2 : 3, max: startsSoon ? 2 : 3, title: `${a.start.slice(11)}–${a.end.slice(11)} ${a.subject}`, why: startsSoon ? "Meeting within 2 h" : "Meeting today", action: a.sam ? `Prepare — ${a.sam.label}` : "Be ready", sources: [{ kind: "agenda", label: "Meeting", link: a.sam?.link ?? a.link }], text: `meeting ${a.start.slice(11)} ${a.subject}${a.sam ? " [S.A.M. " + a.sam.label + "]" : ""}` });
  });
  (r.mail?.groups ?? []).forEach((g) => g.items.forEach((m, i) => {
    const t: Tier = g.name === "Notifications" ? (m.action ? 3 : 4) : g.name === "Authorities" ? 2 : m.action ? 2 : 3;
    c.push({ id: `ml${g.name[0]}${i}`, tier: t, max: g.name === "Notifications" ? 4 : t, title: `${m.from} — ${m.subject}`, why: g.name === "Authorities" ? "Authority" : m.action ? "Expects something from you" : g.name, action: m.action ? "Answer or act" : "Read", sources: [{ kind: "mail", label: `Mail · ${g.name}${m.count && m.count > 1 ? ` · ${m.count}` : ""}`, link: m.link }], text: `mail (${g.name}) from ${m.from}: ${m.subject} — ${m.summary}` });
  }));
  (r.teams?.mentions ?? []).forEach((m, i) => c.push({ id: `tm${i}`, tier: 2, max: 3, title: `${m.name}`, why: "You are named in a channel", action: "Answer in the channel", sources: [{ kind: "teams", label: "Teams · @mention", link: m.link }], text: `teams channel mention by ${m.name}: ${m.preview}` }));
  (r.teams?.chats ?? []).forEach((m, i) => c.push({ id: `tc${i}`, tier: m.ask ? 2 : 3, max: m.ask ? 2 : 4, title: `${m.name}`, why: m.ask ? "Waits for your answer" : "Unread chat", action: m.ask ? "Answer" : "Read", sources: [{ kind: "teams", label: `Teams · chat${m.count && m.count > 1 ? ` · ${m.count}` : ""}`, link: m.link }], text: `teams chat with ${m.name}: ${m.preview}` }));
  return c;
}
function addHm(hm: string, min: number) { const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + min; return `${String(Math.min(23, Math.floor(t / 60))).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }

const plain = (c: Cand[]): Ranked => {
  const items = c.map(({ max: _m, text: _t, ...it }) => it).sort((a, b) => a.tier - b.tier);
  return { top: items.filter((x) => x.tier <= 2).slice(0, 3).map((x) => `${x.title} — ${x.action}`), items, by: "rules" };
};

export async function rank(s: Session, r: Omit<Recap, "synthesis">, nowHm: string): Promise<Ranked> {
  const c = candidates(r, nowHm);
  if (!c.length) return { top: [], items: [], by: "rules" };
  try {
    const { text } = await callClaude({ agent: "coffee", personId: s.person?.id ?? null, entity: null, maxTokens: 4000,
      system: `You prioritise the morning of ${s.name} (${s.roles.join(", ") || "staff"}), compliance & safety manager in an aviation group (Astonjet Ltd ASJMT, Astonjet SAS ASJFR, Astonfly ASFFR, Astontec ASTFR). It is ${nowHm} (Paris).
Each item has an id, its source text and "max": the WORST tier it may get (rules). Tiers: 1 = do now (regulatory clock, overdue, authority waiting, meeting within 2 h to prepare), 2 = today (due today, someone waits for an answer, authority, Accountable Manager), 3 = to know (information, what moved, this week), 4 = can wait (notifications, copies, later).
For EVERY item return: "t" tier (1..4, never above max), "w" why in max 8 words, "a" the concrete action in max 10 words (verb first). Merge nothing, drop nothing. Then "top": the first three things to do today, each max 15 words, in order. English, factual, only from the items; never copy a code, password or key.
Answer ONLY JSON: {"top":["…"],"items":[{"id":"…","t":1,"w":"…","a":"…"}]}`,
      user: JSON.stringify(c.map((x) => ({ id: x.id, max: x.max, text: x.text.slice(0, 400) }))) });
    const m = /\{[\s\S]*\}/.exec(text); if (!m) return plain(c);
    const j = JSON.parse(m[0]) as { top?: string[]; items?: { id: string; t: number; w?: string; a?: string }[] };
    const byId = new Map((j.items ?? []).map((x) => [x.id, x]));
    const items = c.map(({ max, text: _t, ...it }) => { const o = byId.get(it.id); return o ? { ...it, tier: cap(o.t, max), why: o.w?.trim() || it.why, action: o.a?.trim() || it.action } : it; })
      .sort((a, b) => a.tier - b.tier);
    return { top: (j.top ?? []).filter(Boolean).slice(0, 3), items, by: "sam" };
  } catch { return plain(c); }
}
