import type { NextRequest } from "next/server";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* AUD-02 · Import from Centrik (read-only mirror). POST {entity, step:"checklists", checklists:[{subsystem,no,name}]} then one POST {entity, step:"audit", audit:{…}} per audit
 * (client sends the most recent first). Checklist templates = the items of the most recent audit run with that checklist. Results kept as read. */
export const runtime = "nodejs";
export const maxDuration = 60;
type CItem = { code: string | null; title: string | null; ref: string; text: string; result: string | null; comment: string | null };
type CAudit = { subsystem: string; no: string; name: string; status?: string; due?: string; started?: string; completed?: string; lead?: string; auditors?: string; description?: string; completion?: string; breakdown?: string; sections: { title: string; items: CItem[] }[]; findings: { no: string; title: string; severity: string; phase: string; manager: string; close_by: string }[] };
const RESULT: Record<string, string> = { compliant: "conforming", conforming: "conforming", "partially compliant": "partial", "partially conforming": "partial", "not compliant": "non_conforming", "not conforming": "non_conforming", "non compliant": "non_conforming", "not applicable": "not_applicable", "n/a": "not_applicable", "not covered": "not_covered" };
const isRule = (c: string) => /^[A-Z]{1,4}(\.[A-Z0-9-]+)+$/i.test(c) || /^21\./.test(c) || /^Article \d+/i.test(c);
const dmy = (s?: string | null) => { const m = (s ?? "").match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const regKeyFor = (code: string, def: string) => /^IS\./i.test(code) ? "information-security" : /^(FCL|MED|ORA|ARA|ADR|CC|DTO)\./i.test(code) ? "aircrew" : /^(M|ML|CAMO|CAO|145|147|66|T)\./i.test(code) ? "continuing-airworthiness" : /^21\./.test(code) ? "initial-airworthiness" : /^(ORO|CAT|SPA|NCC|NCO|SPO|ARO|AMC|GM)\./i.test(code) || /^Article/i.test(code) ? "air-operations" : def;

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!(s.role === "cmm" || s.roles.map(basePost).some((r) => ["CMM", "SUPERADMIN"].includes(r)))) return Response.json({ error: "Compliance desk only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { entity?: string; step?: string; checklists?: { subsystem: string; no: string; name: string }[]; audit?: CAudit };
  const entity = body.entity ?? ""; if (!entity || (!s.group && !s.entities.includes(entity))) return Response.json({ error: "entity" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: regs } = await db.from("regulations").select("id,key,items_version");
  const reg = (key: string) => ((regs ?? []) as { id: string; key: string; items_version: string | null }[]).find((r) => r.key === key) ?? null;
  const { data: ppl } = await db.from("people").select("id,display_name").limit(800);
  const people = (ppl ?? []) as { id: string; display_name: string }[];
  // Centrik writes "JPJanssens, Pierre-Franck (Compliance and Safety)": initials glued to the surname, then first name(s)
  const person = (raw?: string | null) => { if (!raw) return null; const s0 = raw.replace(/\(.*?\)/g, "").trim().replace(/^[A-Z]{1,3}(?=[A-Z][a-z])/, ""); const [last, first] = s0.split(",").map((x) => x.trim().toLowerCase()); if (!last) return null;
    const firstTok = (first ?? "").split(/[\s-]+/).filter((x) => x.length > 2); return people.find((p) => { const n = p.display_name.toLowerCase(); return n.includes(last) && (!firstTok.length || firstTok.some((x) => n.includes(x))); })?.id ?? null; };
  const kindOf = (sub: string) => /authority|external/i.test(sub) ? "authority" : /third|subcontract|supplier/i.test(sub) ? "subcontractor" : /survey/i.test(sub) ? "checks" : "internal";
  const domainOf = (sub: string) => /CAMO/i.test(sub) ? "CAMO" : /OPS/i.test(sub) ? "OPS" : /ATO|FSTD/i.test(sub) ? "ATO" : null;
  const defRegKey = (sub: string) => (domainOf(sub) === "CAMO" ? "continuing-airworthiness" : "air-operations");

  if (body.step === "reset") { // start the templates again (imported audits stay: a new import updates them and rebuilds their checks)
    const { data: ic } = await db.from("checklists").select("id").eq("entity", entity).like("imported_from", "Centrik%");
    const cids = ((ic ?? []) as { id: string }[]).map((x) => x.id);
    if (cids.length) { await db.from("audits").update({ checklist_id: null }).in("checklist_id", cids); await db.from("audit_modules").update({ checklist_id: null }).in("checklist_id", cids); await db.from("audit_checks").update({ item_id: null }).in("item_id", (await db.from("checklist_items").select("id").in("checklist_id", cids)).data?.map((x) => (x as { id: string }).id) ?? ["00000000-0000-0000-0000-000000000000"]); await db.from("checklists").delete().in("id", cids); }
    return Response.json({ checklists_removed: cids.length });
  }
  if (body.step === "checklists") {
    // the schedule rows: "1 ORG" + name → checklist code ORG (last token with letters), title = name; one per (subsystem, no)
    const seen = new Set<string>(); let n = 0;
    for (const c of body.checklists ?? []) {
      const k = `${c.subsystem}|${c.no}`; if (seen.has(k) || !c.name) continue; seen.add(k);
      const tok = c.no.split(/\s+/).filter(Boolean); const code = (tok.find((t) => /[A-Z]/i.test(t) && !/^\d+$/.test(t)) ?? tok.join("")).toUpperCase().slice(0, 24);
      let code2 = code;
      const { data: ex } = await db.from("checklists").select("id,domain,imported_from").eq("entity", entity).eq("code", code).maybeSingle();
      if (ex && (ex as { domain: string | null }).domain !== domainOf(c.subsystem) && domainOf(c.subsystem)) { code2 = `${code}-${domainOf(c.subsystem)}`; }
      const { data: ex2 } = code2 !== code ? await db.from("checklists").select("id").eq("entity", entity).eq("code", code2).maybeSingle() : { data: ex };
      if (!ex2) { await db.from("checklists").insert({ entity, code: code2, title: c.name.slice(0, 200), domain: domainOf(c.subsystem), regulation_id: reg(defRegKey(c.subsystem))?.id ?? null, imported_from: `Centrik ${c.subsystem} · ${c.no}`, note: kindOf(c.subsystem) === "authority" ? "Authority / external checklist" : null, created_by: s.person?.id ?? null }); n++; }
    }
    return Response.json({ checklists: n });
  }
  const a = body.audit; if (!a) return Response.json({ error: "audit" }, { status: 400 });
  // the checklist of this audit: by name among the imported ones (same entity), else created from the audit name
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const toks = (x: string) => new Set(norm(x).split(" ").filter((t) => t.length > 2 && !["and", "the", "incl", "audit", "checklist", "with", "for"].includes(t)));
  const score = (x: string, y: string) => { const A = toks(x), B = toks(y); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.max(A.size, B.size); };
  const { data: clsFull } = await db.from("checklists").select("id,code,title,regulation_id,imported_from,domain").eq("entity", entity);
  type CL = { id: string; code: string; title: string; regulation_id: string | null; imported_from: string | null; domain?: string | null };
  const sameDom = ((clsFull ?? []) as CL[]).filter((c) => !c.domain || !domainOf(a.subsystem) || c.domain === domainOf(a.subsystem));
  let cl: CL | undefined = sameDom.find((c) => norm(c.title) === norm(a.name));
  if (!cl) { const ranked = sameDom.map((c) => ({ c, s: Math.max(score(c.title, a.name), norm(a.name).includes(norm(c.title)) || norm(c.title).includes(norm(a.name)) ? 0.8 : 0) })).filter((x) => x.s >= 0.5).sort((x, y) => y.s - x.s); cl = ranked[0]?.c; }
  if (!cl) {
    const code = a.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 24) || "CL";
    const { data } = await db.from("checklists").insert({ entity, code, title: a.name.slice(0, 200), domain: domainOf(a.subsystem), regulation_id: reg(defRegKey(a.subsystem))?.id ?? null, imported_from: `Centrik ${a.subsystem}`, created_by: s.person?.id ?? null }).select("id,code,title,regulation_id,imported_from").single();
    cl = data as CL;
  }
  const completed = dmy(a.completed), started = dmy(a.started), due = dmy(a.due);
  const defReg = reg(cl.regulation_id ? ((regs ?? []) as { id: string; key: string }[]).find((r) => r.id === cl!.regulation_id)?.key ?? defRegKey(a.subsystem) : defRegKey(a.subsystem));
  // template: replace the items when this audit is newer than the one the template came from
  const tplDate = (cl.imported_from ?? "").match(/items from .* \((\d{4}-\d{2}-\d{2})\)/)?.[1] ?? null;
  const newer = !tplDate || (completed ?? started ?? "0000") >= tplDate;
  const itemIdByKey = new Map<string, string>();
  if (newer && a.sections.some((sec) => sec.items.length)) {
    await db.from("checklist_items").delete().eq("checklist_id", cl.id);
    await db.from("checklist_sections").delete().eq("checklist_id", cl.id);
    let ord = 0, sord = 0;
    for (const sec of a.sections) {
      const { data: sd } = await db.from("checklist_sections").insert({ checklist_id: cl.id, ord: sord++, title: sec.title.slice(0, 200) }).select("id").single();
      const rows = sec.items.map((it) => { const code = (it.code ?? it.ref ?? "ITEM").trim(); const rule = isRule(code); const r = reg(regKeyFor(code, defReg?.key ?? "air-operations")); return { checklist_id: cl!.id, section_id: sd?.id ?? null, ord: ++ord, code: code.toUpperCase().slice(0, 60), ref: rule && !/^\d+$/.test(it.ref) ? `(${it.ref})` : null, regulation_id: rule ? r?.id ?? null : null, question: rule ? null : (it.text || it.title || "").slice(0, 500), guidance: null }; });
      if (rows.length) { const { data: ins } = await db.from("checklist_items").insert(rows).select("id,code,ref"); for (const x of (ins ?? []) as { id: string; code: string; ref: string | null }[]) itemIdByKey.set(`${x.code}|${x.ref ?? ""}`, x.id); }
    }
    await db.from("checklists").update({ imported_from: `Centrik ${a.subsystem} · items from ${a.no} (${completed ?? started ?? "n/a"})`, updated_at: new Date().toISOString() }).eq("id", cl.id);
  } else {
    const { data: ex } = await db.from("checklist_items").select("id,code,ref").eq("checklist_id", cl.id); for (const x of (ex ?? []) as { id: string; code: string; ref: string | null }[]) itemIdByKey.set(`${x.code}|${x.ref ?? ""}`, x.id);
  }
  // the audit itself (mirror): number = Centrik number
  const month = (started ?? completed ?? due ?? new Date().toISOString().slice(0, 10)).slice(0, 7) + "-01";
  const status = completed ? "closed" : /progress/i.test(a.status ?? a.subsystem) || started ? "in_progress" : "planned";
  const lead = person(a.lead);
  const note = [a.description ? `Centrik description: ${a.description}` : null, a.breakdown ? `Centrik breakdown: ${a.breakdown}` : null, a.findings?.length ? `Centrik findings: ${a.findings.map((f) => `${f.no} ${f.title} (${f.severity})`).join(" · ")}` : null].filter(Boolean).join("\n");
  const row = { entity, number: a.no.slice(0, 40), checklist_id: cl.id, kind: kindOf(a.subsystem), domain: domainOf(a.subsystem), title: a.name.slice(0, 200), planned_month: month, planned_on: started, planned_end: completed, started_on: started, done_on: completed, status, lead_auditor: lead, external_auditor: lead ? (a.auditors || null) : [a.lead, a.auditors].filter(Boolean).join(" · ") || null, authority: kindOf(a.subsystem) === "authority" ? (entity === "ASJMT" ? "TM-CAD" : entity === "ASTFR" ? "OSAC" : "DSAC") : null, note: note || null, imported_from: `Centrik ${a.subsystem} · ${a.no}`, closed_at: completed ? `${completed}T12:00:00Z` : null, created_by: s.person?.id ?? null };
  const { data: ex } = await db.from("audits").select("id").eq("entity", entity).eq("number", row.number).maybeSingle();
  let auditId = (ex as { id: string } | null)?.id ?? null;
  if (auditId) { await db.from("audits").update(row).eq("id", auditId); await db.from("audit_checks").delete().eq("audit_id", auditId); }
  else { const { data, error } = await db.from("audits").insert(row).select("id").single(); if (error) return Response.json({ error: error.message }, { status: 500 }); auditId = data.id; await db.from("audit_events").insert({ audit_id: auditId, kind: "planned", to_month: month, reason: `Imported from Centrik (${a.no})` }); }
  let ord = 0; const checks = [];
  for (const sec of a.sections) for (const it of sec.items) {
    const code = (it.code ?? it.ref ?? "ITEM").trim().toUpperCase().slice(0, 60); const rule = isRule(code); const ref = rule && !/^\d+$/.test(it.ref) ? `(${it.ref})` : null; const r = rule ? reg(regKeyFor(code, defReg?.key ?? "air-operations")) : null;
    const result = it.result ? RESULT[it.result.toLowerCase()] ?? null : null;
    checks.push({ audit_id: auditId, item_id: itemIdByKey.get(`${code}|${ref ?? ""}`) ?? null, ord: ++ord, section: sec.title.slice(0, 200), code, ref, regulation_id: r?.id ?? null, version: r?.items_version ?? null, question: rule ? null : (it.text || it.title || "").slice(0, 500), result, comment: it.comment, checked_at: completed ? `${completed}T12:00:00Z` : null, imported: { result: it.result, comment: it.comment, text: (it.text || "").slice(0, 1500), title: it.title } });
  }
  for (let i = 0; i < checks.length; i += 200) { const { error } = await db.from("audit_checks").insert(checks.slice(i, i + 200)); if (error) return Response.json({ error: error.message }, { status: 500 }); }
  return Response.json({ audit: a.no, checklist: cl.code, checks: checks.length, template: newer });
}
