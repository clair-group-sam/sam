// Morning coffee (UX-02), phase 1: a recap of what S.A.M. holds for the person this morning, prepared ON DEMAND only.
// Read-only: nothing is marked read, moved or sent. Kept for the day (one recap per person and day, replaced by "brew again").
// Phase 2 (Outlook calendar + mail, Teams) needs delegated Graph rights (Calendars.Read, Mail.Read, Chat.Read) — not granted yet.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { basePost, type Session } from "@/lib/session";
import { myInbox, kindLabel, KIND, type InboxItem } from "@/lib/inbox";
import { callClaude } from "@/lib/ai";

export const TZ = "Europe/Paris";
export type Line = { kind: string; label: string; cls: string; title: string; ctx?: string; due?: string | null; entity: string; link?: string | null; note?: string };
export type Recap = {
  day: string; at: string; since: string; sources: string[];
  overdue: Line[]; today: Line[]; week: Line[]; later: number;
  readings: Line[]; validities: Line[]; mor: Line[]; moved: Line[];
  synthesis: string;
};
export const SOURCES = [
  { id: "sam", label: "S.A.M. — deadlines, readings, validities, what moved", ready: true },
  { id: "calendar", label: "Outlook calendar — today's agenda", ready: false },
  { id: "mail", label: "Outlook mail — unread since yesterday 18:00", ready: false },
  { id: "teams", label: "Teams — unread chats and @mentions", ready: false },
];

/** Date (YYYY-MM-DD) and wall-clock parts in Paris time. */
export function parisParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday as string };
}
/** UTC instant of a Paris wall-clock time. */
function parisToUtc(day: string, hh: number): Date {
  const guess = new Date(`${day}T${String(hh).padStart(2, "0")}:00:00Z`);
  const p = parisParts(guess);
  const shown = Date.UTC(Number(p.day.slice(0, 4)), Number(p.day.slice(5, 7)) - 1, Number(p.day.slice(8, 10)), p.hour, p.minute);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
const addDays = (day: string, n: number) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Since 18:00 the previous working day (Friday 18:00 on a Monday). */
export function sinceOf(day: string, weekday: string): Date {
  const back = weekday === "Mon" ? 3 : weekday === "Sun" ? 2 : 1;
  return parisToUtc(addDays(day, -back), 18);
}
export const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export async function todaysRecap(personId: string): Promise<Recap | null> {
  const { day } = parisParts();
  const { data } = await supabaseAdmin().from("coffee_recaps").select("data").eq("person_id", personId).eq("day", day).maybeSingle();
  return ((data as { data: Recap } | null)?.data) ?? null;
}

const line = (t: InboxItem): Line => ({ kind: t.kind, label: kindLabel(t.kind), cls: KIND[t.kind]?.[1] ?? "", title: t.title, ctx: t.ctx ? (t.kind === "project" ? "Project · " : "") + t.ctx : undefined, due: t.due, entity: t.entity, link: t.link, note: t.detail ?? undefined });

/** Gathers the recap (no AI yet). */
export async function gather(s: Session): Promise<Omit<Recap, "synthesis">> {
  const now = new Date();
  const { day, weekday } = parisParts(now);
  const since = sinceOf(day, weekday);
  const in7 = addDays(day, 7);
  const db = supabaseAdmin();
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const posts = new Set(s.roles.map(basePost));
  const office = s.role !== "user";
  const safetyDesk = s.role === "cmm" || ["SM", "FSO"].some((p) => posts.has(p));

  // 1 · deadlines from the Inbox (readings and validities have their own blocks)
  const inbox = await myInbox(s);
  const dl = inbox.filter((t) => t.kind !== "reading" && t.kind !== "certificate_validity");
  const overdue = dl.filter((t) => t.due && t.due < day).map(line);
  const today = dl.filter((t) => t.due === day).map(line);
  const week = dl.filter((t) => t.due && t.due > day && t.due <= in7).map(line);
  const later = dl.length - overdue.length - today.length - week.length;
  const readings = inbox.filter((t) => t.kind === "reading").map(line);

  // 2 · validities ending within 90 days (office profiles)
  const validities: Line[] = [];
  if (office) {
    const { data } = await db.from("certificates").select("id,entity,title,registration,valid_until,kind").in("entity", scope).is("archived_at", null).not("valid_until", "is", null).lte("valid_until", addDays(day, 90)).order("valid_until");
    for (const c of (data ?? []) as { id: string; entity: string; title: string; registration: string | null; valid_until: string; kind: string }[]) {
      const days = Math.round((new Date(c.valid_until + "T12:00:00Z").getTime() - new Date(day + "T12:00:00Z").getTime()) / 864e5);
      validities.push({ kind: "certificate_validity", label: days < 0 ? "Expired" : `${days} d`, cls: days < 0 || days <= 7 ? "k-comp" : days <= 30 ? "k-cert" : "", title: c.title, ctx: c.registration ?? undefined, due: c.valid_until, entity: c.entity, link: `/docs/files?entity=${c.entity}` });
    }
  }

  // 3 · MOR 72 h clocks still running (safety desk)
  const mor: Line[] = [];
  if (safetyDesk) {
    const { data } = await db.from("reports").select("id,entity,headline,received_at,status,report_analysis(mor_status)").in("entity", scope).gte("received_at", new Date(now.getTime() - 72 * 3600e3).toISOString()).in("status", ["received", "acknowledged", "classified"]);
    for (const r of (data ?? []) as unknown as { id: string; entity: string; headline: string; received_at: string; report_analysis: { mor_status: string | null } | { mor_status: string | null }[] | null }[]) {
      const a = Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis;
      if (a?.mor_status === "voluntary") continue;
      const left = Math.max(0, Math.round(72 - (now.getTime() - new Date(r.received_at).getTime()) / 3600e3));
      mor.push({ kind: "mor", label: `${left} h left`, cls: left <= 24 ? "k-comp" : "k-cert", title: `Report ${r.id} · ${r.headline}`, note: a?.mor_status ? `MOR ${a.mor_status}` : "MOR to assess", entity: r.entity, link: `/safe/reports` });
    }
  }

  // 4 · what moved since yesterday 18:00
  const moved: { at: string; l: Line }[] = [];
  const sinceIso = since.toISOString();
  {
    const { data } = await db.from("manual_notices").select("sent_at,manual_id,entity,revisions(rev),manuals(code,title)").in("entity", scope).gte("sent_at", sinceIso).limit(20);
    for (const n of (data ?? []) as unknown as { sent_at: string; manual_id: string; entity: string; revisions: { rev: string } | null; manuals: { code: string; title: string } | null }[])
      moved.push({ at: n.sent_at, l: { kind: "published", label: "Published", cls: "k-docs", title: `${n.manuals?.code ?? ""} Rev ${n.revisions?.rev ?? ""} — ${n.manuals?.title ?? ""}`, entity: n.entity, link: `/docs/manual/${n.manual_id}`, note: hhmm(n.sent_at) } });
  }
  if (office) {
    const { data: files } = await db.from("authority_files").select("id,title,entity,stage,owner_role,owner_person").in("entity", scope).gte("updated_at", sinceIso).limit(40);
    const mine = ((files ?? []) as { id: string; title: string; entity: string; stage: string; owner_role: string | null; owner_person: string | null }[])
      .filter((f) => s.role === "cmm" || f.owner_person === s.person?.id || (f.owner_role && posts.has(basePost(f.owner_role))));
    if (mine.length) {
      const { data: ev } = await db.from("authority_file_events").select("file_id,at,kind,note").in("file_id", mine.map((f) => f.id)).gte("at", sinceIso).in("kind", ["stage", "submitted", "remarks", "reply", "decision"]).order("at", { ascending: false }).limit(20);
      for (const e of (ev ?? []) as { file_id: string; at: string; kind: string; note: string | null }[]) {
        const f = mine.find((x) => x.id === e.file_id)!;
        moved.push({ at: e.at, l: { kind: "authority", label: "Authority file", cls: "k-auth", title: f.title, note: `${e.kind === "stage" ? "now " + f.stage : e.kind}${e.note ? " · " + e.note.slice(0, 90) : ""}`, entity: f.entity, link: `/proj/auth/${f.id}` } });
      }
    }
    const { data: certs } = await db.from("certificates").select("id,entity,title,uploaded_at").in("entity", scope).gte("uploaded_at", sinceIso).limit(10);
    for (const c of (certs ?? []) as { id: string; entity: string; title: string; uploaded_at: string }[])
      moved.push({ at: c.uploaded_at, l: { kind: "certificate", label: "Filed", cls: "k-cert", title: c.title, entity: c.entity, link: `/docs/files?entity=${c.entity}`, note: hhmm(c.uploaded_at) } });
  }
  {
    const { data: projs } = await db.from("projects").select("id,title,entity").in("entity", scope).eq("status", "open");
    const ps = (projs ?? []) as { id: string; title: string; entity: string }[];
    if (ps.length) {
      const { data: done } = await db.from("project_tasks").select("project_id,title,updated_at,status").in("project_id", ps.map((p) => p.id)).in("status", ["done", "blocked"]).gte("updated_at", sinceIso).order("updated_at", { ascending: false }).limit(20);
      for (const t of (done ?? []) as { project_id: string; title: string; updated_at: string; status: string }[]) {
        const p = ps.find((x) => x.id === t.project_id)!;
        moved.push({ at: t.updated_at, l: { kind: "project", label: "Project", cls: "k-proj", title: t.title, ctx: "Project · " + p.title, note: t.status === "done" ? "done" : "blocked", entity: p.entity, link: `/proj/boards/${p.id}` } });
      }
    }
  }
  moved.sort((a, b) => b.at.localeCompare(a.at));
  return { day, at: now.toISOString(), since: sinceIso, sources: ["sam"], overdue, today, week, later, readings, validities, mor, moved: moved.slice(0, 25).map((m) => m.l) };
}

/** One sentence by SAM on what matters most today (falls back to a plain sentence if the assistant is not reachable). */
export async function synthesise(s: Session, r: Omit<Recap, "synthesis">): Promise<string> {
  const fallback = () => {
    const bits = [r.overdue.length && `${r.overdue.length} overdue`, r.today.length && `${r.today.length} due today`, r.mor.length && `${r.mor.length} MOR clock${r.mor.length > 1 ? "s" : ""} running`, r.validities.filter((v) => (v.label === "Expired" || parseInt(v.label) <= 30)).length && `${r.validities.filter((v) => v.label === "Expired" || parseInt(v.label) <= 30).length} validit${r.validities.length > 1 ? "ies" : "y"} within 30 days`, r.readings.length && `${r.readings.length} reading${r.readings.length > 1 ? "s" : ""} to acknowledge`].filter(Boolean);
    return bits.length ? `Today: ${bits.join(", ")}.` : "Nothing urgent in S.A.M. this morning.";
  };
  const pick = (l: Line[]) => l.slice(0, 6).map((x) => `${x.entity} · ${x.label} · ${x.ctx ? x.ctx + " › " : ""}${x.title}${x.due ? " (due " + x.due + ")" : ""}${x.note ? " [" + x.note + "]" : ""}`);
  const facts = { today: r.day, overdue: pick(r.overdue), due_today: pick(r.today), next_7_days: pick(r.week), readings: r.readings.length, validities: pick(r.validities), mor_72h: pick(r.mor), moved_since_last_evening: pick(r.moved) };
  try {
    const { text } = await callClaude({ agent: "coffee", personId: s.person?.id ?? null, entity: null, maxTokens: 220,
      system: `You prepare the morning recap of ${s.name.split(" ")[0]} (${s.roles.join(", ") || "staff"}) in the compliance & safety software of an aviation group. Write ONE or two sentences in English (max 45 words): what matters most today and what to do first, based ONLY on the facts given. Regulatory clocks (MOR 72 h, expired validities, overdue authority items) come first. No greeting, no emoji, no list, never invent anything. If nothing is urgent, say so plainly.`,
      user: JSON.stringify(facts) });
    const t = text.trim().replace(/^["']|["']$/g, "");
    return t || fallback();
  } catch { return fallback(); }
}

export async function brew(s: Session): Promise<Recap> {
  const g = await gather(s);
  const recap: Recap = { ...g, synthesis: await synthesise(s, g) };
  const db = supabaseAdmin();
  await db.from("coffee_recaps").upsert({ person_id: s.person!.id, day: recap.day, data: recap, created_at: recap.at }, { onConflict: "person_id,day" });
  await db.from("coffee_recaps").delete().eq("person_id", s.person!.id).lt("day", recap.day);
  return recap;
}
