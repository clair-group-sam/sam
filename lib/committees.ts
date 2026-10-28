// SAF-05 Committees: Safety Review Board (SRB) and Safety Action Group (SAG) — agenda from the MSM, attendees from the posts,
// the figures presented (pack), notes and decisions per item, actions raised in the meeting, minutes.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { spiBoard, fmt, targetText, VERDICT } from "@/lib/spi";
import { isSafetyDesk } from "@/lib/safety";
import { riskLabel, schemeOf, tolerability } from "@/lib/risk-shared";
import type { Session } from "@/lib/session";

export type Attendee = { name: string; role: string | null; person_id: string | null; present: boolean | null; note?: string | null };
export type Item = { key: string; title: string; ref?: string | null; notes?: string | null; decision?: string | null };
export type Committee = { id: string; entity: string; kind: "srb" | "sag"; number: string; title: string; topic: string | null; status: string; planned_on: string | null; starts_at: string | null; ends_at: string | null; location: string | null; attendees: Attendee[]; agenda: Item[]; pack: Pack | null; pack_at: string | null; minutes: string | null; minutes_model: string | null; parent_id: string | null; closed_at: string | null; source: string; source_ref: string | null; source_url: string | null; created_at: string };

export const STATUS: Record<string, [string, string]> = { planned: ["Planned", "blue"], held: ["Held — minutes to issue", "amber"], closed: ["Minutes issued", "green"], cancelled: ["Cancelled", ""] };
/** Safety desk organises (SM / CMM / FSO); the AM chairs the SRB. */
export const mayRun = (s: Session) => isSafetyDesk(s);
export const kindName = (entity: string, kind: string) => kind === "sag" ? "Safety Action Group" : entity === "ASF" ? "Compliance & safety review committee (CODIR)" : "Safety Review Board";
export const kindShort = (entity: string, kind: string) => kind === "sag" ? "SAG" : entity === "ASF" ? "CODIR" : "SRB";

/** Minimum frequency of the review board (MSM): AJD / ASJ ≥ 2 per calendar year (§4.5) · ASF ≥ 1 per quarter (§4.2). */
export const CADENCE: Record<string, { perYear: number; label: string; ref: string }> = {
  AJD: { perYear: 2, label: "at least twice per calendar year, at regular intervals", ref: "MSM §4.5" },
  ASJ: { perYear: 2, label: "at least twice per calendar year, at regular intervals", ref: "MSM §4.5" },
  ASF: { perYear: 4, label: "at least once per quarter, within the CODIR", ref: "MSM §4.2" },
  TEC: { perYear: 1, label: "at least once a year (management review)", ref: "MOE" },
};

/** Standing agenda — AJD / ASJ MSM §4.5 (+ §2.6: the compliance review committee is held during the SRB), ASF MSM §4.2. */
export function agendaFor(entity: string, kind: string, topic?: string | null): Item[] {
  if (kind === "sag") return [
    { key: "topic", title: `Topic — ${topic ?? "to define"}`, ref: "MSM §4.6" },
    { key: "events", title: "Occurrences, trends and findings behind the topic" },
    { key: "open_actions", title: "Open actions on the topic — update, close or re-plan" },
    { key: "new_actions", title: "New actions to mitigate, manage or prevent (owner, due date)" },
    { key: "to_srb", title: "Outputs to report to the next SRB" },
  ];
  if (entity === "ASF") return [
    { key: "spi", title: "KPI / SPI against their targets (ENR-CM-06)", ref: "MSM §4.2" },
    { key: "findings", title: "Internal and authority findings, corrective actions", ref: "MSM §2.6" },
    { key: "audits", title: "Audit programme — done, ongoing, coming", ref: "MSM §2.6" },
    { key: "reports", title: "Occurrences and risk studies", ref: "MSM §3" },
    { key: "hazards", title: "Hazard log — new, highest risks, reviews" },
    { key: "changes", title: "Changes (MOC) and their outcome" },
    { key: "actions", title: "Safety actions — open and overdue" },
    { key: "watch", title: "Regulatory watch" },
    { key: "fstd", title: "FSTD" },
    { key: "subs", title: "Subcontractors" },
    { key: "training", title: "Management system training" },
    { key: "aob", title: "Decisions and any other business" },
  ];
  return [
    { key: "policy", title: "Review of the safety policy", ref: "MSM §1.2 · §4.5" },
    { key: "objectives", title: "Safety objectives and the means to achieve them", ref: "MSM §1.2.3" },
    { key: "criteria", title: "Risk acceptability criteria", ref: "MSM §3.5" },
    { key: "spi", title: "SMS performance — SPI against safety objectives, SPT analysis", ref: "MSM §4.2 · ENR-CM-06" },
    { key: "compliance", title: "Compliance review — internal and authority findings, audit programme", ref: "MSM §2.6" },
    { key: "reports", title: "Reporting scheme — occurrences, MOR, investigations", ref: "MSM §3.3" },
    { key: "hazards", title: "Hazard log — additions, removals, highest risks", ref: "MSM §3.7" },
    { key: "changes", title: "Changes since the last SRB and their effectiveness", ref: "MSM §3.4" },
    { key: "isms", title: "ISMS performance (Part-IS)", ref: "MSM §8" },
    { key: "fdm", title: "FDM review", ref: "MSM §6" },
    { key: "frms", title: "FRMS — surveys, FTL discretion, fatigue reports", ref: "MSM §7" },
    { key: "actions", title: "Corrective actions undertaken in a timely manner", ref: "MSM §4.3" },
    { key: "sag", title: "Safety Action Group outputs", ref: "MSM §4.6" },
    { key: "future", title: "Future changes in the company", ref: "MSM §4.5" },
    { key: "aob", title: "Open discussion" },
  ];
}

/** Who is invited: SRB = AM (chair), nominated persons, CMM / SM and deputies of the entity (from NP management). SAG = SM + the posts concerned (added by hand). */
export async function defaultAttendees(entity: string, kind: string): Promise<Attendee[]> {
  const db = supabaseAdmin();
  const { data: posts } = await db.from("np_posts").select("code,title,holder_name,holder_person,deputy_name,deputy_person,status,ord").eq("entity", entity).neq("status", "not_required").order("ord");
  const out: Attendee[] = []; const seen = new Set<string>();
  const add = (name: string | null, role: string, person: string | null) => { if (!name) return; const k = name.toLowerCase(); if (seen.has(k)) { const a = out.find((x) => x.name.toLowerCase() === k); if (a && a.role && !a.role.split(" · ").includes(role)) a.role += ` · ${role}`; return; } seen.add(k); out.push({ name, role, person_id: person, present: null }); };
  const P = (posts ?? []) as { code: string; holder_name: string | null; holder_person: string | null; deputy_name: string | null; deputy_person: string | null }[];
  const wanted = (c: string) => kind === "srb" || ["SM", "CMM"].includes(c.toUpperCase());
  for (const p of [...P].sort((a, b) => (a.code === "AM" ? -1 : b.code === "AM" ? 1 : 0))) if (wanted(p.code)) add(p.holder_name, p.code, p.holder_person);
  if (kind === "srb") for (const p of P) if (/CMM|SM/i.test(p.code)) add(p.deputy_name, `${p.code} deputy`, p.deputy_person);
  if (!out.some((a) => /\bSM\b|CMM/.test(a.role ?? ""))) {
    const { data: sm } = await db.from("people").select("id,display_name,roles").contains("entities", [entity]).overlaps("roles", ["SM", "CMM"]).limit(3);
    for (const p of (sm ?? []) as { id: string; display_name: string; roles: string[] }[]) add(p.display_name, p.roles.filter((r) => ["SM", "CMM"].includes(r)).join("/"), p.id);
  }
  return out;
}

export async function nextNumber(entity: string, kind: string, on: string): Promise<string> {
  const y = on.slice(0, 4); const m = Number(on.slice(5, 7)); const short = kindShort(entity, kind);
  const base = kind === "sag" ? null : entity === "ASF" ? `${short} ${y}-Q${Math.ceil(m / 3)}` : `${short} ${y}-S${m <= 6 ? 1 : 2}`;
  const { data } = await supabaseAdmin().from("committees").select("number").eq("entity", entity).like("number", `${short} ${y}-%`);
  const used = new Set(((data ?? []) as { number: string }[]).map((x) => x.number));
  if (base && !used.has(base)) return base;
  for (let i = 1; i < 100; i++) { const n = kind === "sag" ? `${short} ${y}-${String(i).padStart(2, "0")}` : `${base} (${i + 1})`; if (!used.has(n)) return n; }
  return `${short} ${y}-${Date.now()}`;
}

export type Pack = {
  since: string | null; until: string; year: number;
  spi: { code: string; label: string; target: string; ytd: string; verdict: string; off: boolean }[]; spiCounts: Record<string, number>;
  reports: { total: number; mor: number; significant: number; open: number; openOld: number; byType: Record<string, number>; list: { id: string; headline: string; erc: number | null; mor: boolean }[] };
  hazards: { log: number; added: { ref: string; title: string }[]; red: { ref: string; title: string; score: string }[]; reviewDue: number; reassess: number };
  changes: { number: string; name: string; status: string | null }[];
  actions: { open: number; late: number; doneSince: number; lateList: { number: string; title: string; due: string | null; owner: string | null }[] };
  findings: { open: number; late: number };
  sags: { number: string; title: string; held: string | null; actions: number }[];
};

/** The figures presented, since the previous board of the same kind (or the start of the year): frozen in the minutes. */
export async function buildPack(c: Pick<Committee, "id" | "entity" | "kind" | "planned_on" | "starts_at">): Promise<Pack> {
  const db = supabaseAdmin(); const e = c.entity;
  const until = (c.starts_at ?? (c.planned_on ? `${c.planned_on}T23:59:59Z` : new Date().toISOString()));
  const year = Number(until.slice(0, 4));
  const { data: prev } = await db.from("committees").select("starts_at,planned_on").eq("entity", e).eq("kind", c.kind).in("status", ["held", "closed"]).neq("id", c.id).lt("planned_on", until.slice(0, 10)).order("planned_on", { ascending: false }).limit(1);
  const p0 = ((prev ?? []) as { starts_at: string | null; planned_on: string | null }[])[0];
  const since = p0 ? (p0.starts_at ?? `${p0.planned_on}T00:00:00Z`) : `${year}-01-01T00:00:00Z`;
  const [board, { data: rr }, { data: ra }, { data: acts }, { data: fnd }, { data: sags }] = await Promise.all([
    spiBoard(e, year),
    db.from("reports").select("id,headline,received_at,status,report_type,source_erc,closed_at,report_analysis(mor_status,erc_value)").eq("entity", e).lte("received_at", until).limit(5000),
    db.from("risk_assessments").select("id,kind,number,name,status,moc_status,created_at,start_date,conducted_on").eq("entity", e).limit(3000),
    db.from("safety_actions").select("number,title,status,due,owner_role,done_at,verified_at,created_at").eq("entity", e).eq("module", "safety").limit(5000),
    db.from("findings").select("phase,due").eq("entity", e).limit(3000),
    c.kind === "srb" ? db.from("committees").select("id,number,title,starts_at,planned_on,status").eq("entity", e).eq("kind", "sag").in("status", ["held", "closed"]).gte("planned_on", since.slice(0, 10)).lte("planned_on", until.slice(0, 10)) : Promise.resolve({ data: [] }),
  ]);
  type Rr = { id: string; headline: string; received_at: string; status: string; report_type: string | null; source_erc: number | null; closed_at: string | null; report_analysis: { mor_status: string | null; erc_value: number | null } | { mor_status: string | null; erc_value: number | null }[] | null };
  const R = ((rr ?? []) as unknown as Rr[]).filter((r) => !/^\s*test\b/i.test(r.headline)).map((r) => ({ ...r, a: Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis }));
  const inP = R.filter((r) => r.received_at >= since);
  const byType: Record<string, number> = {}; for (const r of inP) { const t = r.report_type ?? "SAM"; byType[t] = (byType[t] ?? 0) + 1; }
  const erc = (r: (typeof R)[number]) => r.a?.erc_value ?? r.source_erc ?? null;
  const open = R.filter((r) => r.status !== "closed");
  const now = new Date(until).getTime();
  const logIds = ((ra ?? []) as { id: string; kind: string }[]).filter((x) => x.kind === "hazard_log").map((x) => x.id);
  const { data: hz } = logIds.length ? await db.from("hazards").select("ref,title,created_at,sev_after,lik_after,review_date,needs_review,status,proposed,source_ref").in("assessment_id", logIds).neq("status", "closed").limit(5000) : { data: [] };
  const H = ((hz ?? []) as { ref: string; title: string; created_at: string; sev_after: string | null; lik_after: number | null; review_date: string | null; needs_review: boolean; proposed: boolean; source_ref: string | null }[]).filter((h) => !h.proposed);
  const sch = schemeOf(e);
  const score = (s: string | null, l: number | null) => riskLabel(l, s, sch) ?? "";
  const isRed = (s: string | null, l: number | null) => tolerability(l, s, sch) === "intolerable";
  const A = (acts ?? []) as { number: string; title: string; status: string; due: string | null; owner_role: string | null; done_at: string | null; verified_at: string | null; created_at: string }[];
  const today = until.slice(0, 10);
  const openA = A.filter((a) => ["open", "in_progress"].includes(a.status));
  const lateA = openA.filter((a) => a.due && a.due < today);
  const F = (fnd ?? []) as { phase: string; due: string | null }[]; const openF = F.filter((f) => !/closed/i.test(f.phase));
  const S = ((sags ?? []) as { id: string; number: string; title: string; starts_at: string | null; planned_on: string | null }[]);
  const { data: sagActs } = S.length ? await db.from("safety_actions").select("committee_id").in("committee_id", S.map((x) => x.id)) : { data: [] };
  const rows = board.rows.filter((r) => r.status === "active");
  const spiCounts: Record<string, number> = { ok: 0, improve: 0, far: 0, nodata: 0 };
  for (const r of rows) spiCounts[r.ytdVerdict === "none" ? "nodata" : r.ytdVerdict] = (spiCounts[r.ytdVerdict === "none" ? "nodata" : r.ytdVerdict] ?? 0) + 1;
  return {
    since, until, year,
    spi: rows.map((r) => ({ code: r.code, label: r.label, target: targetText(r, r.t), ytd: fmt(r.ytd, r.basis), verdict: VERDICT[r.ytdVerdict][0], off: r.ytdVerdict === "improve" || r.ytdVerdict === "far" })), spiCounts,
    reports: { total: inP.length, mor: inP.filter((r) => r.a?.mor_status === "mandatory").length, significant: inP.filter((r) => (erc(r) ?? 0) >= 100).length, open: open.length, openOld: open.filter((r) => now - new Date(r.received_at).getTime() > 90 * 864e5).length, byType,
      list: inP.filter((r) => (erc(r) ?? 0) >= 100 || r.a?.mor_status === "mandatory").slice(0, 40).map((r) => ({ id: r.id, headline: r.headline, erc: erc(r), mor: r.a?.mor_status === "mandatory" })) },
    hazards: { log: H.length, added: H.filter((h) => !h.source_ref && h.created_at >= since).map((h) => ({ ref: h.ref, title: h.title })).slice(0, 30), red: H.filter((h) => isRed(h.sev_after, h.lik_after)).map((h) => ({ ref: h.ref, title: h.title, score: score(h.sev_after, h.lik_after) })).slice(0, 30), reviewDue: H.filter((h) => h.review_date && h.review_date < today).length, reassess: H.filter((h) => h.needs_review).length },
    changes: ((ra ?? []) as { kind: string; number: string; name: string; moc_status: string | null; created_at: string; start_date: string | null }[]).filter((x) => x.kind === "moc" && (x.start_date ?? x.created_at.slice(0, 10)) >= since.slice(0, 10)).map((x) => ({ number: x.number, name: x.name, status: x.moc_status })).slice(0, 40),
    actions: { open: openA.length, late: lateA.length, doneSince: A.filter((a) => (a.verified_at ?? a.done_at ?? "") >= since).length, lateList: lateA.slice(0, 30).map((a) => ({ number: a.number, title: a.title, due: a.due, owner: a.owner_role })) },
    findings: { open: openF.length, late: openF.filter((f) => f.due && f.due < today).length },
    sags: S.map((x) => ({ number: x.number, title: x.title, held: x.starts_at ?? x.planned_on, actions: ((sagActs ?? []) as { committee_id: string }[]).filter((a) => a.committee_id === x.id).length })),
  };
}

/** Pack lines shown under an agenda item. */
export function packFor(key: string, p: Pack | null): string[] {
  if (!p) return [];
  switch (key) {
    case "spi": return [`${p.spi.length} SPIs: ${p.spiCounts.ok ?? 0} on target, ${p.spiCounts.improve ?? 0} to improve, ${p.spiCounts.far ?? 0} far off, ${p.spiCounts.nodata ?? 0} without data / target`, ...p.spi.filter((s) => s.off).map((s) => `${s.code} ${s.label}: ${s.ytd} YTD against ${s.target} — ${s.verdict}`)];
    case "reports": case "events": return [`${p.reports.total} reports since ${p.since?.slice(0, 10)} — ${p.reports.mor} MOR, ${p.reports.significant} with ERC ≥ 100; ${p.reports.open} open (${p.reports.openOld} for more than 90 days)`, Object.entries(p.reports.byType).map(([k, v]) => `${k} ${v}`).join(" · "), ...p.reports.list.map((r) => `${r.id} ${r.headline}${r.erc != null ? ` — ERC ${r.erc}` : ""}${r.mor ? " — MOR" : ""}`)].filter(Boolean);
    case "hazards": return [`${p.hazards.log} hazards in the log; ${p.hazards.added.length} added since the last meeting; ${p.hazards.red.length} with an intolerable residual risk; ${p.hazards.reviewDue} reviews overdue; ${p.hazards.reassess} to reassess after a new occurrence`, ...p.hazards.red.map((h) => `${h.ref} ${h.title} — ${h.score}`), ...p.hazards.added.map((h) => `+ ${h.ref} ${h.title}`)];
    case "changes": return p.changes.length ? p.changes.map((c) => `${c.number} ${c.name} — ${c.status ?? ""}`) : ["No change file opened since the last meeting"];
    case "actions": case "open_actions": return [`${p.actions.open} safety actions open, ${p.actions.late} overdue; ${p.actions.doneSince} done since the last meeting`, ...p.actions.lateList.map((a) => `${a.number} ${a.title} — due ${a.due} (${a.owner ?? "—"})`)];
    case "compliance": case "findings": return [`${p.findings.open} findings open, ${p.findings.late} past their due date`];
    case "sag": return p.sags.length ? p.sags.map((s) => `${s.number} ${s.title} (${s.held?.slice(0, 10)}) — ${s.actions} action(s)`) : ["No SAG held since the last SRB"];
    default: return [];
  }
}
