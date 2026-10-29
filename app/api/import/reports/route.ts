import { NextResponse, type NextRequest } from "next/server";
import { normEntity } from "@/lib/entity-codes";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { centrikDate, centrikPerson, commaName } from "@/lib/centrik";
import { sweepTeams } from "@/lib/teams";

export const maxDuration = 300;
/**
 * Safety reports history: POST {entity, source:"centrik", cases:[…]} by a Compliance session (same origin — the collected data is pasted in S.A.M.).
 * Each case becomes a closed (or open) report with its classification, investigation, findings and actions; re-importing updates it (source + CaseId).
 * Nothing is sent to the reporter; the reporter's name is kept for the safety desk only.
 */
type Act = { id: string; status: string; title: string; owner?: string; due?: string; completed?: string };
type Case = { caseId: string; no: string; entity: string; type?: string; title: string; description?: string; event_date?: string; event_time?: string; location?: string; aircraft?: string; callsign?: string; phase?: string;
  submitted_by?: string; submitted_on?: string; reported_mor?: string; confirmed_mor?: string; erc?: string; occurrence_class?: string; risk_category?: string; hazard_link?: string; event_type?: string;
  investigation?: string; findings?: string; closed_by?: string; closed_on?: string; case_phase?: string; actions?: Act[] };

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== "cmm") return NextResponse.json({ error: "Reserved to Compliance." }, { status: 403 });
  const body = await req.json().catch(() => null) as { source?: string; cases?: Case[] } | null;
  if (!body?.cases?.length) return NextResponse.json({ error: "cases[] expected" }, { status: 400 });
  const db = supabaseAdmin(); const source = body.source ?? "centrik";
  const { data: ppl } = await db.from("people").select("id,display_name");
  const byName = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.display_name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), p.id]));
  const pid = (n: string | null) => (n ? byName.get(n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")) ?? null : null);
  let nr = 0, na = 0, nh = 0; const errors: string[] = [];
  for (const c of body.cases) {
    try {
      c.entity = normEntity(c.entity); // collectors still write the old codes (AJD / ASJ / ASF)
      if (!["ASJMT", "ASJFR", "ASFFR", "ASTFR"].includes(c.entity) || !s.entities.includes(c.entity)) throw new Error(`entity ${c.entity} out of scope`);
      const id = `${source === "flightlogger" ? "FL" : "CTK"}-${c.no}`; const tool = source === "flightlogger" ? "FlightLogger" : "Centrik";
      const closed = /closed/i.test(c.case_phase ?? "") || !!c.closed_on;
      const received = centrikDate(c.submitted_on) ?? (c.event_date ? `${centrikDate(c.event_date)}T12:00:00Z` : new Date().toISOString());
      const mandatory = /confirmed mor/i.test(c.confirmed_mor ?? "") || (/mandatory/i.test(c.reported_mor ?? "") && !/voluntary/i.test(c.confirmed_mor ?? ""));
      const [reporter] = centrikPerson(c.submitted_by);
      const row = { id, entity: c.entity, received_at: received, event_date: centrikDate(c.event_date), event_time_utc: /^\d{1,2}:\d{2}$/.test(c.event_time ?? "") ? c.event_time : null, aircraft: c.aircraft && c.aircraft !== "-" ? c.aircraft : null,
        flight_ref: c.callsign && c.callsign !== "-" ? c.callsign : null, phase: c.phase && c.phase !== "-" ? c.phase : null, headline: c.title.slice(0, 300), narrative: c.description || c.title, location: c.location && c.location !== "-" ? c.location : null,
        anonymous: !c.submitted_by, reporter_person: pid(reporter), reporter_name: reporter, status: closed ? "closed" : c.case_phase && /investig|act|monitor/i.test(c.case_phase) ? "investigation" : "classified",
        closed_at: closed ? (centrikDate(c.closed_on) ? `${centrikDate(c.closed_on)}T12:00:00Z` : received) : null, acknowledged_at: received, classified_at: received,
        mor_filed_at: mandatory ? received : null, mor_ref: mandatory ? `filed outside S.A.M. (${tool})` : null,
        source, history: true, source_ref: c.caseId, external_no: c.no, report_type: c.type?.split(" - ")[0] ?? null, source_erc: Number(c.erc) || null, occurrence_class: c.occurrence_class ?? null, risk_category: c.risk_category ?? null, event_type: c.event_type ?? null,
        investigation: c.investigation ?? null, findings: c.findings ?? null, closed_by_name: centrikPerson(c.closed_by)[0], hazard_label: c.hazard_link ?? null };
      const { error } = await db.from("reports").upsert(row, { onConflict: "id" }); if (error) throw new Error(error.message);
      await db.from("report_analysis").upsert({ report_id: id, mor_status: mandatory ? "mandatory" : "voluntary", mor_basis: `As classified in ${tool}: ${c.confirmed_mor || c.reported_mor || "not stated"}`, confirmed_at: received, summary: null, ran_at: received }, { onConflict: "report_id" });
      const { count } = await db.from("report_events").select("id", { count: "exact", head: true }).eq("report_id", id).eq("kind", "imported");
      if (!count) {
        await db.from("report_events").insert({ report_id: id, kind: "imported", at: received, note: `Imported from ${tool} — report ${c.no}${c.type ? ` (${c.type})` : ""}, received ${c.submitted_on ?? "—"}` });
        if (closed) await db.from("report_events").insert({ report_id: id, kind: "closed", at: row.closed_at, note: `Closed in ${tool}${row.closed_by_name ? ` by ${row.closed_by_name}` : ""}` });
      }
      nr++;
      // FlightLogger: the report's headline id is quoted in the ASFFR hazard log entries ("FL headlines 7410 (8), 7186 (1)")
      const fl = /FL headline (\d+)/.exec(c.hazard_link ?? "");
      if (fl) {
        const { data: hz } = await db.from("hazards").select("id,risk_assessments!inner(kind)").eq("entity", c.entity).eq("risk_assessments.kind", "hazard_log").or(`description.ilike.%${fl[1]}%,title.ilike.%${fl[1]}%`).limit(3);
        for (const h of (hz ?? []) as { id: string }[]) { await db.from("hazard_reports").upsert({ hazard_id: h.id, report_id: id }); nh++; }
      }
      // the risk register link: "HZ - Bird and wildlife hazard (HZ OPS-14) → Bird Strikes During Flight"
      const m = /\((HZ[^)]+)\)\s*(?:→\s*(.+))?$/.exec(c.hazard_link ?? "");
      if (m) {
        const { data: ra } = await db.from("risk_assessments").select("id").eq("entity", c.entity).eq("number", m[1].trim()).maybeSingle();
        if (ra) {
          const { data: hz } = await db.from("hazards").select("id,title").eq("assessment_id", (ra as { id: string }).id);
          const list = (hz ?? []) as { id: string; title: string }[]; const t = (m[2] ?? "").trim().toLowerCase();
          const h = list.find((x) => t && x.title.toLowerCase().startsWith(t)) ?? (list.length === 1 ? list[0] : list.find((x) => t && t.startsWith(x.title.toLowerCase().slice(0, 20))));
          if (h) { await db.from("hazard_reports").upsert({ hazard_id: h.id, report_id: id }); nh++; }
        }
      }
      for (const a of c.actions ?? []) {
        const owner = commaName(a.owner); const op = pid(owner); const done = /closed|complet/i.test(a.status) || !!a.completed;
        const arow = { entity: c.entity, number: a.id, module: "safety", kind: "corrective", title: a.title.slice(0, 300), description: owner && !op ? `Owner in Centrik: ${owner}` : null, owner_person: op, owner_role: op ? null : "SM",
          due: centrikDate(a.due), status: done ? "verified" : "open", source_kind: "report", report_id: id, done_at: done ? `${centrikDate(a.completed) ?? centrikDate(a.due) ?? row.closed_at?.slice(0, 10)}T12:00:00Z` : null, done_note: done ? "Completed in Centrik" : null,
          verified_at: done ? `${centrikDate(a.completed) ?? centrikDate(a.due) ?? row.closed_at?.slice(0, 10)}T12:00:00Z` : null, verified_note: done ? "Closed in Centrik (imported)" : null };
        const { data: ex } = await db.from("safety_actions").select("id,status").eq("entity", c.entity).eq("number", a.id).maybeSingle();
        if (ex) { await db.from("safety_actions").update({ ...arow, updated_at: new Date().toISOString() }).eq("id", (ex as { id: string }).id); }
        else {
          const { data: ins, error: e2 } = await db.from("safety_actions").insert(arow).select("id").single(); if (e2) throw new Error(e2.message);
          const aid = (ins as { id: string }).id;
          await db.from("safety_action_events").insert({ action_id: aid, kind: "imported", note: `Imported from Centrik (${a.id}, ${a.status})` });
          if (!done) await db.from("tasks").insert({ entity: c.entity, kind: "action", title: `${a.id} — ${a.title}`.slice(0, 200), detail: "Safety action (from Centrik): do it, then mark it done with the evidence.", due: arow.due, owner_role: arow.owner_role, owner_person: arow.owner_person, status: "open", link: `/safe/actions/${aid}`, ref_id: aid });
        }
        na++;
      }
    } catch (e) { errors.push(`${c.no}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  await sweepTeams(db, true); // TMS-02 · cards for the actions just imported
  return NextResponse.json({ ok: true, reports: nr, actions: na, hazard_links: nh, errors });
}
