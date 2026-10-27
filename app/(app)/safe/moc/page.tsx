import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { RiskTabs } from "@/components/RiskTabs";
import { toMatchCount } from "@/lib/risk-count";
import { bulkAssessments } from "../risk/actions";
import { MOC_CATEGORIES, MOC_STATUS, RA_STATUS, mayEditRisk, msmChecks, schemeOf, tolerability, tolTone, worstTol, type Hz, type Ra } from "@/lib/risk";

/** Safety › Management of change: every change and its risk assessment (MSM §3.4: the MOC is completed before the change). */
export default async function Mocs({ searchParams }: { searchParams: Promise<{ st?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { st } = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const { data } = await supabaseAdmin().from("risk_assessments").select("*,hazards(id,ref,title,consequence,proposed,status,log_hazard_id,local_only,lik_before,sev_before,lik_after,sev_after,needs_review,hazard_mitigations(text,existing,owner_role,due,done_at))").in("entity", scope).eq("kind", "moc").order("created_at", { ascending: false });
  const all = (data ?? []) as unknown as (Ra & { hazards: (Hz & { log_hazard_id: string | null })[] })[];
  const toMatch = await toMatchCount(scope);
  const live = (r: Ra) => !["closed", "cancelled"].includes(r.moc_status ?? "") && r.status !== "cancelled";
  const rows = st === "closed" ? all.filter((r) => !live(r)) : st === "all" ? all : all.filter(live);
  return (
    <>
      <PageHeader eyebrow="Safety · Management of change" title="Management of change" sub="ORO.GEN.200(a)(3) · MSM §3.4 — every change gets its risk assessment, signed off by the most relevant NP (the AM decides on a red residual risk), before it is implemented. Its lasting hazards are linked to the hazard log." right={mayEditRisk(s) ? <Link href="/safe/moc/new" className="btn primary">+ New MOC</Link> : undefined} />
      <RiskTabs on="moc" toMatch={toMatch} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="In risk assessment" value={all.filter((r) => r.status === "draft" && live(r)).length} />
        <Metric label="Red — AM decision" value={all.filter((r) => r.status === "validated").length} tone={all.some((r) => r.status === "validated") ? "amber" : undefined} />
        <Metric label="Approved, to implement" value={all.filter((r) => r.moc_status === "approved").length} />
        <Metric label="Implemented, to close" value={all.filter((r) => r.moc_status === "implemented").length} />
      </div>
      <div className="flex gap-2 mb-3">{[["", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={k ? `/safe/moc?st=${k}` : "/safe/moc"} className={"btn" + ((st ?? "") === k ? " on" : "")}>{l}</Link>)}</div>
      {mayEditRisk(s) && all.some((r) => r.status === "accepted" && r.moc_status !== "closed") && (
        <form id="bulk-moc" action={bulkAssessments} className="flex gap-2 items-center mb-3">
          <select name="op" className="inp" style={{ marginTop: 0, width: 260 }} defaultValue="implemented"><option value="implemented">Mark the ticked changes as implemented</option><option value="closed">Close the ticked MOCs</option></select>
          <button className="btn">Apply</button><span className="mini">only signed MOCs can be ticked (MSM §3.4: assessed before implementation)</span></form>)}
      <section className="card">
        <table className="tbl">
          <thead><tr>{mayEditRisk(s) && <th style={{ width: 30 }} />}<th style={{ width: 130 }}>Number</th><th style={{ width: 55 }}>Entity</th><th>Change</th><th style={{ width: 120 }}>Residual</th><th style={{ width: 100 }}>Start</th><th style={{ width: 170 }}>Status</th><th style={{ width: 70 }}>MSM</th></tr></thead>
          <tbody>
            {rows.map((r) => { const w = worstTol(r.hazards.filter((h) => !h.proposed && h.status !== "closed").map((h) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before, schemeOf(r.entity)))); const ch = msmChecks(r, r.hazards); const ok = ch.filter((c) => c.ok).length; return (
              <tr key={r.id}>
                {mayEditRisk(s) && <td>{r.status === "accepted" && r.moc_status !== "closed" && <input type="checkbox" name="ids" value={r.id} form="bulk-moc" />}</td>}
                <td className="mono"><Link className="underline" href={`/safe/risk/a/${r.id}`}>{r.number}</Link></td>
                <td><span className={"ent " + r.entity}>{r.entity}</span></td>
                <td><Link href={`/safe/risk/a/${r.id}`}><b>{r.name}</b></Link><div className="mini">{MOC_CATEGORIES[r.category ?? ""] ?? r.domain ?? ""}{r.project_id ? " · from a project" : ""}{r.source !== "sam" ? ` · from ${r.source}` : ""} · {r.hazards.filter((h) => !h.proposed).length} hazards ({r.hazards.filter((h) => !h.proposed && h.log_hazard_id).length} in log)</div></td>
                <td>{w ? <span className={"pill " + tolTone(w)}>{w}</span> : <span className="mini">—</span>}</td>
                <td className="mono">{r.start_date ?? "—"}</td>
                <td><span className={"pill " + (RA_STATUS[r.status]?.[1] ?? "")}>{RA_STATUS[r.status]?.[0]}</span>{r.moc_status && r.moc_status !== "assessment" && <div className="mini">{MOC_STATUS[r.moc_status]?.[0]}</div>}</td>
                <td><span className={"pill " + (ok === ch.length ? "green" : ok >= ch.length - 2 ? "amber" : "red")} title={ch.filter((c) => !c.ok).map((c) => "✕ " + c.label).join("\n")}>{ok}/{ch.length}</span></td>
              </tr>); })}
            {!rows.length && <tr><td colSpan={8} className="p-6 text-slate6">No change.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
