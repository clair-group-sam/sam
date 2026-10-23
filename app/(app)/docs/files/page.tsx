import Link from "next/link";
import { redirect } from "next/navigation";
import { mayCreateManual } from "@/lib/create";
import { kindLabel } from "@/lib/cert";
import { moveCertificate } from "@/app/(app)/docs/drop/actions";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader, Metric } from "@/components/Page";
import { daysUntil, type Certificate } from "@/lib/docs";

export default async function Certificates({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { all } = await searchParams;
  const canDrop = await mayCreateManual(s);
  const sb = await supabaseServer();
  let q = sb.from("certificates").select("*").order("valid_until", { ascending: true, nullsFirst: false });
  if (s.entity !== "ALL") q = q.eq("entity", s.entity);
  const { data } = await q;
  const everything = (data ?? []) as (Certificate & { archived_at?: string | null; reference?: string | null; summary?: string | null; folder?: string | null })[];
  const rows = all ? everything : everything.filter((c) => !c.archived_at);
  const superseded = everything.length - everything.filter((c) => !c.archived_at).length;
  // folders: one card per entity › folder
  const byKey = new Map<string, typeof rows>();
  for (const c of rows) { const k = `${c.entity}|${c.folder ?? "Unfiled"}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(c); }
  const groups = [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const foldersOf = new Map<string, string[]>();
  for (const c of everything) if (c.folder) { const l = foldersOf.get(c.entity) ?? []; if (!l.includes(c.folder)) l.push(c.folder); foldersOf.set(c.entity, l.sort()); }
  const soon = rows.filter((c) => { const d = daysUntil(c.valid_until); return d !== null && d <= 90; });
  const expired = rows.filter((c) => { const d = daysUntil(c.valid_until); return d !== null && d < 0; });
  return (
    <>
      <PageHeader eyebrow="Documents · Certificates & Validities" title="Certificates & Validities" sub="Organisation approvals and aircraft documents, with their validity. Alerts at 90 / 30 / 7 days (DOC-10)."
        right={<>{superseded > 0 && <Link className="btn" href={all ? "/docs/files" : "/docs/files?all=1"}>{all ? "Hide superseded" : `Show superseded (${superseded})`}</Link>}{canDrop && <Link className="btn primary" href="/docs/drop">+ Drop a document</Link>}</>} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Certificates" value={rows.length} />
        <Metric label="Expiring ≤ 90 days" value={soon.length - expired.length} tone={soon.length - expired.length ? "amber" : undefined} />
        <Metric label="Expired" value={expired.length} tone={expired.length ? "red" : undefined} />
      </div>
      {groups.map(([key, list]) => (
        <section key={key} className="card mb-4">
          <div className="ch"><span className="eyebrow"><span className={"ent " + list[0].entity}>{list[0].entity}</span> {list[0].folder ?? "Unfiled"}</span><span className="mini">{list.length}</span></div>
          <table className="tbl"><thead><tr><th>Kind</th><th>Title</th><th>Issuer</th><th>Valid until</th>{canDrop && <th>Folder</th>}</tr></thead>
            <tbody>
              {list.map((c) => { const d = daysUntil(c.valid_until); return (
                <tr key={c.id}><td className="mini">{kindLabel(c.kind)}{c.registration ? <div className="mono">{c.registration}</div> : null}</td>
                  <td style={{ opacity: c.archived_at ? 0.55 : 1 }}><b>{c.title}</b>{c.archived_at && <span className="pill ml-2">superseded</span>}{c.reference && <div className="mini">ref. {c.reference}</div>}{c.file_path && <div className="mini">{c.file_path.startsWith("wm:") ? "file in Web Manuals (to migrate)" : <a className="underline" href={`/api/files/${c.file_path}`} target="_blank" rel="noreferrer">Open file</a>}</div>}</td>
                  <td className="mini">{c.issuer}</td>
                  <td className="mono">{c.valid_until ?? "no expiry"}{d !== null && <div><span className={"pill " + (d < 0 ? "red" : d <= 30 ? "red" : d <= 90 ? "amber" : "green")}>{d < 0 ? `expired ${-d} d ago` : `${d} d left`}</span></div>}</td>
                  {canDrop && <td style={{ width: 300 }}>
                    <form action={moveCertificate} className="flex gap-1">
                      <input type="hidden" name="id" value={c.id} />
                      <select name="folder" defaultValue={c.folder ?? ""} className="inp" style={{ padding: "4px 6px", fontSize: 12 }}>{(foldersOf.get(c.entity) ?? []).map((f) => <option key={f} value={f}>{f}</option>)}</select>
                      <input name="folder_new" className="inp" placeholder="or new" style={{ padding: "4px 6px", fontSize: 12, width: 90 }} />
                      <button className="btn" type="submit" style={{ padding: "4px 8px", fontSize: 12 }}>Move</button>
                    </form></td>}
                </tr>); })}
            </tbody></table>
        </section>
      ))}
      {!rows.length && <section className="card"><div className="cb text-slate6">No certificate in this scope yet.</div></section>}
    </>
  );
}
