// SAF-04 Safety performance indicators — server side: monthly values computed from S.A.M. records, entered values, SPI board.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { METRICS, aggOf, judge, proRata, valueOver, type Cell, type SpiDef, type Target, type Verdict } from "@/lib/spi-shared";
import type { Session } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";

export * from "@/lib/spi-shared";

/** Who maintains SPIs (targets, monthly data): the safety desk. NPs and the AM read them. */
export const mayEditSpi = (s: Session) => isSafetyDesk(s);

const ym = (d: string | Date) => (typeof d === "string" ? d : d.toISOString()).slice(0, 7);
export function monthsOf(year: number, upTo?: string): string[] {
  const out: string[] = []; for (let m = 1; m <= 12; m++) { const k = `${year}-${String(m).padStart(2, "0")}`; if (upTo && k > upTo) break; out.push(k); } return out;
}
const monthEnd = (k: string) => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString(); }; // exclusive

type Rep = { id: string; received_at: string; closed_at: string | null; status: string; report_type: string | null; occurrence_class: string | null; headline: string; event_type: string | null; risk_category: string | null; anonymous: boolean; feedback_sent_at: string | null; feedback: string | null; mor_filed_at: string | null; source: string | null; source_erc: number | null; a: { mor_status: string | null; erc_value: number | null } | null };

/** Monthly cells of every computed metric, for the given months (YYYY-MM, ascending). */
export async function computedMetrics(entity: string, months: string[]): Promise<Record<string, Cell[]>> {
  const db = supabaseAdmin(); const end = monthEnd(months[months.length - 1]);
  const [{ data: rr }, { data: ra }, { data: acts }] = await Promise.all([
    db.from("reports").select("id,received_at,closed_at,status,report_type,occurrence_class,headline,event_type,risk_category,anonymous,feedback_sent_at,feedback,mor_filed_at,source,source_erc,report_analysis(mor_status,erc_value)").eq("entity", entity).lt("received_at", end).limit(5000),
    db.from("risk_assessments").select("id,kind,status,conducted_on,start_date,created_at,source").eq("entity", entity).limit(3000),
    db.from("safety_actions").select("due,status,created_at,done_at,verified_at").eq("entity", entity).eq("module", "safety").limit(5000),
  ]);
  const { data: meets } = await db.from("committees").select("kind,status,planned_on,starts_at").eq("entity", entity).in("status", ["held", "closed"]).limit(2000);
  const reps: Rep[] = ((rr ?? []) as unknown as (Omit<Rep, "a"> & { report_analysis: Rep["a"] | Rep["a"][] })[])
    .map((r) => ({ ...r, a: Array.isArray(r.report_analysis) ? r.report_analysis[0] ?? null : r.report_analysis }))
    .filter((r) => !/^\s*test\b/i.test(r.headline));
  const logIds = ((ra ?? []) as { id: string; kind: string }[]).filter((x) => x.kind === "hazard_log").map((x) => x.id);
  const { data: hz } = logIds.length ? await db.from("hazards").select("id,created_at,assessment_id,source_ref,proposed").in("assessment_id", logIds).limit(5000) : { data: [] };
  const hzIds = ((hz ?? []) as { id: string }[]).map((h) => h.id);
  const { data: links } = hzIds.length ? await db.from("hazard_reports").select("hazard_id,reports(received_at)").in("hazard_id", hzIds).limit(10000) : { data: [] };
  const firstReport = new Map<string, string>();
  for (const l of (links ?? []) as unknown as { hazard_id: string; reports: { received_at: string } | { received_at: string }[] | null }[]) {
    const r = Array.isArray(l.reports) ? l.reports[0] : l.reports; if (!r) continue;
    const was = firstReport.get(l.hazard_id); if (!was || r.received_at < was) firstReport.set(l.hazard_id, r.received_at);
  }
  const raById = new Map(((ra ?? []) as { id: string; conducted_on: string | null }[]).map((x) => [x.id, x]));

  const idx = new Map(months.map((m, i) => [m, i]));
  const zero = (): Cell[] => months.map(() => ({ num: 0, den: null, src: "sam" as const }));
  const out: Record<string, Cell[]> = {};
  for (const k of Object.keys(METRICS)) out[k] = zero();
  const ratio: Record<string, { num: number[]; den: number[] }> = {};
  for (const [k, m] of Object.entries(METRICS)) if (m.kind === "ratio") ratio[k] = { num: months.map(() => 0), den: months.map(() => 0) };
  const inc = (k: string, i: number | undefined) => { if (i != null) out[k][i]!.num++; };
  const rat = (k: string, i: number | undefined, hit: boolean) => { if (i == null) return; ratio[k].den[i]++; if (hit) ratio[k].num[i]++; };
  const T = (r: Rep) => (r.report_type ?? "").toUpperCase();
  const text = (r: Rep) => `${r.headline} ${r.report_type ?? ""} ${r.event_type ?? ""} ${r.risk_category ?? ""}`.toLowerCase();

  for (const r of reps) {
    const i = idx.get(ym(r.received_at)); const oc = (r.occurrence_class ?? "").toLowerCase(); const t = T(r); const tx = text(r);
    if (i != null) {
      inc("reports", i);
      if (r.a?.mor_status === "mandatory") inc("mor", i);
      if ((r.a?.erc_value ?? r.source_erc ?? 0) >= 100) inc("significant", i);
      const isSi = /serious/.test(oc); const isAcc = /accident/.test(oc) && !isSi;
      if (isAcc) inc("acc", i); if (isSi) inc("si", i); if (isAcc || isSi) inc("acc_si", i);
      if (t === "HAZ" || /hazard report/i.test(t)) inc("type_haz", i);
      if (t === "DGR") inc("type_dgr", i);
      if (t === "FAT" || /fatigue/i.test(r.headline)) inc("type_fat", i);
      if (/bird|wildlife/.test(tx)) inc("kw_bird", i);
      if (/tcas\s*-?\s*ra\b|resolution advisory/.test(tx)) inc("kw_tcas", i);
      if (/laser/.test(tx)) inc("kw_laser", i);
      rat("anon_pct", i, r.anonymous);
      rat("dexres_pct", i, t === "DEX" || t === "RES");
      rat("tech_pct", i, t === "ESR" || t === "MSR");
      if ((r.source ?? "sam") === "sam" && r.a?.mor_status === "mandatory") rat("mor_72h", i, !!r.mor_filed_at && new Date(r.mor_filed_at).getTime() - new Date(r.received_at).getTime() <= 72 * 3600e3);
    }
    if (r.closed_at) {
      const j = idx.get(ym(r.closed_at));
      rat("closed90_pct", j, new Date(r.closed_at).getTime() - new Date(r.received_at).getTime() <= 90 * 864e5);
      if ((r.source ?? "sam") === "sam") rat("feedback_pct", j, !!(r.feedback_sent_at || r.feedback));
    }
  }
  months.forEach((m, i) => { // snapshots at month end
    const e = new Date(monthEnd(m)).getTime();
    out.open90[i]!.num = reps.filter((r) => new Date(r.received_at).getTime() < e - 90 * 864e5 && (!r.closed_at ? r.status !== "closed" : new Date(r.closed_at).getTime() >= e)).length;
    out.actions_late[i]!.num = ((acts ?? []) as { due: string | null; status: string; created_at: string; done_at: string | null; verified_at: string | null }[])
      .filter((a) => a.status !== "cancelled" && a.due && new Date(a.created_at).getTime() < e && new Date(a.due).getTime() + 864e5 <= e && !((a.done_at ?? a.verified_at) && new Date((a.done_at ?? a.verified_at)!).getTime() < e)).length;
  });
  for (const x of (ra ?? []) as { kind: string; status: string; conducted_on: string | null; start_date: string | null; created_at: string; source: string }[]) {
    if (x.status === "cancelled" || x.kind === "hazard_log") continue;
    const d = x.kind === "moc" ? x.start_date ?? x.conducted_on : x.conducted_on; const when = d ?? (x.source === "sam" ? x.created_at : null);
    if (when) inc(x.kind === "moc" ? "moc_count" : "ra_count", idx.get(ym(when)));
  }
  for (const h of (hz ?? []) as { id: string; created_at: string; assessment_id: string; source_ref: string | null; proposed: boolean }[]) {
    if (h.proposed) continue; // identified through reporting = its first linked report; else the date of the log entry
    const when = firstReport.get(h.id) ?? (h.source_ref ? raById.get(h.assessment_id)?.conducted_on ?? null : h.created_at);
    if (when) inc("new_hazards", idx.get(ym(when)));
  }
  for (const c of (meets ?? []) as { kind: string; planned_on: string | null; starts_at: string | null }[]) {
    const when = c.starts_at ?? c.planned_on; if (!when) continue; const i = idx.get(ym(when));
    inc("meetings", i); if (c.kind === "srb") inc("meetings_srb", i);
  }
  for (const [k, v] of Object.entries(ratio)) out[k] = months.map((_, i) => (v.den[i] ? { num: v.num[i], den: v.den[i], src: "sam" as const } : null));
  return out;
}

export type SpiRow = SpiDef & { t?: Target; cells: Cell[]; monthVerdicts: (Verdict | null)[]; quarter: number | null; quarterVerdict: Verdict; ytd: number | null; ytdVerdict: Verdict; ytdTarget?: Target; offTwice: boolean };
export type Board = { months: string[]; activity: Record<string, (number | null)[]>; rows: SpiRow[]; upTo: string; quarter: number };

/** The SPI board of an entity for a year: every SPI, its months, the current quarter, the year to date, and its verdicts. */
export async function spiBoard(entity: string, year: number, opts: { includeProposed?: boolean } = {}): Promise<Board> {
  const db = supabaseAdmin();
  const now = new Date(); const cur = ym(now);
  const upTo = year < now.getUTCFullYear() ? `${year}-12` : cur;
  const months = monthsOf(year, upTo);
  const all12 = monthsOf(year);
  const [{ data: defs }, { data: data }] = await Promise.all([
    db.from("spi_defs").select("*").eq("entity", entity).neq("status", "retired").order("sort"),
    db.from("spi_data").select("key,month,value,den").eq("entity", entity).gte("month", `${year}-01-01`).lte("month", `${year}-12-31`),
  ]);
  const D = ((defs ?? []) as SpiDef[]).filter((d) => opts.includeProposed !== false || d.status === "active");
  const ids = D.map((d) => d.id);
  const { data: tg } = ids.length ? await db.from("spi_targets").select("spi_id,target,alert,note").eq("year", year).in("spi_id", ids) : { data: [] };
  const tOf = new Map(((tg ?? []) as (Target & { spi_id: string })[]).map((t) => [t.spi_id, t]));
  const entered: Record<string, Cell[]> = {};
  for (const r of (data ?? []) as { key: string; month: string; value: number; den: number | null }[]) {
    const i = all12.indexOf(r.month.slice(0, 7)); if (i < 0) continue;
    (entered[r.key] ??= all12.map(() => null))[i] = { num: Number(r.value), den: r.den == null ? null : Number(r.den), src: "entered" };
  }
  const computed = months.length ? await computedMetrics(entity, months) : {};
  const activity: Record<string, (number | null)[]> = {}; for (const k of ["bh", "fh", "flights"]) activity[k] = all12.map((_, i) => entered[k]?.[i]?.num ?? null);
  const q = Math.floor((Number(upTo.slice(5)) - 1) / 3); // current quarter index 0..3
  const rows: SpiRow[] = D.map((d) => {
    const t = tOf.get(d.id);
    const cells: Cell[] = all12.map((_, i) => entered[`spi:${d.code}`]?.[i] ?? (i < months.length && d.metric ? computed[d.metric]?.[i] ?? null : null));
    const act = d.basis.includes("bh") ? activity.bh : d.basis.includes("fh") ? activity.fh : d.basis.includes("flights") ? activity.flights : all12.map(() => null);
    const pm = d.period === "year" ? 12 : d.period === "quarter" ? 3 : 1;
    const judgeMonth = pm === 1 || d.basis !== "count" || aggOf(d) !== "sum"; // a count set per quarter / year is not judged month by month
    const monthVerdicts = all12.map((_, i) => (i >= months.length || !judgeMonth ? null : judge(valueOver(d, [cells[i]], [act[i]]), d.direction, t)));
    const qs = q * 3, qe = Math.min(qs + 3, months.length);
    const quarter = valueOver(d, cells.slice(qs, qe), act.slice(qs, qe));
    const quarterT = d.period === "year" ? proRata(d, t, 3 * (q + 1), 12) : d.period === "quarter" ? proRata(d, t, qe - qs, 3) : d.basis === "count" && aggOf(d) === "sum" && t?.target != null ? { ...t, target: t.target * (qe - qs), alert: t.alert == null ? null : t.alert * (qe - qs) } : t;
    const ytd = valueOver(d, cells.slice(0, months.length), act.slice(0, months.length));
    const withData = cells.slice(0, months.length).filter(Boolean).length; // a count set per month / quarter is expected for the months that have data
    const f = d.period === "quarter" ? withData / 3 : withData;
    const ytdTarget = d.basis !== "count" || aggOf(d) !== "sum" ? t : d.period === "year" ? proRata(d, t, months.length, 12) : t?.target == null ? t : { ...t, target: Math.round(t.target * f * 10) / 10, alert: t.alert == null ? null : Math.round(t.alert * f * 10) / 10 };
    const lastTwo = monthVerdicts.slice(0, months.length).filter((v) => v != null).slice(-2);
    return { ...d, t, cells, monthVerdicts, quarter, quarterVerdict: judge(quarter, d.direction, quarterT), ytd, ytdVerdict: judge(ytd, d.direction, ytdTarget), ytdTarget, offTwice: lastTwo.length === 2 && lastTwo.every((v) => v === "improve" || v === "far") };
  });
  return { months: all12, activity, rows, upTo, quarter: q + 1 };
}
