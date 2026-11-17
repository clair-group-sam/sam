import type { NextRequest } from "next/server";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nextFindingNumber } from "@/lib/findings";

/* AUD-05 · An audit carried out outside S.A.M. on the house form (e.g. Astontec's organisation review, ASTDOC15) brought in as it was
 * written: the form becomes the checklist of the audit (sections, questions, where to look), each answer a check with its result and
 * comment, each finding a finding of the audit linked to its question. Mirror of the record: nothing is judged or reworded.
 * POST { entity, audit: {...} } — Compliance desk. Run again with the same audit number and source: it updates, it does not duplicate. */
export const runtime = "nodejs";
export const maxDuration = 60;
type Item = { code: string; question: string; guidance?: string | null; result?: string | null; comment?: string | null; finding?: string | null };
type Fnd = { ref: string; title: string; description?: string | null; level?: string; requirement?: string | null; owner_role?: string | null; notified?: string | null; due?: string | null };
type Rec = { number: string; title?: string; kind?: string; domain?: string | null; done_on: string; started_on?: string | null; lead?: string | null; summary?: string | null; source: string;
  checklist: { code: string; title: string; note?: string | null }; sections: { title: string; items: Item[] }[]; findings: Fnd[] };
const RESULT: Record<string, string> = { ok: "conforming", conforming: "conforming", constatation: "non_conforming", finding: "non_conforming", "s/o": "not_applicable", "n/a": "not_applicable", "non vérifié": "not_covered", "not covered": "not_covered", partial: "partial" };

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r)))) return Response.json({ error: "Compliance desk only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { entity?: string; audit?: Rec };
  const entity = body.entity ?? ""; const a = body.audit;
  if (!entity || (!s.group && !s.entities.includes(entity))) return Response.json({ error: "entity" }, { status: 400 });
  if (!a?.number || !a.done_on || !a.checklist?.code || !Array.isArray(a.sections) || !a.source) return Response.json({ error: "audit: number, done_on, checklist, sections and source are required" }, { status: 400 });
  const db = supabaseAdmin(); const out: string[] = [];
  // 1. the form as a checklist of the entity (replaced by the form of this audit: it is the edition in force)
  const { data: exCl } = await db.from("checklists").select("id").eq("entity", entity).eq("code", a.checklist.code).maybeSingle();
  let clId = (exCl as { id: string } | null)?.id ?? null;
  const clRow = { entity, code: a.checklist.code, title: a.checklist.title.slice(0, 200), domain: a.domain ?? null, note: a.checklist.note ?? null, imported_from: `${a.source} · form of ${a.number} (${a.done_on})`, updated_at: new Date().toISOString() };
  if (clId) await db.from("checklists").update(clRow).eq("id", clId);
  else { const { data, error } = await db.from("checklists").insert({ ...clRow, created_by: s.person?.id ?? null }).select("id").single(); if (error || !data) return Response.json({ error: `checklist: ${error?.message}` }, { status: 500 }); clId = (data as { id: string }).id; }
  await db.from("checklist_items").delete().eq("checklist_id", clId); await db.from("checklist_sections").delete().eq("checklist_id", clId);
  const itemId = new Map<string, string>(); let ord = 0, sord = 0;
  for (const sec of a.sections) {
    const { data: sd } = await db.from("checklist_sections").insert({ checklist_id: clId, ord: sord++, title: sec.title.slice(0, 200) }).select("id").single();
    const rows = sec.items.map((it) => ({ checklist_id: clId, section_id: (sd as { id: string } | null)?.id ?? null, ord: ++ord, code: it.code.slice(0, 60), ref: null, regulation_id: null, question: it.question.slice(0, 500), guidance: it.guidance?.slice(0, 1000) ?? null }));
    if (rows.length) { const { data: ins, error } = await db.from("checklist_items").insert(rows).select("id,code"); if (error) return Response.json({ error: `items: ${error.message}` }, { status: 500 }); for (const x of (ins ?? []) as { id: string; code: string }[]) itemId.set(x.code, x.id); }
  }
  // 2. the audit: the one already planned under this number, else a new one
  const { data: ppl } = a.lead ? await db.from("people").select("id,display_name").ilike("display_name", `%${a.lead.split(" ").pop()}%`).limit(3) : { data: [] };
  const lead = ((ppl ?? []) as { id: string }[])[0]?.id ?? null;
  const { data: exA } = await db.from("audits").select("id,planned_month,started_on,lead_auditor").eq("entity", entity).eq("number", a.number).maybeSingle();
  const ex = exA as { id: string; planned_month: string | null; started_on: string | null; lead_auditor: string | null } | null;
  const patch = { checklist_id: clId, status: "closed", done_on: a.done_on, started_on: a.started_on ?? ex?.started_on ?? a.done_on, report_summary: a.summary ?? null, report_at: `${a.done_on}T12:00:00Z`, closed_at: `${a.done_on}T12:00:00Z`, lead_auditor: ex?.lead_auditor ?? lead, imported_from: a.source, updated_at: new Date().toISOString() };
  let auditId = ex?.id ?? null;
  if (auditId) { const { error } = await db.from("audits").update(patch).eq("id", auditId); if (error) return Response.json({ error: `audit: ${error.message}` }, { status: 500 }); await db.from("audit_events").insert({ audit_id: auditId, by: s.person?.id ?? null, kind: "note", reason: `Record brought in from ${a.source}: carried out on ${a.done_on}` }); }
  else { const month = a.done_on.slice(0, 7) + "-01"; const { data, error } = await db.from("audits").insert({ entity, number: a.number.slice(0, 40), kind: a.kind ?? "internal", domain: a.domain ?? null, title: (a.title ?? a.checklist.title).slice(0, 200), planned_month: month, planned_on: a.started_on ?? a.done_on, planned_end: a.done_on, ...patch, created_by: s.person?.id ?? null }).select("id").single();
    if (error || !data) return Response.json({ error: `audit: ${error?.message}` }, { status: 500 }); auditId = (data as { id: string }).id; await db.from("audit_events").insert({ audit_id: auditId, kind: "planned", to_month: month, reason: `Imported from ${a.source}` }); }
  // 3. the answers
  await db.from("audit_checks").update({ finding_id: null }).eq("audit_id", auditId); await db.from("audit_checks").delete().eq("audit_id", auditId);
  const checks: Record<string, unknown>[] = []; let cord = 0;
  for (const sec of a.sections) for (const it of sec.items) checks.push({ audit_id: auditId, item_id: itemId.get(it.code.slice(0, 60)) ?? null, ord: ++cord, section: sec.title.slice(0, 200), code: it.code.slice(0, 60), ref: null, question: it.question.slice(0, 500), guidance: it.guidance?.slice(0, 1000) ?? null,
    result: it.result ? RESULT[it.result.toLowerCase()] ?? null : null, comment: it.comment ?? null, checked_by: lead, checked_at: `${a.done_on}T12:00:00Z`, imported: { result: it.result ?? null, finding: it.finding ?? null, source: a.source } });
  const { data: insC, error: eC } = await db.from("audit_checks").insert(checks).select("id,code"); if (eC) return Response.json({ error: `checks: ${eC.message}` }, { status: 500 });
  const checkId = new Map(((insC ?? []) as { id: string; code: string }[]).map((c) => [c.code, c.id]));
  // 4. the findings, each linked to the question(s) it was raised on
  for (const f of a.findings) {
    const tag = `${a.source} · ${f.ref}`; const codes = a.sections.flatMap((x) => x.items).filter((it) => it.finding === f.ref).map((it) => it.code.slice(0, 60));
    const row = { entity, source: "internal_audit", authority: null, audit_ref: a.number, audit_id: auditId, check_id: checkId.get(codes[0] ?? "") ?? null, level: f.level ?? "2", requirement: f.requirement ?? null, title: f.title.slice(0, 300), description: f.description ?? null, owner_role: f.owner_role ?? null, notified: f.notified ?? a.done_on, due: f.due ?? null, imported_from: tag, updated_at: new Date().toISOString() };
    const { data: fx } = await db.from("findings").select("id,status").eq("imported_from", tag).eq("entity", entity).maybeSingle();
    let fid = (fx as { id: string } | null)?.id ?? null;
    if (fid) await db.from("findings").update(row).eq("id", fid);
    else { const { data: ins, error } = await db.from("findings").insert({ ...row, number: await nextFindingNumber(db, entity), status: "open", created_by: s.person?.id ?? null }).select("id,number").single(); if (error || !ins) { out.push(`${f.ref}: ${error?.message}`); continue; } fid = (ins as { id: string }).id; out.push(`${f.ref} → ${(ins as { number: string }).number}`); }
    for (const c of codes) { const id = checkId.get(c); if (id) await db.from("audit_checks").update({ finding_id: fid }).eq("id", id); }
  }
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "audit", object_id: auditId, action: "audit_record_imported", after: { source: a.source, number: a.number, checks: checks.length, findings: a.findings.length } });
  return Response.json({ audit: a.number, audit_id: auditId, checklist: a.checklist.code, checks: checks.length, findings: a.findings.length, lines: out });
}
