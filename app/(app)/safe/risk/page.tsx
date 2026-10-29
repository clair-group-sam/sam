import Link from "next/link";
import SourceMark from "@/components/SourceMark";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { DOMAINS, LIKELIHOODS, MSM_REF, RA_STATUS, SEVERITIES, mayEditRisk, riskIndex, riskLabel, schemeOf, tolerability, tolTone, type Ra } from "@/lib/risk";
import { RiskTabs } from "@/components/RiskTabs";
import { toMatchCount } from "@/lib/risk-count";
import { createAssessment } from "./actions";

type H = { id: string; ref: string; title: string; consequence: string | null; status: string; entity: string; owner_role: string | null; needs_review: boolean; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; assessment_id: string; hazard_reports: { report_id: string }[] };
type Sp = { domain?: string; tol?: string; q?: string; cell?: string; m?: string; st?: string; flag?: string };
const qs = (sp: Sp, patch: Partial<Sp>) => { const o = { ...sp, ...patch }; const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const t = u.toString(); return `/safe/risk${t ? "?" + t : ""}`; };

/** Safety › Hazard log: each lasting hazard once, with its current (signed) rating, owner, review date, and the studies / reports that feed it (ICAO Doc 9859, ORO.GEN.200, MSM §3). */
export default async function HazardLog({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const [{ data: ra }, { data: hz }, { data: refs }, toMatch, { count: dup }] = await Promise.all([
    db.from("risk_assessments").select("*").in("entity", scope).eq("kind", "hazard_log").order("number"),
    db.from("hazards").select("id,ref,title,consequence,status,entity,owner_role,needs_review,lik_before,sev_before,lik_after,sev_after,assessment_id,risk_assessments!inner(kind),hazard_reports(report_id)").in("entity", scope).eq("proposed", false).eq("risk_assessments.kind", "hazard_log"),
    db.from("hazards").select("log_hazard_id").in("entity", scope).not("log_hazard_id", "is", null),
    toMatchCount(scope),
    db.from("risk_matches").select("subject_id", { count: "exact", head: true }).eq("subject_kind", "duplicate").in("entity", scope),
  ]);
  const entries = new Map(((ra ?? []) as Ra[]).map((a) => [a.id, a]));
  const studies = new Map<string, number>(); for (const r of (refs ?? []) as { log_hazard_id: string }[]) studies.set(r.log_hazard_id, (studies.get(r.log_hazard_id) ?? 0) + 1);
  const archived = sp.st === "archived";
  const all = ((hz ?? []) as unknown as H[]).filter((h) => { const a = entries.get(h.assessment_id); return a && (archived ? ["archived", "cancelled"].includes(a.status) || h.status === "closed" : !["archived", "cancelled"].includes(a.status) && h.status !== "closed"); });
  const post = sp.m !== "pre";
  const lk = (h: H) => (post ? h.lik_after ?? h.lik_before : h.lik_before), sv = (h: H) => (post ? h.sev_after ?? h.sev_before : h.sev_before);
  const tolOf = (h: H) => tolerability(lk(h), sv(h), schemeOf(h.entity));
  const today = new Date().toISOString().slice(0, 10);
  const due = (h: H) => entries.get(h.assessment_id)?.next_due ?? null;
  let base = all;
  if (sp.domain) base = base.filter((h) => (entries.get(h.assessment_id)?.domain ?? "") === sp.domain);
  if (sp.q) { const q = sp.q.toLowerCase(); base = base.filter((h) => `${h.ref} ${h.title} ${h.consequence ?? ""} ${entries.get(h.assessment_id)?.number ?? ""}`.toLowerCase().includes(q)); }
  if (sp.flag === "review") base = base.filter((h) => h.needs_review);
  if (sp.flag === "overdue") base = base.filter((h) => (due(h) ?? "9999") < today);
  if (sp.flag === "unsigned") base = base.filter((h) => entries.get(h.assessment_id)?.status === "draft");
  let rows = base;
  if (sp.tol) rows = rows.filter((h) => tolOf(h) === sp.tol);
  if (sp.cell) rows = rows.filter((h) => riskIndex(lk(h), sv(h)) === sp.cell);
  const cnt = new Map<string, number>(); for (const h of base) { const i = riskIndex(lk(h), sv(h)); if (i) cnt.set(i, (cnt.get(i) ?? 0) + 1); }
  const sch = scope.length === 1 ? schemeOf(scope[0]) : "centrik";
  // grouped by domain, highest current risk first
  const score = (h: H) => { const t = tolOf(h); return (t === "intolerable" ? 3 : t === "tolerable" ? 2 : t ? 1 : 0) * 100 + (lk(h) ?? 0) * 10 + (6 - "ABCDE".indexOf(sv(h) ?? "E")); };
  const groups = new Map<string, H[]>(); for (const h of rows) { const d = entries.get(h.assessment_id)?.domain ?? "Other"; if (!groups.has(d)) groups.set(d, []); groups.get(d)!.push(h); }
  for (const g of groups.values()) g.sort((x, y) => score(y) - score(x));
  const live = all;
  const red = live.filter((h) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, schemeOf(h.entity)) === "intolerable").length;
  const edit = mayEditRisk(s);
  const flag = (k: string, l: string, n: number, tone?: string) => <Link href={qs(sp, { flag: sp.flag === k ? undefined : k })} className={"btn" + (sp.flag === k ? " on" : "")}>{l} <span className={"pill " + (n ? tone ?? "" : "")}>{n}</span></Link>;
  return (
    <>
      <PageHeader eyebrow="Safety · Risk management" title="Hazard log" sub={`Each lasting hazard once, with its current rating — reviewed at the SRB, reassessed with each new occurrence · ${scope.map((e) => MSM_REF[e] ?? e).join(" · ")}`} />
      <RiskTabs on="log" toMatch={toMatch} />
      <div className="grid grid-cols-5 gap-4 mb-5">
        <Metric label="Hazards in the log" value={live.length} hint={`${new Set(live.map((h) => h.assessment_id)).size} entries`} />
        <Metric label="Current risk red" value={red} tone={red ? "red" : undefined} hint="AM decision" />
        <Metric label="To reassess" value={live.filter((h) => h.needs_review).length} tone={live.some((h) => h.needs_review) ? "amber" : undefined} hint="occurrence or study linked" />
        <Metric label="Review overdue" value={live.filter((h) => (due(h) ?? "9999") < today).length} tone={live.some((h) => (due(h) ?? "9999") < today) ? "red" : undefined} />
        <Metric label="Study hazards to match" value={toMatch} tone={toMatch ? "amber" : undefined} hint={dup ? `${dup} possible duplicates` : "MOC / RA"} />
      </div>

      <div className="grid gap-4 mb-4 items-start" style={{ gridTemplateColumns: "minmax(0,1fr) 360px" }}>
        <div>
          <div className="flex gap-2 mb-2 flex-wrap items-center">
            {flag("review", "To reassess", live.filter((h) => h.needs_review).length, "amber")}
            {flag("overdue", "Review overdue", live.filter((h) => (due(h) ?? "9999") < today).length, "red")}
            {flag("unsigned", "Not signed off", live.filter((h) => entries.get(h.assessment_id)?.status === "draft").length, "amber")}
            <form className="ml-auto flex gap-2" action="/safe/risk">
              {sp.m && <input type="hidden" name="m" value={sp.m} />}{sp.flag && <input type="hidden" name="flag" value={sp.flag} />}
              <select name="domain" defaultValue={sp.domain ?? ""} className="inp" style={{ marginTop: 0, width: 170 }}><option value="">all domains</option>{[...new Set([...DOMAINS, ...[...entries.values()].map((a) => a.domain).filter(Boolean) as string[]])].map((d) => <option key={d}>{d}</option>)}</select>
              <select name="tol" defaultValue={sp.tol ?? ""} className="inp" style={{ marginTop: 0, width: 150 }}><option value="">any risk</option><option value="intolerable">intolerable</option><option value="tolerable">tolerable</option><option value="acceptable">acceptable</option></select>
              <input name="q" defaultValue={sp.q ?? ""} className="inp" placeholder="Search" style={{ marginTop: 0, width: 160 }} />
              <button className="btn">Filter</button>
            </form>
          </div>
          {(sp.cell || sp.tol || sp.domain || sp.q || sp.flag) && <p className="mini mb-2">{rows.length} hazards · <Link className="underline" href={qs({ m: sp.m }, {})}>clear filters</Link></p>}
        </div>
        <section className="card">
          <div className="ch"><span className="eyebrow">Heat map · {post ? "current (post-mitigation)" : "pre-mitigation"}</span><span className="mini"><Link className="underline" href={qs(sp, { m: post ? "pre" : undefined, cell: undefined })}>show {post ? "pre" : "post"}</Link></span></div>
          <div className="cb">
            <table className="rmx heat"><thead><tr><th />{SEVERITIES.map((v) => <th key={v.id} title={v.label}>{v.id}</th>)}</tr></thead>
              <tbody>{LIKELIHOODS.map((l) => <tr key={l.id}><th title={l.label}>{l.id}</th>{SEVERITIES.map((v) => { const i = `${l.id}${v.id}`; const n = cnt.get(i) ?? 0; const t = tolerability(l.id, v.id, sch); return <td key={v.id} className={tolTone(t)}><Link href={qs(sp, { cell: sp.cell === i ? undefined : i })} className={"cell" + (sp.cell === i ? " on" : "") + (n ? "" : " zero")} title={`${riskLabel(l.id, v.id, sch)} · ${n} hazard${n === 1 ? "" : "s"}`}>{n || ""}</Link></td>; })}</tr>)}</tbody></table>
            <p className="mini mt-2">{sch === "centrik" ? "Scores as in Centrik: green 1–10, yellow 20–100, red 300–2500." : "ICAO tolerability table."} Click a cell to filter.</p>
          </div>
        </section>
      </div>

      {[...groups.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([d, hs]) => (
        <section key={d} className="card mb-4">
          <div className="ch"><span className="eyebrow">{d}</span><span className="mini">{hs.length} hazard{hs.length === 1 ? "" : "s"}</span></div>
          <table className="tbl">
            <thead><tr><th style={{ width: 120 }}>Ref</th><th style={{ width: 55 }}>Entity</th><th>Hazard → consequence</th><th style={{ width: 150 }}>Pre → current</th><th style={{ width: 70 }}>Owner</th><th style={{ width: 100 }}>Next review</th><th style={{ width: 110 }}>Fed by</th><th style={{ width: 130 }}>Entry</th></tr></thead>
            <tbody>{hs.map((h) => {
              const a = entries.get(h.assessment_id)!; const sc = schemeOf(h.entity); const pre = tolerability(h.lik_before, h.sev_before, sc), cur = tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, sc);
              const n = studies.get(h.id) ?? 0, r = h.hazard_reports.length; const dd = due(h);
              return (
                <tr key={h.id}>
                  <td className="mono"><Link className="underline" href={`/safe/risk/${h.id}`}>{h.ref}</Link>{h.needs_review && <div className="mini red">to reassess</div>}</td>
                  <td><span className={"ent " + h.entity}>{h.entity}</span></td>
                  <td><Link href={`/safe/risk/${h.id}`}><b>{h.title}</b></Link>{h.consequence && <div className="mini">→ {h.consequence}</div>}</td>
                  <td>{pre ? <span className={"pill " + tolTone(pre)}>{riskLabel(h.lik_before, h.sev_before, sc)}</span> : <span className="mini">—</span>} → {cur ? <span className={"pill " + tolTone(cur)}>{riskLabel(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, sc)}</span> : <span className="mini">—</span>}</td>
                  <td className="mono">{h.owner_role ?? a.owner_role ?? "—"}</td>
                  <td className={"mono" + (dd && dd < today ? " red" : "")}>{dd ?? "—"}</td>
                  <td className="mini">{n ? `${n} stud${n > 1 ? "ies" : "y"}` : ""}{n && r ? " · " : ""}{r ? `${r} report${r > 1 ? "s" : ""}` : ""}{!n && !r ? "—" : ""}</td>
                  <td><Link className="mono underline mini" href={`/safe/risk/a/${a.id}`}>{a.number}</Link><SourceMark source={(a as { source?: string }).source} /><div><span className={"pill " + (RA_STATUS[a.status]?.[1] ?? "")}>{RA_STATUS[a.status]?.[0] ?? a.status}</span></div></td>
                </tr>);
            })}</tbody>
          </table>
        </section>
      ))}
      {!rows.length && <section className="card mb-4"><p className="p-6 text-slate6">No hazard{sp.cell || sp.q || sp.tol || sp.domain || sp.flag ? " matching the filters" : " in the log yet — create an entry below, or import Centrik / Monday in Settings › Integrations"}.</p></section>}
      <p className="mini mb-4"><Link className="underline" href={qs(sp, { st: archived ? undefined : "archived" })}>{archived ? "Back to the current log" : "Closed and archived hazards"}</Link></p>

      {edit && (
        <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">+ New hazard log entry</span><span className="mini">a lasting hazard — for a change use a MOC, for a one-off case a risk assessment</span></summary>
          <form action={createAssessment} className="cb grid grid-cols-3 gap-3"><input type="hidden" name="kind" value="hazard_log" />
            <label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={s.entity !== "ALL" ? s.entity : s.entities[0]}>{s.entities.map((e) => <option key={e} value={e}>{e} — {ENT[e]?.name ?? e}</option>)}</select></label>
            <label><span className="mini">Domain</span><select name="domain" className="inp">{DOMAINS.map((d) => <option key={d}>{d}</option>)}</select></label>
            <label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" placeholder="SM" /></label>
            <label className="col-span-3"><span className="mini">Name</span><input name="name" className="inp" required placeholder="e.g. HZ - Runway incursions (RI)" /></label>
            <label className="col-span-3"><span className="mini">Participants — one per line: Name — role</span><textarea name="participants" className="inp" rows={2} placeholder={"Guillaume Fournie — SM\nJonathan Wolski — NPFO"} /></label>
            <div className="col-span-3 flex justify-end"><button className="btn primary">Create</button></div>
          </form>
        </details>
      )}
    </>
  );
}
