import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { centrikDate, commaName } from "@/lib/centrik";
import { agendaFor, kindName, type Attendee } from "@/lib/committees";

export const maxDuration = 300;
/**
 * Committees history: POST {source:"centrik", meetings:[…]} by a Compliance session (same origin — collected read-only in Centrik › Safety Meeting).
 * Each meeting becomes a held committee with its minutes issued (the Centrik description), the participants found in it, and its Centrik actions
 * as safety actions (closed = verified, open = owner's Inbox task). "ASJ/AJD - …" meetings are recorded in both entities. Re-importing updates.
 */
type Act = { id: string; status: string; title: string; owner?: string; due?: string; completed?: string };
type Mtg = { caseId: string; no: string; title: string; description?: string; event_date?: string; event_time?: string; submitted_by?: string; closed_on?: string; actions?: Act[] };

const entitiesOf = (t: string) => { const m = t.match(/^\s*([A-Z/ ]+?)\s*-/); const codes = (m?.[1] ?? "").split("/").map((x) => x.trim()).filter((x) => ["AJD", "ASJ", "ASF", "TEC"].includes(x)); return codes.length ? codes : ["AJD"]; };
const kindOf = (t: string) => (/\bSRB\b|safety review board/i.test(t) ? "srb" : /\bSAG\b|safety action group/i.test(t) ? "sag" : "other");
function attendeesOf(desc: string): Attendee[] {
  const lines = desc.replace(/\r/g, "").split("\n"); const out: Attendee[] = []; let on = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*/g, "").trim();
    if (/^(partecipants|participants|attendees|attendance|present)\b/i.test(l)) { on = true; const rest = l.split(":").slice(1).join(":").trim(); if (rest) for (const p of rest.split(/[,;]/)) push(p); continue; }
    if (!on) continue;
    if (/^[*•\-–]\s*/.test(l)) { push(l.replace(/^[*•\-–]\s*/, "")); continue; }
    if (l === "") { if (out.length) on = false; continue; }
    on = false;
  }
  function push(p: string) { const [n, ...r] = p.split(/\s+[/–-]\s+|\s*\/\s*/); const name = n.trim(); if (!name || name.length > 60) return; out.push({ name, role: r.join(" / ").trim() || null, person_id: null, present: true }); }
  return out;
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== "cmm") return NextResponse.json({ error: "Reserved to Compliance." }, { status: 403 });
  const body = await req.json().catch(() => null) as { source?: string; meetings?: Mtg[] } | null;
  if (!body?.meetings?.length) return NextResponse.json({ error: "meetings[] expected" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: ppl } = await db.from("people").select("id,display_name");
  const norm = (n: string) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const byName = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [norm(p.display_name), p.id]));
  const pid = (n: string | null) => (n ? byName.get(norm(n)) ?? null : null);
  let nm = 0, na = 0; const errors: string[] = [];
  for (const m of body.meetings) {
    for (const entity of entitiesOf(m.title)) {
      try {
        if (!s.entities.includes(entity)) throw new Error(`${entity} out of scope`);
        const kind = kindOf(m.title); const on = centrikDate(m.event_date) ?? centrikDate(m.closed_on);
        const time = /^\d{1,2}:\d{2}/.test(m.event_time ?? "") ? m.event_time!.slice(0, 5).padStart(5, "0") : null;
        const att = attendeesOf(m.description ?? "").map((a) => ({ ...a, person_id: pid(a.name) }));
        const number = `CTK-${m.no}${entitiesOf(m.title).length > 1 ? `-${entity}` : ""}`;
        const row = { entity, kind, number, title: m.title.replace(/^\s*[A-Z/ ]+?\s*-\s*/, "").trim() || m.title, topic: kind === "sag" ? m.title.replace(/^.*?SAG\s*-\s*/i, "").trim() : null,
          status: "closed", planned_on: on, starts_at: on && time ? `${on}T${time}:00Z` : null, location: null, attendees: att, agenda: agendaFor(entity, kind === "other" ? "sag" : kind).map((x) => ({ ...x, notes: null })),
          minutes: (m.description ?? "").replace(/\*\*/g, "").trim() || null, closed_at: centrikDate(m.closed_on) ? `${centrikDate(m.closed_on)}T12:00:00Z` : on ? `${on}T18:00:00Z` : null,
          source: "centrik", source_ref: `${m.caseId}${entitiesOf(m.title).length > 1 ? `:${entity}` : ""}`, updated_at: new Date().toISOString() };
        if (kind === "other") row.agenda = [];
        const { data: ex } = await db.from("committees").select("id").eq("source", "centrik").eq("source_ref", row.source_ref).maybeSingle();
        let id: string;
        if (ex) { id = (ex as { id: string }).id; await db.from("committees").update(row).eq("id", id); }
        else { const { data: ins, error } = await db.from("committees").insert(row).select("id").single(); if (error || !ins) throw new Error(error?.message ?? "not created"); id = (ins as { id: string }).id; await db.from("committee_events").insert({ committee_id: id, kind: "imported", note: `Imported from Centrik ${m.no} — ${kindName(entity, kind)}` }); }
        nm++;
        for (const a of m.actions ?? []) {
          const owner = commaName(a.owner); const op = pid(owner); const done = /closed|complet/i.test(a.status) || !!a.completed;
          const when = `${centrikDate(a.completed) ?? centrikDate(a.due) ?? on}T12:00:00Z`;
          const arow = { entity, number: a.id, module: "safety", kind: "corrective", title: a.title.slice(0, 300), description: owner && !op ? `Owner in Centrik: ${owner}` : null, owner_person: op, owner_role: op ? null : "SM",
            due: centrikDate(a.due), status: done ? "verified" : "open", source_kind: "committee", committee_id: id, done_at: done ? when : null, done_note: done ? "Completed in Centrik" : null, verified_at: done ? when : null, verified_note: done ? "Closed in Centrik (imported)" : null };
          const { data: ea } = await db.from("safety_actions").select("id,source_kind,committee_id").eq("entity", entity).eq("number", a.id).maybeSingle();
          const E = ea as { id: string; source_kind: string; committee_id: string | null } | null;
          if (E && E.source_kind !== "committee") { if (!E.committee_id) await db.from("safety_actions").update({ committee_id: id }).eq("id", E.id); } // already imported from a report: only linked
          else if (E) await db.from("safety_actions").update({ ...arow, updated_at: new Date().toISOString() }).eq("id", E.id);
          else {
            const { data: ins, error: e2 } = await db.from("safety_actions").insert(arow).select("id").single(); if (e2) throw new Error(e2.message);
            const aid = (ins as { id: string }).id;
            await db.from("safety_action_events").insert({ action_id: aid, kind: "imported", note: `Imported from Centrik (${a.id}, ${a.status}) — ${m.title}` });
            if (!done) await db.from("tasks").insert({ entity, kind: "action", title: `${a.id} — ${a.title}`.slice(0, 200), detail: "Safety action (from a Centrik safety meeting): do it, then mark it done with the evidence.", due: arow.due, owner_role: arow.owner_role, owner_person: arow.owner_person, status: "open", link: `/safe/actions/${aid}`, ref_id: aid });
          }
          na++;
        }
      } catch (e) { errors.push(`${m.no} ${entity}: ${(e as Error).message}`); }
    }
  }
  return NextResponse.json({ ok: true, meetings: nm, actions: na, errors });
}
