import type { NextRequest } from "next/server";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nextFindingNumber } from "@/lib/findings";

/* Astonfly / Astontec history from the Monday board "Compliance Software" (read-only mirror): audits (internal + civil aviation) and their findings
 * (E1 / E2 / R, root cause, corrective action plan, due, closure, extension). POST {audits:[…]} as extracted from the board. Compliance desk. */
type MF = { id: string; title: string; level: string | null; status: string | null; dept: string | null; notified: string | null; due: string | null; closed_on: string | null; ext: string | null; regulation: string | null; ref: string | null; description: string | null; root_cause: string | null; pac: string | null };
type MA = { id: string; name: string; group: string; ref: string | null; auditor: string | null; type: string | null; status: string | null; start: string | null; end: string | null; report: string | null; closed: string | null; findings: MF[] };
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r)))) return Response.json({ error: "Compliance desk only" }, { status: 403 });
  const { audits } = (await req.json()) as { audits: MA[] };
  const db = supabaseAdmin(); const out: string[] = [];
  for (const a of audits) {
    const entity = a.type === "TEC" || /^TEC\b/.test(a.name) ? "ASTFR" : "ASFFR";
    if (!s.group && !s.entities.includes(entity)) { out.push(`${a.ref}: not your entity`); continue; }
    const civil = /CIVIL/i.test(a.group); const checks = /Contrôles de conformité/i.test(a.name);
    const kind = checks ? "checks" : civil ? "authority" : "internal";
    const authority = civil ? (a.auditor ?? "").replace(/\s*\(.*$/, "").trim() || null : null;
    const number = (a.ref ?? a.name).replace(/\s*\(.*$/, "").slice(0, 40);
    const month = (a.start ?? a.end ?? a.report ?? "2025-01-01").slice(0, 7) + "-01";
    const done = a.status === "Closed" || a.status === "Realised" ? (a.end ?? a.start ?? a.report) : null;
    const row = { entity, number, kind, domain: a.type === "FSTD" ? "FSTD" : a.type === "TEC" ? "CAE" : "ATO", title: a.name.replace(/^(FLY|TEC) - /, "").slice(0, 200), planned_month: month, planned_on: a.start, planned_end: a.end, started_on: a.start, done_on: done, status: done ? "closed" : (a.start || a.report || a.findings.length) ? "in_progress" : "planned", external_auditor: a.auditor, authority, external_ref: civil ? a.ref : null, report_at: a.report ? `${a.report}T12:00:00Z` : null, closed_at: a.closed ? `${a.closed}T12:00:00Z` : done ? `${done}T12:00:00Z` : null, note: `Monday Compliance Software · item ${a.id}`, imported_from: `Monday Compliance Software · ${a.ref ?? a.id}`, created_by: s.person?.id ?? null };
    const { data: ex } = await db.from("audits").select("id").eq("entity", entity).eq("number", number).maybeSingle();
    let auditId = (ex as { id: string } | null)?.id ?? null;
    if (auditId) await db.from("audits").update(row).eq("id", auditId);
    else { const { data, error } = await db.from("audits").insert(row).select("id").single(); if (error) { out.push(`${number}: ${error.message}`); continue; } auditId = data.id; await db.from("audit_events").insert({ audit_id: auditId, kind: "planned", to_month: month, reason: "Imported from Monday (Compliance Software)" }); }
    let nf = 0;
    for (const f of a.findings) {
      const level = f.level === "E1" ? "1" : f.level === "E2" ? "2" : "obs";
      const closed = f.status === "Closed";
      // 10/11 · the Monday root cause and plan are the analysis (round 1, accepted); an open finding with both is "plan in progress", one without is "to analyse"
      const analysed = !!f.root_cause && !!f.pac;
      const desc = [f.description, f.ext && f.ext !== "No" ? `Extension: ${f.ext}` : null].filter(Boolean).join("\n\n");
      const frow = { entity, source: civil ? "authority" : kind === "checks" ? "inspection" : "internal_audit", authority, audit_ref: number, audit_id: auditId, level, requirement: f.regulation || f.ref || null, title: f.title.slice(0, 300), description: desc || null, owner_role: f.dept === "Compliance" ? "CMM" : f.dept === "FSTD" ? "FSTDM" : f.dept === "ATO" ? "HT" : f.dept === "TEC" ? "MAM" : null, notified: f.notified ?? a.report ?? a.end, due: f.due, status: closed ? "closed" : analysed ? "accepted" : "open", draft_root_cause: f.root_cause || null, draft_comment: f.pac || null, current_round: f.root_cause ? 1 : 0, draft_step: f.root_cause ? 3 : 1, closed_at: closed ? `${f.closed_on ?? a.closed ?? f.due ?? "2026-01-01"}T12:00:00Z` : null, closed_note: closed ? "Closed in Monday" : null, imported_from: `Monday Compliance Software · subitem ${f.id}` };
      const { data: fx } = await db.from("findings").select("id").eq("imported_from", frow.imported_from).maybeSingle();
      let fid = (fx as { id: string } | null)?.id ?? null;
      if (fid) await db.from("findings").update(frow).eq("id", fid);
      else { const { data: ins, error } = await db.from("findings").insert({ ...frow, number: await nextFindingNumber(db, entity), created_by: s.person?.id ?? null }).select("id").single(); if (error) { out.push(`${number}/${f.title.slice(0, 20)}: ${error.message}`); continue; } fid = ins.id; }
      nf++;
      if (f.root_cause && fid) { const { data: r1 } = await db.from("finding_rounds").select("id").eq("finding_id", fid).limit(1); const at = `${f.notified ?? a.report ?? a.end ?? "2025-01-01"}T12:00:00Z`;
        if (!r1?.length) await db.from("finding_rounds").insert({ finding_id: fid, stage: "full", n: 1, root_cause: f.root_cause, comment: f.pac, answered_at: at, via: "import", decision: "accepted", decided_at: at, note: "Analysis and plan imported from Monday (Compliance Software)" }); }
    }
    out.push(`${number} (${entity}, ${kind}): ${nf} findings`);
  }
  return Response.json({ lines: out });
}
