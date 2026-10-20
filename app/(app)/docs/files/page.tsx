import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader, Metric } from "@/components/Page";
import { daysUntil, type Certificate } from "@/lib/docs";

export default async function Certificates() {
  const s = await getSession();
  if (!s) redirect("/login");
  const sb = await supabaseServer();
  let q = sb.from("certificates").select("*").order("valid_until", { ascending: true, nullsFirst: false });
  if (s.entity !== "ALL") q = q.eq("entity", s.entity);
  const { data } = await q;
  const rows = (data ?? []) as Certificate[];
  const soon = rows.filter((c) => { const d = daysUntil(c.valid_until); return d !== null && d <= 90; });
  const expired = rows.filter((c) => { const d = daysUntil(c.valid_until); return d !== null && d < 0; });
  return (
    <>
      <PageHeader eyebrow="Documents · Certificates & Validities" title="Certificates & Validities" sub="Organisation approvals and aircraft documents, with their validity. Alerts at 90 / 30 / 7 days (DOC-10)." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Certificates" value={rows.length} />
        <Metric label="Expiring ≤ 90 days" value={soon.length - expired.length} tone={soon.length - expired.length ? "amber" : undefined} />
        <Metric label="Expired" value={expired.length} tone={expired.length ? "red" : undefined} />
      </div>
      <section className="card">
        <table className="tbl"><thead><tr><th>Entity</th><th>Scope</th><th>Kind</th><th>Title</th><th>Issuer</th><th>Valid until</th></tr></thead>
          <tbody>
            {rows.map((c) => { const d = daysUntil(c.valid_until); return (
              <tr key={c.id}><td><span className={"ent " + c.entity}>{c.entity}</span></td><td className="mini">{c.scope}{c.registration ? ` · ${c.registration}` : ""}</td><td className="mini">{c.kind}</td><td><b>{c.title}</b>{c.file_path && <div className="mini">{c.file_path.startsWith("wm:") ? "file in Web Manuals (to migrate)" : <a className="underline" href={`/api/files/${c.file_path}`} target="_blank" rel="noreferrer">Open file (PDF)</a>}</div>}</td><td className="mini">{c.issuer}</td>
                <td className="mono">{c.valid_until ?? "no expiry"}{d !== null && <div className={"mini" + (d < 0 ? " red" : "")}>{d < 0 ? `expired ${-d} d ago` : `${d} d left`}</div>}</td></tr>); })}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-slate6">No certificate in this scope yet.</td></tr>}
          </tbody></table>
      </section>
    </>
  );
}
