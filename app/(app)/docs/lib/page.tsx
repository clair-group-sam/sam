import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { STEP_LABEL, folderOf, listManuals } from "@/lib/docs";

export default async function Library({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { q = "" } = await searchParams;
  const rows = await listManuals(s);
  const folders = new Map<string, typeof rows>();
  for (const r of rows) { const f = folderOf(r.manual); folders.set(f, [...(folders.get(f) ?? []), r]); }
  const published = rows.filter((r) => r.current).length;
  const drafts = rows.filter((r) => r.working).length;
  const never = rows.filter((r) => !r.current).length;

  let hits: { manual_id: string; code: string; title: string; ref: string; stitle: string | null; snippet: string; revision_id: string }[] = [];
  if (q.trim()) {
    const sb = await supabaseServer();
    const { data } = await sb.from("revision_sections").select("ref,title,body_text,revision_id,revisions!inner(manual_id,step,manuals!inner(code,title,entity))").textSearch("body_text", q, { type: "websearch", config: "simple" }).limit(30);
    type Hit = { ref: string; title: string | null; body_text: string; revision_id: string; revisions: { manual_id: string; step: string; manuals: { code: string; title: string; entity: string } } };
    hits = ((data ?? []) as unknown as Hit[]).filter((h) => s.entity === "ALL" || h.revisions.manuals.entity === s.entity).map((h) => {
      const i = h.body_text.toLowerCase().indexOf(q.toLowerCase().split(" ")[0]);
      const snippet = h.body_text.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, " ");
      return { manual_id: h.revisions.manual_id, code: h.revisions.manuals.code, title: h.revisions.manuals.title, ref: h.ref, stitle: h.title, snippet, revision_id: h.revision_id };
    });
  }
  const scope = s.entity === "ALL" ? "all entities" : `${ENT[s.entity]?.name} (${s.entity})`;
  return (
    <>
      <PageHeader eyebrow="Documents · Library" title="Document library" sub={`Manuals as the unit of revision and approval (DOC-01) · ${scope}`} />
      <form className="card mb-5" action="/docs/lib" method="get">
        <div className="p-3 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search the manuals — title, chapter or text (e.g. sous-traitance, MEL, dégivrage)…" className="flex-1 border border-line rounded-lg px-4 py-2.5 text-sm" />
          <button className="btn primary" type="submit">Search</button>
          {q && <Link href="/docs/lib" className="btn">Clear</Link>}
        </div>
      </form>
      {q && (
        <section className="card mb-5">
          <div className="ch"><span className="eyebrow">{hits.length} passage{hits.length === 1 ? "" : "s"} for “{q}”</span></div>
          <table className="tbl"><tbody>
            {hits.map((h, i) => (
              <tr key={i}><td className="mono" style={{ width: 140 }}>{h.code} · {h.ref}</td>
                <td><Link href={`/docs/manual/${h.manual_id}?sec=${encodeURIComponent(h.ref)}&q=${encodeURIComponent(q)}`}><b>{h.stitle ?? h.ref}</b></Link><div className="mini">…{h.snippet}…</div></td></tr>
            ))}
            {!hits.length && <tr><td className="p-5 text-slate6">No passage found. Full-text search covers the published content imported so far (Astontec CAE Rev 05).</td></tr>}
          </tbody></table>
        </section>
      )}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Manuals" value={rows.length} hint="structured, revisable" />
        <Metric label="Published" value={published} hint="current revision available" />
        <Metric label="Open drafts" value={drafts} tone={drafts ? "amber" : undefined} hint="awaiting review or approval" />
        <Metric label="Never published" value={never} tone={never ? "red" : undefined} hint="to clean or publish" />
      </div>
      {[...folders.entries()].map(([folder, items]) => (
        <section className="card mb-4" key={folder}>
          <div className="ch"><span className="eyebrow">{folder}</span><span className="mini">{items.length} document{items.length > 1 ? "s" : ""}</span></div>
          <table className="tbl">
            <thead><tr><th style={{ width: 70 }}>Entity</th><th style={{ width: 150 }}>Code</th><th>Title</th><th style={{ width: 110 }}>Owner</th><th style={{ width: 120 }}>Current</th><th style={{ width: 160 }}>Status</th></tr></thead>
            <tbody>
              {items.map(({ manual, current, working }) => (
                <tr key={manual.id}>
                  <td><span className={"ent " + manual.entity}>{manual.entity}</span></td>
                  <td className="mono">{manual.code}</td>
                  <td><Link href={`/docs/manual/${manual.id}`}><b>{manual.title}</b></Link><div className="mini">{manual.path}</div></td>
                  <td className="mini">{manual.owner_role}</td>
                  <td className="mono">{current ? `Iss ${current.issue} Rev ${current.rev}` : "—"}{current?.published_at && <div className="mini">{current.published_at}</div>}</td>
                  <td>{working ? <span className="pill amber">{STEP_LABEL[working.step]}</span> : current ? <span className="pill green">Published</span> : <span className="pill red">Never published</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!rows.length && <section className="card"><div className="cb text-slate6">No manual in this scope yet. Astontec is imported from Web Manuals; Astonfly follows once its index is extracted.</div></section>}
    </>
  );
}
