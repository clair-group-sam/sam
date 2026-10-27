import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { DOMAINS, KINDS, LIKELIHOODS, MSM_REF, RA_STATUS, SEVERITIES, mayEditRisk, msmChecks, riskIndex, riskLabel, riskScore, schemeOf, tolerability, tolTone, worstTol, type Hz, type Ra } from "@/lib/risk";
import { createAssessment } from "./actions";

type H = Hz & { assessment_id: string | null; entity: string };
type Sp = { kind?: string; domain?: string; tol?: string; q?: string; cell?: string; m?: string; st?: string };
const qs = (sp: Sp, patch: Partial<Sp>) => { const o = { ...sp, ...patch }; const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const t = u.toString(); return `/safe/risk${t ? "?" + t : ""}`; };

/** Safety › Risk register: risk assessments (hazard log, MOC, one-off RA) of the scope, heat map of their hazards, filters, MSM conformity. */
export default async function RiskRegister({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const [{ data: ra }, { data: hz }] = await Promise.all([
    db.from("risk_assessments").select("*").in("entity", scope).order("number"),
    db.from("hazards").select("id,ref,title,description,consequence,main_impact,proposed,status,lik_before,sev_before,lik_after,sev_after,needs_review,owner_role,assessment_id,entity,hazard_mitigations(text,existing,owner_role,due,done_at)").in("entity", scope).not("assessment_id", "is", null),
  ]);
  const all = (ra ?? []) as Ra[]; const hazards = (hz ?? []) as unknown as H[];
  const byRa = new Map<string, H[]>(); for (const h of hazards) { const k = h.assessment_id!; if (!byRa.has(k)) byRa.set(k, []); byRa.get(k)!.push(h); }
  const live = (h: H) => !h.proposed && h.status !== "closed";
  const post = sp.m !== "pre";
  const tolOf = (h: H) => tolerability(post ? (h.lik_after ?? h.lik_before) : h.lik_before, post ? (h.sev_after ?? h.sev_before) : h.sev_before, schemeOf(h.entity));
  const today = new Date().toISOString().slice(0, 10);
  // filters on assessments
  let rows = all.filter((a) => (sp.st === "archived" ? ["archived", "cancelled"].includes(a.status) : !["archived", "cancelled"].includes(a.status)));
  if (sp.kind) rows = rows.filter((a) => a.kind === sp.kind);
  if (sp.domain) rows = rows.filter((a) => (a.domain ?? "") === sp.domain);
  if (sp.q) { const q = sp.q.toLowerCase(); rows = rows.filter((a) => (a.number + " " + a.name).toLowerCase().includes(q) || (byRa.get(a.id) ?? []).some((h) => h.title.toLowerCase().includes(q))); }
  if (sp.tol) rows = rows.filter((a) => worstTol((byRa.get(a.id) ?? []).filter(live).map(tolOf)) === sp.tol);
  if (sp.cell) rows = rows.filter((a) => (byRa.get(a.id) ?? []).filter(live).some((h) => riskIndex(post ? (h.lik_after ?? h.lik_before) : h.lik_before, post ? (h.sev_after ?? h.sev_before) : h.sev_before) === sp.cell));
  const shownH = rows.flatMap((a) => (byRa.get(a.id) ?? []).filter(live));
  // heat map counts (of the hazards of the shown assessments, before the cell filter)
  const heatBase = all.filter((a) => !["archived", "cancelled"].includes(a.status) && (!sp.kind || a.kind === sp.kind) && (!sp.domain || a.domain === sp.domain)).flatMap((a) => (byRa.get(a.id) ?? []).filter(live));
  const cnt = new Map<string, number>(); for (const h of heatBase) { const i = riskIndex(post ? (h.lik_after ?? h.lik_before) : h.lik_before, post ? (h.sev_after ?? h.sev_before) : h.sev_before); if (i) cnt.set(i, (cnt.get(i) ?? 0) + 1); }
  const sch = scope.length === 1 ? schemeOf(scope[0]) : "centrik";
  const openRa = all.filter((a) => !["archived", "cancelled"].includes(a.status));
  const allLive = hazards.filter(live);
  const intoler = allLive.filter((h) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, schemeOf(h.entity)) === "intolerable").length;
  const edit = mayEditRisk(s);
  return (
    <>
      <PageHeader eyebrow="Safety · Risk register" title="Risk register" sub={`Hazard log, management of change and risk assessments — ${scope.map((e) => MSM_REF[e] ?? e).join(" · ")}`} />
      <div className="grid grid-cols-5 gap-4 mb-5">
        <Metric label="Risk assessments" value={openRa.length} hint={`${allLive.length} hazards`} />
        <Metric label="Residual intolerable" value={intoler} tone={intoler ? "red" : undefined} hint="current rating" />
        <Metric label="To reassess" value={allLive.filter((h) => h.needs_review).length} tone={allLive.some((h) => h.needs_review) ? "amber" : undefined} hint="new occurrence linked" />
        <Metric label="Review overdue" value={openRa.filter((a) => a.kind !== "moc" && a.next_due && a.next_due < today).length} tone={openRa.some((a) => a.kind !== "moc" && a.next_due && a.next_due < today) ? "red" : undefined} />
        <Metric label="Red — AM decision" value={openRa.filter((a) => a.status === "validated").length} tone={openRa.some((a) => a.status === "validated") ? "amber" : undefined} />
      </div>

      <div className="grid gap-4 mb-4 items-start" style={{ gridTemplateColumns: "minmax(0,1fr) 360px" }}>
        <div>
          <div className="flex gap-2 mb-2 flex-wrap items-center">
            {[["", "All"], ["hazard_log", "Hazard log"], ["moc", "MOC"], ["ra", "Risk assessments"]].map(([k, l]) => <Link key={k} href={qs(sp, { kind: k || undefined, cell: undefined })} className={"btn" + ((sp.kind ?? "") === k ? " on" : "")}>{l}</Link>)}
            <form className="ml-auto flex gap-2" action="/safe/risk">
              {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}{sp.m && <input type="hidden" name="m" value={sp.m} />}
              <select name="domain" defaultValue={sp.domain ?? ""} className="inp" style={{ marginTop: 0, width: 170 }}><option value="">all domains</option>{[...new Set([...DOMAINS, ...all.map((a) => a.domain).filter(Boolean) as string[]])].map((d) => <option key={d}>{d}</option>)}</select>
              <select name="tol" defaultValue={sp.tol ?? ""} className="inp" style={{ marginTop: 0, width: 150 }}><option value="">any risk</option><option value="intolerable">intolerable</option><option value="tolerable">tolerable</option><option value="acceptable">acceptable</option></select>
              <input name="q" defaultValue={sp.q ?? ""} className="inp" placeholder="Search" style={{ marginTop: 0, width: 160 }} />
              <button className="btn">Filter</button>
            </form>
          </div>
          {(sp.cell || sp.tol || sp.domain || sp.q) && <p className="mini mb-2">{rows.length} assessments · {shownH.length} hazards · <Link className="underline" href={qs({ kind: sp.kind, m: sp.m }, {})}>clear filters</Link></p>}
        </div>
        <section className="card">
          <div className="ch"><span className="eyebrow">Heat map · {post ? "post-mitigation" : "pre-mitigation"}</span><span className="mini"><Link className="underline" href={qs(sp, { m: post ? "pre" : undefined, cell: undefined })}>show {post ? "pre" : "post"}</Link></span></div>
          <div className="cb">
            <table className="rmx heat"><thead><tr><th />{SEVERITIES.map((v) => <th key={v.id} title={v.label}>{v.id}</th>)}</tr></thead>
              <tbody>{LIKELIHOODS.map((l) => <tr key={l.id}><th title={l.label}>{l.id}</th>{SEVERITIES.map((v) => { const i = `${l.id}${v.id}`; const n = cnt.get(i) ?? 0; const t = tolerability(l.id, v.id, sch); return <td key={v.id} className={tolTone(t)}><Link href={qs(sp, { cell: sp.cell === i ? undefined : i })} className={"cell" + (sp.cell === i ? " on" : "") + (n ? "" : " zero")} title={`${riskLabel(l.id, v.id, sch)} · ${n} hazard${n === 1 ? "" : "s"}`}>{n || ""}</Link></td>; })}</tr>)}</tbody></table>
            <p className="mini mt-2">{sch === "centrik" ? "Scores as in Centrik: green 1–10, yellow 20–100, red 300–2500." : "ICAO tolerability table."} Click a cell to filter.</p>
          </div>
        </section>
      </div>

      <section className="card mb-5">
        <table className="tbl">
          <thead><tr><th style={{ width: 120 }}>Number</th><th style={{ width: 55 }}>Entity</th><th>Assessment</th><th style={{ width: 70 }}>Hazards</th><th style={{ width: 150 }}>Highest pre → post</th><th style={{ width: 100 }}>Next due</th><th style={{ width: 150 }}>Status</th><th style={{ width: 80 }}>MSM</th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const hs = (byRa.get(a.id) ?? []).filter(live); const sc = schemeOf(a.entity);
              const top = (which: "pre" | "post") => hs.map((h) => which === "pre" ? [h.lik_before, h.sev_before] as const : [h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before] as const).sort((x, y) => (riskScore(y[0], y[1]) ?? 0) - (riskScore(x[0], x[1]) ?? 0))[0];
              const pre = top("pre"), po = top("post");
              const ch = msmChecks(a, (byRa.get(a.id) ?? []) as Hz[]); const okN = ch.filter((c) => c.ok).length;
              return (
                <tr key={a.id}>
                  <td className="mono"><Link className="underline" href={`/safe/risk/a/${a.id}`}>{a.number}</Link></td>
                  <td><span className={"ent " + a.entity}>{a.entity}</span></td>
                  <td><Link href={`/safe/risk/a/${a.id}`}><b>{a.name}</b></Link><div className="mini">{KINDS[a.kind]}{a.domain ? ` · ${a.domain}` : ""}{a.top_risk ? " · top risk" : ""}{a.source !== "sam" ? ` · from ${a.source}` : ""}{hs.some((h) => h.needs_review) ? " · ⚠ to reassess" : ""}</div></td>
                  <td>{hs.length}</td>
                  <td>{pre && pre[0] ? <span className={"pill " + tolTone(tolerability(pre[0], pre[1], sc))}>{riskLabel(pre[0], pre[1], sc)}</span> : <span className="mini">—</span>} → {po && po[0] ? <span className={"pill " + tolTone(tolerability(po[0], po[1], sc))}>{riskLabel(po[0], po[1], sc)}</span> : <span className="mini">—</span>}</td>
                  <td className={"mono" + (a.kind !== "moc" && a.next_due && a.next_due < today ? " red" : "")}>{a.kind === "moc" ? (a.start_date ?? "—") : (a.next_due ?? "—")}</td>
                  <td><span className={"pill " + (RA_STATUS[a.status]?.[1] ?? "")}>{RA_STATUS[a.status]?.[0] ?? a.status}</span></td>
                  <td><span className={"pill " + (okN === ch.length ? "green" : okN >= ch.length - 2 ? "amber" : "red")} title={ch.filter((c) => !c.ok).map((c) => "✕ " + c.label).join("\n")}>{okN}/{ch.length}</span></td>
                </tr>);
            })}
            {!rows.length && <tr><td colSpan={8} className="p-6 text-slate6">No risk assessment{sp.cell || sp.q || sp.tol || sp.domain ? " matching the filters" : " yet — create one below, or import Centrik / FlightLogger in Settings › Integrations"}.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="mini mb-4"><Link className="underline" href={qs(sp, { st: sp.st === "archived" ? undefined : "archived" })}>{sp.st === "archived" ? "Back to current assessments" : "Archived and cancelled"}</Link></p>

      {edit && (
        <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">+ New risk assessment</span><span className="mini">hazards are added on its page</span></summary>
          <form action={createAssessment} className="cb grid grid-cols-4 gap-3">
            <label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={s.entity !== "ALL" ? s.entity : s.entities[0]}>{s.entities.map((e) => <option key={e} value={e}>{e} — {ENT[e]?.name ?? e}</option>)}</select></label>
            <label><span className="mini">Kind</span><select name="kind" className="inp" defaultValue={sp.kind ?? "hazard_log"}><option value="hazard_log">Hazard log entry (HZ)</option><option value="ra">Risk assessment (RA)</option><option value="moc">Management of change (MOC)</option></select></label>
            <label><span className="mini">Domain</span><select name="domain" className="inp">{DOMAINS.map((d) => <option key={d}>{d}</option>)}</select></label>
            <label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" placeholder="SM" /></label>
            <label className="col-span-4"><span className="mini">Name</span><input name="name" className="inp" required placeholder="e.g. HZ - Runway incursions (RI) · RA - Ferry flight 9H-XXX" /></label>
            <label className="col-span-4"><span className="mini">Description</span><textarea name="description" className="inp" rows={2} /></label>
            <label className="col-span-4"><span className="mini">Participants — one per line: Name — role</span><textarea name="participants" className="inp" rows={2} placeholder={"Guillaume Fournie — SM\nJonathan Wolski — NPFO"} /></label>
            <div className="col-span-4 flex justify-end"><button className="btn primary">Create</button></div>
          </form>
        </details>
      )}
    </>
  );
}
