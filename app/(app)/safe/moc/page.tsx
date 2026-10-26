import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { MOC_CATEGORIES, MOC_STATUS, mayEditRisk, tolerability } from "@/lib/risk";

type Row = { id: string; entity: string; ref: string; title: string; category: string; status: string; target_date: string | null; owner_role: string | null; project_id: string | null; hazards: { proposed: boolean; lik_after: number | null; sev_after: string | null; lik_before: number | null; sev_before: string | null }[] };

/** Safety › Management of change: every change, its risk assessment and its state. */
export default async function Mocs({ searchParams }: { searchParams: Promise<{ st?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { st } = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const { data } = await supabaseAdmin().from("mocs").select("id,entity,ref,title,category,status,target_date,owner_role,project_id,hazards(proposed,lik_after,sev_after,lik_before,sev_before)").in("entity", scope).order("created_at", { ascending: false });
  const all = (data ?? []) as unknown as Row[];
  const live = (r: Row) => !["closed", "cancelled"].includes(r.status);
  const rows = st === "closed" ? all.filter((r) => !live(r)) : st === "all" ? all : all.filter(live);
  const worst = (r: Row) => { const t = r.hazards.filter((h) => !h.proposed).map((h) => tolerability(h.lik_after ?? h.lik_before, h.sev_after ?? h.sev_before)); return t.includes("intolerable") ? "intolerable" : t.includes("tolerable") ? "tolerable" : t.length ? "acceptable" : null; };
  return (
    <>
      <PageHeader eyebrow="Safety · Management of change" title="Management of change" sub="ORO.GEN.200(a)(3) · every change gets its risk assessment before it is implemented." right={mayEditRisk(s) ? <Link href="/safe/moc/new" className="btn primary">+ New MOC</Link> : undefined} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="In risk assessment" value={all.filter((r) => r.status === "assessment" || r.status === "draft").length} />
        <Metric label="Approved, to implement" value={all.filter((r) => r.status === "approved").length} tone={all.some((r) => r.status === "approved") ? "amber" : undefined} />
        <Metric label="Implemented, to close" value={all.filter((r) => r.status === "implemented").length} />
      </div>
      <div className="flex gap-2 mb-3">{[["", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={k ? `/safe/moc?st=${k}` : "/safe/moc"} className={"btn" + ((st ?? "") === k ? " on" : "")}>{l}</Link>)}</div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th style={{ width: 150 }}>Ref</th><th style={{ width: 60 }}>Entity</th><th>Change</th><th style={{ width: 120 }}>Hazards</th><th style={{ width: 110 }}>Target</th><th style={{ width: 160 }}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => { const w = worst(r); const kept = r.hazards.filter((h) => !h.proposed).length; const prop = r.hazards.length - kept; return (
              <tr key={r.id}>
                <td className="mono"><Link className="underline" href={`/safe/moc/${r.id}`}>{r.ref}</Link></td>
                <td><span className={"ent " + r.entity}>{r.entity}</span></td>
                <td><Link href={`/safe/moc/${r.id}`}><b>{r.title}</b></Link><div className="mini">{MOC_CATEGORIES[r.category] ?? r.category}{r.owner_role ? ` · ${r.owner_role}` : ""}{r.project_id ? " · from a project" : ""}</div></td>
                <td>{kept}{prop ? <span className="mini"> +{prop} proposed</span> : ""} {w && <span className={"pill " + (w === "intolerable" ? "red" : w === "tolerable" ? "amber" : "green")}>{w}</span>}</td>
                <td className="mono">{r.target_date ?? "—"}</td>
                <td><span className={"pill " + (MOC_STATUS[r.status]?.[1] ?? "")}>{MOC_STATUS[r.status]?.[0] ?? r.status}</span></td>
              </tr>); })}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-slate6">No change.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
