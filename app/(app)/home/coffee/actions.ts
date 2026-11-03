"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { brew, parisParts, todaysRecap } from "@/lib/coffee";
import { callClaude } from "@/lib/ai";
import type { Prefs } from "@/lib/coffee-rank";

export async function brewCoffee(formData?: FormData) {
  const s = await getSession();
  if (!s?.person) redirect("/login");
  const src = formData?.getAll("src").map(String).filter(Boolean);
  await brew(s, src && src.length ? src : undefined);
  revalidatePath("/home/tasks");
  redirect("/home/coffee");
}

const addDays = (day: string, n: number) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function prefsOf(personId: string): Promise<Prefs> {
  const { data } = await supabaseAdmin().from("coffee_prefs").select("important,muted,snoozed").eq("person_id", personId).maybeSingle();
  return (data as Prefs | null) ?? { important: [], muted: [], snoozed: [] };
}
async function savePrefs(personId: string, p: Prefs) {
  await supabaseAdmin().from("coffee_prefs").upsert({ person_id: personId, important: [...new Set(p.important)].slice(0, 200), muted: [...new Set(p.muted)].slice(0, 300), snoozed: p.snoozed.slice(-200), updated_at: new Date().toISOString() });
}
/** Lot 3 · a line of the recap: Important / Not important (remembered for the next recaps), Tomorrow (hidden until tomorrow), undo. The recap of today is updated in place. */
export async function markLine(fd: FormData) {
  const s = await getSession(); if (!s?.person) redirect("/login");
  const key = String(fd.get("key") ?? "").trim().toLowerCase(); const op = String(fd.get("op") ?? "");
  if (!key) return;
  const p = await prefsOf(s.person.id); const { day } = parisParts();
  const base = key.startsWith("mail:") ? key : key;
  p.important = p.important.filter((x) => x !== base); p.muted = p.muted.filter((x) => x !== base);
  if (op === "important") p.important.push(base);
  if (op === "muted") p.muted.push(base);
  if (op === "snooze") p.snoozed = [...p.snoozed.filter((z) => z.key !== key && z.until > day), { key, until: addDays(day, 1) }];
  await savePrefs(s.person.id, p);
  // today's recap: move / hide the line without brewing again
  const r = await todaysRecap(s.person.id);
  if (r?.ranked) {
    r.ranked.items = r.ranked.items.filter((x) => !(op === "snooze" && x.key === key)).map((x) => x.key !== key ? x : op === "muted" ? { ...x, tier: 4, why: "Marked not important" } : op === "important" ? { ...x, tier: Math.min(x.tier, 2) as 1 | 2, why: "Marked important" } : x);
    await supabaseAdmin().from("coffee_recaps").update({ data: r }).eq("person_id", s.person.id).eq("day", r.day);
  }
  revalidatePath("/home/coffee");
}
/** Settings · remove a remembered rule. */
export async function unmark(fd: FormData) {
  const s = await getSession(); if (!s?.person) redirect("/login");
  const v = String(fd.get("value") ?? ""); const p = await prefsOf(s.person.id);
  p.important = p.important.filter((x) => x !== v); p.muted = p.muted.filter((x) => x !== v);
  await savePrefs(s.person.id, p); revalidatePath("/home/coffee");
}
/** Settings · add a sender, a domain (@easa.europa.eu) or a word as important / muted. */
export async function addRule(fd: FormData) {
  const s = await getSession(); if (!s?.person) redirect("/login");
  let v = String(fd.get("value") ?? "").trim().toLowerCase(); const list = String(fd.get("list")) === "muted" ? "muted" : "important";
  if (!v) return;
  if (/^[^@\s]+@[^@\s]+\.[a-z]+$/.test(v)) v = `mail:${v}`;            // a full address
  const p = await prefsOf(s.person.id); p[list].push(v); await savePrefs(s.person.id, p); revalidatePath("/home/coffee");
}
/** Lot 3 · "To my Inbox": the line becomes a task of the person (due today or tomorrow). */
export async function lineToTask(fd: FormData) {
  const s = await getSession(); if (!s?.person) redirect("/login");
  const title = String(fd.get("title") ?? "").slice(0, 180); const action = String(fd.get("action") ?? "");
  const { day } = parisParts();
  await supabaseAdmin().from("tasks").insert({ entity: String(fd.get("entity") || s.person.home_entity || s.entities[0]), kind: "todo", title: action ? `${action} — ${title}`.slice(0, 200) : title, detail: "From the morning coffee", due: String(fd.get("when")) === "tomorrow" ? addDays(day, 1) : day, owner_person: s.person.id, status: "open", link: String(fd.get("link") || "") || null });
  revalidatePath("/home/tasks"); revalidatePath("/home/coffee");
}
/** Lot 3 · a reply drafted by SAM for a mail / Teams line — shown to copy into Outlook / Teams; nothing is sent. */
export async function draftReply(input: { title: string; why: string; action: string; ctx?: string }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const s = await getSession(); if (!s?.person) return { ok: false, error: "Sign in again." };
  try {
    const { text } = await callClaude({ agent: "coffee", personId: s.person.id, entity: null, maxTokens: 600,
      system: `You draft a short reply for ${s.name} (compliance & safety manager, aviation group) to send himself. Same language as the exchange (French or English). 3 to 6 sentences, courteous, direct, no greeting formula longer than one word, no signature block. Use only the facts given; where a fact is missing write [to complete]. Never invent dates, numbers, approvals or commitments. Plain text only.`,
      user: JSON.stringify(input) });
    return { ok: true, text: text.trim() };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
