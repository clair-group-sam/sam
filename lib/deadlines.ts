import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_STAGES, ballOf, today, type Stage } from "@/lib/authority";
import { OPEN_STATUSES as FND_OPEN, CMM_TURN } from "@/lib/findings";

/* DUE-01 · One calendar for every dated commitment S.A.M. holds (idea taken from the CAA point of 16/11): CAA applications, findings,
 * safety actions, MOR follow-up and final reports, audits of the programme, recurring compliance checks, regulatory watch entries,
 * certificates and validities, programme reviews, boards. Each one: when, what, whose turn, who, and the page behind it. */
export type DueKind = "file" | "finding" | "action" | "mor" | "audit" | "check" | "watch" | "certificate" | "review" | "board";
export const DUE_KIND: Record<DueKind, { label: string; plural: string }> = {
  file: { label: "CAA application", plural: "CAA applications" }, finding: { label: "Finding", plural: "Findings" }, action: { label: "Safety action", plural: "Safety actions" },
  mor: { label: "MOR follow-up", plural: "MOR follow-ups" }, audit: { label: "Audit", plural: "Audits" }, check: { label: "Compliance check", plural: "Compliance checks" },
  watch: { label: "Regulatory watch", plural: "Regulatory watch" }, certificate: { label: "Certificate", plural: "Certificates & validities" }, review: { label: "Programme review", plural: "Programme reviews" }, board: { label: "Board", plural: "Boards" },
};
export type Due = { key: string; kind: DueKind; entity: string; date: string; days: number; state: "late" | "soon" | "later"; ref: string; title: string; todo: string; who: string | null; ball: "us" | "authority" | null; href: string };
const addDays = (d: string, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthEnd = (m: string) => { const x = new Date(m.slice(0, 7) + "-01T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); };

export async function loadDeadlines(db: SupabaseClient, entities: string[], opts: { from?: string; to?: string; kinds?: DueKind[] } = {}): Promise<Due[]> {
  const t0 = today(); const from = opts.from ?? addDays(t0, -120); const to = opts.to ?? addDays(t0, 180);
  const want = (k: DueKind) => !opts.kinds?.length || opts.kinds.includes(k);
  const none = Promise.resolve({ data: [] as unknown[] });
  const [fil, fnd, act, rep, aud, chk, wat, cer, prg, brd] = await Promise.all([
    want("file") ? db.from("authority_files").select("id,entity,title,stage,target_date,portal_ref,authority,owner_role,next_task,next_owner,ball_override").in("entity", entities).in("stage", OPEN_STAGES).not("target_date", "is", null) : none,
    want("finding") ? db.from("findings").select("id,entity,number,title,status,due,level,authority,source,owner_role").in("entity", entities).in("status", FND_OPEN).not("due", "is", null) : none,
    want("action") ? db.from("safety_actions").select("id,entity,number,title,status,due,owner_role").in("entity", entities).in("status", ["open", "in_progress"]).not("due", "is", null) : none,
    want("mor") ? db.from("reports").select("id,entity,headline,headline_en,mor_filed_at,mor_followup_at,mor_final_at,mor_ref,history,status").in("entity", entities).not("mor_filed_at", "is", null).gte("mor_filed_at", addMonths(t0, -5)).is("mor_final_at", null) : none,
    want("audit") ? db.from("audits").select("id,entity,number,title,status,planned_month,kind").in("entity", entities).in("status", ["planned", "report"]).not("planned_month", "is", null) : none,
    want("check") ? db.from("compliance_checks").select("id,entity,code,title,next_due,active").in("entity", entities).eq("active", true).not("next_due", "is", null) : none,
    want("watch") ? db.from("watch_entries").select("id,entity,number,title,due,status,owner_role").in("entity", entities).in("status", ["open", "in_progress"]).not("due", "is", null) : none,
    want("certificate") ? db.from("certificates").select("id,entity,kind,title,registration,valid_until,archived_at").in("entity", entities).is("archived_at", null).not("valid_until", "is", null) : none,
    want("review") ? db.from("audit_programmes").select("id,entity,title,next_review_on,status").in("entity", entities).eq("status", "approved").not("next_review_on", "is", null) : none,
    want("board") ? db.from("committees").select("id,entity,entities,number,title,planned_on,status").overlaps("entities", entities).eq("status", "planned").not("planned_on", "is", null) : none,
  ]);
  type R = Record<string, string | null> & { entities?: string[] | null; history?: unknown };
  const rows = (x: { data: unknown }) => (x.data ?? []) as R[];
  const out: Due[] = [];
  const push = (kind: DueKind, entity: string, date: string | null, id: string, ref: string, title: string, todo: string, who: string | null, ball: Due["ball"], href: string) => {
    if (!date) return; const d = date.slice(0, 10); if (d < from || d > to) return;
    const days = Math.round((new Date(d).getTime() - new Date(t0).getTime()) / 86_400_000);
    out.push({ key: `${kind}:${id}:${d}`, kind, entity, date: d, days, state: days < 0 ? "late" : days < 15 ? "soon" : "later", ref, title, todo, who, ball, href });
  };
  for (const f of rows(fil)) { const b = ballOf({ stage: f.stage as Stage, ball_override: f.ball_override as "us" | "authority" | null });
    push("file", f.entity!, f.target_date, f.id!, f.portal_ref ?? "CAA file", f.title ?? "", f.next_task ?? (b === "authority" ? `Waiting for ${f.authority ?? "the authority"}` : f.stage === "remarks" ? "Answer the authority's remarks" : "Prepare and submit"), f.next_owner ?? f.owner_role, b, `/proj/auth/${f.id}`); }
  for (const f of rows(fnd)) { const cmm = CMM_TURN.includes(f.status ?? ""); const auth = f.source === "authority";
    push("finding", f.entity!, f.due, f.id!, f.number ?? "", f.title ?? "", cmm ? "Compliance to review the answer" : f.status === "accepted" ? "Carry out the plan, then request closure" : `Answer due${auth && f.authority ? ` at ${f.authority}` : ""}`, cmm ? "CMM" : f.owner_role, "us", `/comp/find/${f.id}`); }
  for (const a of rows(act)) push("action", a.entity!, a.due, a.id!, a.number ?? "", a.title ?? "", a.status === "in_progress" ? "In progress, to finish with its evidence" : "To do", a.owner_role, "us", `/safe/actions/${a.id}`);
  for (const r of rows(rep)) { if (r.history) continue; const filed = r.mor_filed_at!.slice(0, 10); const t = r.headline_en || r.headline || "";
    if (!r.mor_followup_at) push("mor", r.entity!, addDays(filed, 30), r.id! + "f", r.mor_ref ?? r.id!, t, "Follow-up report to the authority, 30 days after filing (376/2014 art. 13(4))", "SM", "us", `/safe/reports/${r.id}`);
    push("mor", r.entity!, addMonths(filed, 3), r.id! + "z", r.mor_ref ?? r.id!, t, "Final report to the authority, 3 months after filing (376/2014 art. 13(4))", "SM", "us", `/safe/reports/${r.id}`); }
  for (const a of rows(aud)) push("audit", a.entity!, monthEnd(a.planned_month!), a.id!, a.number ?? "", a.title ?? "", a.status === "planned" ? `To carry out in ${a.planned_month!.slice(0, 7)}` : "Report to issue", a.kind === "authority" ? "Authority" : "CMM", a.kind === "authority" ? "authority" : "us", `/comp/audits/${a.id}`);
  for (const c of rows(chk)) push("check", c.entity!, c.next_due, c.id!, c.code ?? "", c.title ?? "", "Recurring check to carry out", "CMM", "us", `/comp/checks`);
  for (const w of rows(wat)) push("watch", w.entity!, w.due, w.id!, w.number ?? "", w.title ?? "", "Impact analysis to return", w.owner_role, "us", `/comp/watch/${w.id}`);
  for (const c of rows(cer)) push("certificate", c.entity!, c.valid_until, c.id!, c.registration ? `${c.kind} ${c.registration}` : c.kind ?? "", c.title ?? "", "Valid until this date: renew before", null, "us", `/docs/files?entity=${c.entity}`);
  for (const p of rows(prg)) push("review", p.entity!, p.next_review_on, p.id!, "Programme", p.title ?? "", "Annual review of the audit programme", "CMM", "us", `/comp/prog/${p.id}`);
  for (const b of rows(brd)) for (const e of (b.entities?.length ? b.entities : [b.entity!]).filter((x) => entities.includes(x))) push("board", e, b.planned_on, b.id! + e, b.number ?? "", b.title ?? "", "Board planned: prepare the pack", "SM", "us", `/safe/comm/${b.id}`);
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.entity.localeCompare(b.entity));
}
export function dueCounts(ds: Due[]) { return { total: ds.length, late: ds.filter((d) => d.state === "late").length, lateOurs: ds.filter((d) => d.state === "late" && d.ball !== "authority").length, soon: ds.filter((d) => d.state === "soon").length, next: ds.find((d) => d.days >= 0) ?? null }; }
