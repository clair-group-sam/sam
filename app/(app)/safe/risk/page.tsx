import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { HZ_STATUS, mayEditRisk, tolerability } from "@/lib/risk";
import { RiskPill } from "@/components/RiskMatrix";
import { createHazard } from "./actions";

type H = { id: string; entity: string; ref: string; title: string; source: string; status: string; owner_role: string | null; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; review_date: string | null; proposed: boolean; moc_id: string | null; report_id: string | null; mocs: { ref: string } | null };

/** Safety › Risk register (hazard log): one line per hazard, initial → residual risk, owner, review date. */
export default async function RiskRegister({ searchParams }: { searchParams: Promise<{ st?: string; q?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { st, q } = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const { data } = await supabaseAdmin().from("hazards").select("id,entity,ref,title,source,status,owner_role,lik_before,sev_before,lik_after,sev_after,review_date,proposed,moc_id,report_id,mocs(ref)").in("entity", scope).eq("proposed", false).order("ref");
  const all = (data ?? []) as unknown as H[];
  const today = new Date().toISOString().slice(0, 10);
  const rows = all.filter((h) => (st === "closed" ? h.status === "closed" : st === "all" ? true : h.status !== "closed") && (!q || (h.title + " " + h.ref).toLowerCase().includes(q.toLowerCase())));
  const open = all.filter((h) => h.status !== "closed");
  const tolNow = (h: H) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before);
  const edit = mayEditRisk(s);
  return (
    <>
      <PageHeader eyebrow="Safety · Risk register" title="Risk register" sub="Hazard log — ICAO 5×5 matrix · initial risk → residual risk after mitigation." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open hazards" value={open.length} />
        <Metric label="Intolerable" value={open.filter((h) => tolNow(h) === "intolerable").length} tone={open.some((h) => tolNow(h) === "intolerable") ? "red" : undefined} hint="current rating" />
        <Metric label="Not rated yet" value={open.filter((h) => !h.lik_before).length} tone={open.some((h) => !h.lik_before) ? "amber" : undefined} />
        <Metric label="Review overdue" value={open.filter((h) => h.review_date && h.review_date < today).length} tone={open.some((h) => h.review_date && h.review_date < today) ? "red" : undefined} hint="every 12 months" />
      </div>
      <div className="flex gap-2 mb-3 items-center">
        {[["", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={k ? `/safe/risk?st=${k}` : "/safe/risk"} className={"btn" + ((st ?? "") === k ? " on" : "")}>{l}</Link>)}
        <form className="ml-auto flex gap-2"><input name="q" defaultValue={q ?? ""} className="inp" placeholder="Search hazards" style={{ width: 240, marginTop: 0 }} />{st && <input type="hidden" name="st" value={st} />}</form>
      </div>
      <section className="card mb-5">
        <table className="tbl">
          <thead><tr><th style={{ width: 120 }}>Ref</th><th style={{ width: 60 }}>Entity</th><th>Hazard</th><th style={{ width: 120 }}>Initial → residual</th><th style={{ width: 90 }}>Owner</th><th style={{ width: 110 }}>Review</th><th style={{ width: 110 }}>Status</th></tr></thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <td className="mono"><Link className="underline" href={`/safe/risk/${h.id}`}>{h.ref}</Link></td>
                <td><span className={"ent " + h.entity}>{h.entity}</span></td>
                <td><Link href={`/safe/risk/${h.id}`}><b>{h.title}</b></Link><div className="mini">{h.source === "moc" ? `MOC ${h.mocs?.ref ?? ""}` : h.source === "report" ? `safety report ${h.report_id ?? ""}` : h.source}</div></td>
                <td><RiskPill lik={h.lik_before} sev={h.sev_before} /> → <RiskPill lik={h.lik_after} sev={h.sev_after} /></td>
                <td className="mono">{h.owner_role ?? "—"}</td>
                <td className={"mono" + (h.review_date && h.review_date < today && h.status !== "closed" ? " red" : "")}>{h.review_date ?? "—"}</td>
                <td><span className={"pill " + (HZ_STATUS[h.status]?.[1] ?? "")}>{HZ_STATUS[h.status]?.[0] ?? h.status}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="p-6 text-slate6">No hazard{q ? " matching the search" : ""}.</td></tr>}
          </tbody>
        </table>
      </section>
      {edit && (
        <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">+ Add a hazard</span><span className="mini">rated on its own page</span></summary>
          <form action={createHazard} className="cb grid grid-cols-3 gap-3">
            <label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={s.entity !== "ALL" ? s.entity : s.entities[0]}>{s.entities.map((e) => <option key={e} value={e}>{e} — {ENT[e]?.name ?? e}</option>)}</select></label>
            <label className="col-span-2"><span className="mini">Hazard</span><input name="title" className="inp" required placeholder="e.g. Runway incursion at a non-towered aerodrome" /></label>
            <label className="col-span-2"><span className="mini">Worst credible consequence</span><input name="consequence" className="inp" /></label>
            <label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" placeholder="NPFO" /></label>
            <label className="col-span-3"><span className="mini">Description</span><textarea name="description" className="inp" rows={2} /></label>
            <input type="hidden" name="source" value="other" />
            <div className="col-span-3 flex justify-end"><button className="btn primary">Add to the register</button></div>
          </form>
        </details>
      )}
    </>
  );
}
