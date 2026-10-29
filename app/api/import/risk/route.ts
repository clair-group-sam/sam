import { NextResponse, after, type NextRequest } from "next/server";
import { normEntity } from "@/lib/entity-codes";
import { matchPending } from "@/lib/risk-match";
import { createHash } from "crypto";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nextHazardRef, schemeOf, tolerability } from "@/lib/risk";

/**
 * Import of existing risk assessments (Centrik ASJ / AJD Risk, FlightLogger, ASF MOC forms) — read in the source tool by an
 * export script and posted here. Auth: a Compliance session, or a one-time import key from Settings › Integrations (30 min).
 * Idempotent: an assessment is matched on (source, source_ref) or (entity, number), a hazard on (assessment, source_ref);
 * re-importing updates them and replaces their mitigations.
 */
export const runtime = "nodejs";
export const maxDuration = 300;
const ALLOWED = [/^https:\/\/[a-z0-9-]+\.centrik\.net$/, /^https:\/\/[a-z0-9-]+\.flightlogger\.net$/];
const cors = (req: NextRequest): Record<string, string> => { const o = req.headers.get("origin") ?? ""; return ALLOWED.some((r) => r.test(o)) ? { "access-control-allow-origin": o, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-allow-credentials": "true", "access-control-max-age": "600" } : {}; };
export function OPTIONS(req: NextRequest) { return new NextResponse(null, { status: 204, headers: cors(req) }); }

type InH = { source_ref?: string; title: string; description?: string; consequence?: string; main_impact?: string; lik_before?: number; sev_before?: string; lik_after?: number; sev_after?: string; current?: string[]; planned?: { text: string; owner_role?: string }[] | string[]; status?: string };
type InA = { number: string; kind?: string; name: string; description?: string; domain?: string; status?: string; decision?: string; decision_comment?: string; top_risk?: boolean; version?: number; conducted_on?: string; next_due?: string; signed_by_name?: string; signed_by_role?: string; signed_at?: string; accepted_by_name?: string; accepted_at?: string; participants?: { name: string; role: string }[]; source_ref?: string;
  moc_status?: string; category?: string; change_type?: string; start_date?: string; end_date?: string; reason?: string; requestor?: string; affected?: string; criticality?: string; prior_assessments?: string; actions_in_place?: string; authority_route?: string; hazards?: InH[] };

/** Centrik shows people as "<initials><Surname>, <Given> (<Department>)" → ["Given Surname", "Department"]. */
const person = (n?: string | null): [string | null, string | null] => {
  if (!n || n === "-") return [null, null];
  const m = /^([A-Z]+[^,]*),\s*([^(]+?)\s*(?:\((.*)\))?$/.exec(n.trim()); if (!m) return [n, null];
  const sw = m[1].trim().split(/\s+/).length, gw = m[2].trim().split(/\s+/).length, ini = m[1].trim().slice(0, sw + gw), sur = m[1].trim().slice(sw + gw);
  return /^[A-Z]+$/.test(ini) && sur ? [`${m[2].trim()} ${sur}`, m[3] ?? null] : [n, m[3] ?? null];
};
const redLeft = (a: InA, entity: string) => (a.hazards ?? []).some((h) => tolerability(h.lik_after ?? h.lik_before ?? null, h.sev_after ?? h.sev_before ?? null, schemeOf(entity)) === "intolerable");
export async function POST(req: NextRequest) {
  const headers = cors(req);
  const db = supabaseAdmin();
  let actor: string | null = null;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer) {
    const { data: t } = await db.from("import_tokens").select("token_hash,expires_at,created_by,used_count").eq("token_hash", createHash("sha256").update(bearer).digest("hex")).maybeSingle();
    const tok = t as { token_hash: string; expires_at: string; created_by: string | null; used_count: number } | null;
    if (!tok || tok.expires_at < new Date().toISOString()) return NextResponse.json({ error: "Import key unknown or expired — create a new one in Settings › Integrations." }, { status: 401, headers });
    actor = tok.created_by;
    await db.from("import_tokens").update({ used_count: tok.used_count + 1 }).eq("token_hash", tok.token_hash);
  } else {
    const s = await getSession();
    if (!s || s.role !== "cmm") return NextResponse.json({ error: "Reserved to Compliance." }, { status: 403, headers });
    actor = s.person?.id ?? null;
  }
  const body = (await req.json().catch(() => null)) as { entity?: string; source?: string; assessments?: InA[] } | null;
  const entity = normEntity(body?.entity ?? "") ?? ""; const source = body?.source ?? "";
  if (!["ASFFR", "ASJFR", "ASJMT", "ASTFR"].includes(entity) || !["centrik", "flightlogger", "excel", "word"].includes(source) || !Array.isArray(body?.assessments)) return NextResponse.json({ error: "entity, source and assessments[] expected" }, { status: 400, headers });
  const okL = (x?: number) => (x && x >= 1 && x <= 5 ? Math.round(x) : null); const okS = (x?: string) => (x && /^[A-E]$/.test(x) ? x : null);
  const d = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
  let na = 0, nh = 0; const errors: string[] = [];
  for (const a of body!.assessments!) {
    try {
      const kind = ["hazard_log", "moc", "ra"].includes(a.kind ?? "") ? a.kind! : /^HZ/i.test(a.number) ? "hazard_log" : /^MOC/i.test(a.number) ? "moc" : "ra";
      const signed = a.status === "signed_off" || !!a.signed_at;
      const row: Record<string, unknown> = { entity, kind, number: a.number.trim(), name: a.name.trim(), description: a.description ?? null, domain: a.domain ?? null, status: a.status === "archived" ? "archived" : signed ? (redLeft(a, entity) && a.decision !== "stop" && !a.accepted_at ? "validated" : "accepted") : "draft", // MSM: signed by the NP / SM = accepted; red residual without an AM decision → waiting for the AM
        decision: a.decision && ["continue", "continue_with_conditions", "stop"].includes(a.decision) ? a.decision : null, decision_comment: a.decision_comment ?? null, top_risk: !!a.top_risk, version: a.version ?? 1, conducted_on: d(a.conducted_on), next_due: d(a.next_due),
        participants: (a.participants ?? []).map((p) => { const [nm, dep] = person(p.name); return { name: nm ?? p.name, role: p.role || dep || "" }; }), validated_name: signed ? person(a.signed_by_name)[0] : null, validated_role: signed ? a.signed_by_role ?? person(a.signed_by_name)[1] : null, validated_at: signed ? (d(a.signed_at) ?? null) : null, accepted_name: a.accepted_by_name ?? null, accepted_at: d(a.accepted_at),
        moc_status: kind === "moc" ? (a.moc_status ?? (signed ? "approved" : "assessment")) : null, category: a.category ?? null, change_type: a.change_type ?? null, start_date: d(a.start_date), end_date: d(a.end_date), reason: a.reason ?? null, requestor: a.requestor ?? null,
        affected: a.affected ?? null, criticality: a.criticality ?? null, prior_assessments: a.prior_assessments ?? null, actions_in_place: a.actions_in_place ?? null, authority_route: a.authority_route ?? null, source, source_ref: a.source_ref ?? null, updated_at: new Date().toISOString() };
      let q = db.from("risk_assessments").select("id").eq("entity", entity).eq("number", row.number as string);
      if (a.source_ref) q = db.from("risk_assessments").select("id").eq("source", source).eq("source_ref", a.source_ref);
      const { data: ex } = await q.maybeSingle();
      let raId = (ex as { id: string } | null)?.id;
      if (raId) await db.from("risk_assessments").update(row).eq("id", raId);
      else { const { data: ins, error } = await db.from("risk_assessments").insert({ ...row, created_by: actor }).select("id").single(); if (error) throw new Error(error.message); raId = (ins as { id: string }).id; await db.from("risk_events").insert({ assessment_id: raId, kind: "imported", actor, note: `Imported from ${source}` }); }
      na++;
      for (const [i, h] of (a.hazards ?? []).entries()) {
        const sref = h.source_ref ?? `${a.number}#${i + 1}`;
        const hrow = { entity, title: h.title.slice(0, 300), description: h.description ?? null, consequence: h.consequence ?? null, main_impact: h.main_impact ?? null, lik_before: okL(h.lik_before), sev_before: okS(h.sev_before), lik_after: okL(h.lik_after), sev_after: okS(h.sev_after),
          status: h.status === "archived" ? "closed" : "open", source: kind === "moc" ? "moc" : "other", assessment_id: raId, source_ref: sref, proposed: false, review_date: d(a.next_due), updated_at: new Date().toISOString() };
        const { data: hx } = await db.from("hazards").select("id").eq("assessment_id", raId).eq("source_ref", sref).maybeSingle();
        let hid = (hx as { id: string } | null)?.id;
        if (hid) await db.from("hazards").update(hrow).eq("id", hid);
        else { const ref = await nextHazardRef(db, entity); const { data: hi, error } = await db.from("hazards").insert({ ...hrow, ref, created_by: actor }).select("id").single(); if (error) throw new Error(error.message); hid = (hi as { id: string }).id; }
        await db.from("hazard_mitigations").delete().eq("hazard_id", hid);
        const mit = [...(h.current ?? []).filter(Boolean).map((t) => ({ hazard_id: hid, text: t, existing: true })),
          ...(h.planned ?? []).map((p) => (typeof p === "string" ? { text: p } : p)).filter((p) => p.text && p.text !== "-").map((p) => ({ hazard_id: hid, text: p.text, existing: false, owner_role: (p as { owner_role?: string }).owner_role ?? null }))];
        if (mit.length) await db.from("hazard_mitigations").insert(mit);
        nh++;
      }
    } catch (e) { errors.push(`${a.number}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // hazards of imported MOC / RA: SAM checks which ones are already in the hazard log (suggestions on Safety › To match)
  if (body.assessments.some((a: InA) => (a.kind ?? "") !== "hazard_log" && !/^HZ/i.test(a.number))) after(() => matchPending(entity, actor).then(() => {}, () => {}));
  return NextResponse.json({ ok: true, assessments: na, hazards: nh, errors }, { headers });
}
