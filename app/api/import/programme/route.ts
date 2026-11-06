import type { NextRequest } from "next/server";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addMonths, monthStart, nextAuditNumber, PROG_REF } from "@/lib/audit-programme";

/* AUD-01 · Seed a programme from the entity's audit plan (ENR-OPS-01 / ENR-M-01 read by hand): modules linked to the checklists by code,
 * audits placed month by month; a row with a Centrik number attaches the imported audit instead of creating one. Compliance desk. */
type SeedAudit = { month: string; centrik_no?: string; planned_on?: string; kind?: string; title?: string; subcontractor?: string };
type SeedModule = { code: string; title: string; kind?: string; domain?: string; checklist?: string; audits?: SeedAudit[] };
type Body = { entity: string; title: string; reference?: string; starts_on: string; cycle_months: number; approve?: boolean; attach_imported?: boolean; modules: SeedModule[] };
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r)))) return Response.json({ error: "Compliance desk only" }, { status: 403 });
  const b = (await req.json()) as Body;
  if (!s.group && !s.entities.includes(b.entity)) return Response.json({ error: "entity" }, { status: 403 });
  const db = supabaseAdmin();
  const start = monthStart(b.starts_on); const end = new Date(Date.parse(addMonths(start, b.cycle_months)) - 86_400_000).toISOString().slice(0, 10);
  const { data: ex } = await db.from("audit_programmes").select("id").eq("entity", b.entity).eq("title", b.title).maybeSingle();
  if (ex) return Response.json({ error: `A programme "${b.title}" already exists for ${b.entity}` }, { status: 409 });
  const { data: p, error } = await db.from("audit_programmes").insert({ entity: b.entity, title: b.title, reference: b.reference ?? PROG_REF[b.entity]?.reference ?? null, domains: PROG_REF[b.entity]?.domains ?? [], cycle_months: b.cycle_months, starts_on: start, ends_on: end, status: b.approve ? "approved" : "draft", approved_by: b.approve ? s.person?.id ?? null : null, approved_at: b.approve ? new Date().toISOString() : null, created_by: s.person?.id ?? null }).select("id").single();
  if (error || !p) return Response.json({ error: error?.message }, { status: 500 });
  const { data: cls } = await db.from("checklists").select("id,code").eq("entity", b.entity).eq("active", true);
  const clId = (code?: string) => ((cls ?? []) as { id: string; code: string }[]).find((c) => c.code.toUpperCase() === (code ?? "").toUpperCase())?.id ?? null;
  const out: string[] = []; let sort = 0;
  for (const m of b.modules) {
    const checklist = clId(m.checklist ?? m.code);
    const { data: md } = await db.from("audit_modules").insert({ programme_id: p.id, code: m.code, title: m.title, domain: m.domain ?? null, kind: m.kind ?? "internal", checklist_id: checklist, sort: sort++ }).select("id").single();
    if (b.attach_imported && checklist) { // the imported audits run with this checklist inside the cycle belong to this programme
      const { data: got } = await db.from("audits").update({ programme_id: p.id, module_id: md?.id ?? null, kind: m.kind ?? "internal", domain: m.domain ?? null }).eq("entity", b.entity).eq("checklist_id", checklist).is("programme_id", null).gte("planned_month", start).lte("planned_month", end).select("number");
      for (const g of (got ?? []) as { number: string }[]) out.push(`${m.code}: ${g.number} attached`);
    }
    for (const a of m.audits ?? []) {
      const month = monthStart(a.month);
      if (a.centrik_no) {
        const { data: au } = await db.from("audits").select("id,status").eq("entity", b.entity).eq("number", a.centrik_no).maybeSingle();
        if (au) { await db.from("audits").update({ programme_id: p.id, module_id: md?.id ?? null, checklist_id: checklist ?? undefined, planned_month: month, kind: a.kind ?? m.kind ?? "internal", domain: m.domain ?? null, subcontractor: a.subcontractor ?? (m.kind === "subcontractor" ? m.title : null) }).eq("id", au.id); out.push(`${m.code}: ${a.centrik_no} attached`); continue; }
        out.push(`${m.code}: ${a.centrik_no} not found — planned instead`);
      }
      const number = await nextAuditNumber(db, b.entity, Number(month.slice(0, 4)));
      const { data: na } = await db.from("audits").insert({ entity: b.entity, number, programme_id: p.id, module_id: md?.id ?? null, checklist_id: checklist, kind: a.kind ?? m.kind ?? "internal", domain: m.domain ?? null, title: a.title ?? `${m.code} — ${m.title}`, planned_month: month, planned_on: a.planned_on ?? null, subcontractor: m.kind === "subcontractor" ? m.title : null, authority: (a.kind ?? m.kind) === "authority" ? PROG_REF[b.entity]?.authority ?? null : null, created_by: s.person?.id ?? null }).select("id").single();
      if (na) await db.from("audit_events").insert({ audit_id: na.id, by: s.person?.id ?? null, kind: "planned", to_month: month, reason: `From the audit plan ${b.reference ?? ""}`.trim() });
      out.push(`${m.code}: ${number} planned ${month.slice(0, 7)}`);
    }
  }
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: b.entity, object_type: "audit_programme", object_id: p.id, action: "audit_programme_seeded", after: { modules: b.modules.length, lines: out.length } });
  return Response.json({ programme: p.id, lines: out });
}
