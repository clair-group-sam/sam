import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { STEP_LABEL, listManuals } from "@/lib/docs";

const FAMILY_COLORS: Record<string, string> = { "1": "#7d166d", "2": "#0e8cc4", "3": "#248a3d", "4": "#b86e00", "5": "#b43a0f", "6": "#6b5bd2" };
type Row = Awaited<ReturnType<typeof listManuals>>[number];
type Node = { name: string; full: string; depth: number; count: number; worst: 0 | 1 | 2; children: Map<string, Node> };

function status(r: Row): 0 | 1 | 2 { return r.working ? 1 : r.current ? 0 : 2; }
function buildTree(rows: Row[]): Map<string, Node> {
  const root = new Map<string, Node>();
  for (const r of rows) {
    const parts = (r.manual.path ?? "Unfiled").split(" › ");
    let level = root; let full = "";
    parts.forEach((name, i) => {
      full = full ? `${full} › ${name}` : name;
      let n = level.get(name);
      if (!n) { n = { name, full, depth: i, count: 0, worst: 0, children: new Map() }; level.set(name, n); }
      n.count++; n.worst = Math.max(n.worst, status(r)) as 0 | 1 | 2;
      level = n.children;
    });
  }
  return root;
}

export default async function Library({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { q = "", folder = "" } = await searchParams;
  const rows = await listManuals(s);
  const tree = buildTree(rows);
  const sbc = await supabaseServer();
  let cq = sbc.from("certificates").select("id", { count: "exact", head: true });
  if (s.entity !== "ALL") cq = cq.eq("entity", s.entity);
  const { count: certCount } = await cq;
  const inFolder = folder ? rows.filter((r) => (r.manual.path ?? "Unfiled") === folder || (r.manual.path ?? "").startsWith(folder + " › ")) : rows;
  const published = rows.filter((r) => r.current).length, drafts = rows.filter((r) => r.workings.length).length, never = rows.filter((r) => !r.current).length;

  let hits: { manual_id: string; code: string; title: string; ref: string; stitle: string | null; snippet: string }[] = [];
  if (q.trim()) {
    const sb = await supabaseServer();
    const { data } = await sb.from("revision_sections").select("ref,title,body_text,revision_id,revisions!inner(manual_id,step,manuals!inner(code,title,entity))").textSearch("body_text", q, { type: "websearch", config: "simple" }).limit(30);
    type Hit = { ref: string; title: string | null; body_text: string; revision_id: string; revisions: { manual_id: string; step: string; manuals: { code: string; title: string; entity: string } } };
    hits = ((data ?? []) as unknown as Hit[]).filter((h) => (s.entity === "ALL" || h.revisions.manuals.entity === s.entity) && (h.revisions.step === "published" || h.revisions.step === "repository")).map((h) => {
      const i = h.body_text.toLowerCase().indexOf(q.toLowerCase().split(" ")[0]);
      return { manual_id: h.revisions.manual_id, code: h.revisions.manuals.code, title: h.revisions.manuals.title, ref: h.ref, stitle: h.title, snippet: h.body_text.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, " ") };
    });
  }
  const scope = s.entity === "ALL" ? "all entities" : `${ENT[s.entity]?.name} (${s.entity})`;
  const famColor = (name: string) => FAMILY_COLORS[name.trim()[0]] ?? "#5b7183";
  const dot = (w: 0 | 1 | 2) => (w === 2 ? "var(--terra)" : w === 1 ? "var(--amber)" : "var(--green)");

  const renderNodes = (nodes: Map<string, Node>, color?: string): React.ReactNode => [...nodes.values()].map((n) => (
    <div key={n.full}>
      <Link href={`/docs/lib?folder=${encodeURIComponent(n.full)}`} className={"fnode d" + n.depth + (folder === n.full ? " on" : "")} style={n.depth === 0 ? { borderLeftColor: famColor(n.name) } : undefined}>
        <i className="fdot" style={{ background: dot(n.worst) }} />
        <span className="fname" style={n.depth === 0 ? { color: color ?? famColor(n.name) } : undefined}>{n.name}</span>
        <span className="fcount">{n.count}</span>
      </Link>
      {n.children.size > 0 && renderNodes(n.children, color ?? famColor(n.name))}
    </div>
  ));

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
          <div className="ch"><span className="eyebrow">{hits.length} passage{hits.length === 1 ? "" : "s"} for “{q}” in published manuals</span></div>
          <table className="tbl"><tbody>
            {hits.map((h, i) => (<tr key={i}><td className="mono" style={{ width: 140 }}>{h.code} · {h.ref}</td><td><Link href={`/docs/manual/${h.manual_id}?sec=${encodeURIComponent(h.ref)}&q=${encodeURIComponent(q)}`}><b>{h.stitle ?? h.ref}</b></Link><div className="mini">…{h.snippet}…</div></td></tr>))}
            {!hits.length && <tr><td className="p-5 text-slate6">No passage found.</td></tr>}
          </tbody></table>
        </section>
      )}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Manuals" value={rows.length} hint="structured, revisable" />
        <Metric label="Published" value={published} hint="current revision available" />
        <Metric label="Revisions in progress" value={drafts} tone={drafts ? "amber" : undefined} hint="draft, review or authority" />
        <Metric label="Never published" value={never} tone={never ? "red" : undefined} hint="to clean or publish" />
      </div>
      <div className="flex gap-4 items-start">
        <aside className="card folders">
          <div className="ch"><span className="eyebrow">Folders</span><span className="mini">colour = worst status inside</span></div>
          <div className="p-2">
            <Link href="/docs/lib" className={"fnode d0 all" + (!folder ? " on" : "")}><span className="fname">All documents</span><span className="fcount">{rows.length}</span></Link>
            <Link href="/docs/files" className="fnode d0" style={{ borderLeftColor: FAMILY_COLORS["1"] }} title="Certificates & Validities">
              <i className="fdot" style={{ background: "var(--green)" }} /><span className="fname" style={{ color: FAMILY_COLORS["1"] }}>1. Certificates</span><span className="fcount">{certCount ?? 0}</span>
            </Link>
            <Link href="/docs/files" className="fnode d1"><i className="fdot" style={{ background: "var(--green)" }} /><span className="fname">Approvals & validities ›</span><span className="fcount">{certCount ?? 0}</span></Link>
            {renderNodes(tree)}
          </div>
        </aside>
        <section className="card flex-1 min-w-0">
          <div className="ch"><span className="eyebrow">{folder || "All documents"}</span><span className="mini">{inFolder.length} document{inFolder.length > 1 ? "s" : ""}</span></div>
          <table className="tbl">
            <thead><tr><th style={{ width: 70 }}>Entity</th><th style={{ width: 150 }}>Code</th><th>Title</th><th style={{ width: 100 }}>Owner</th><th style={{ width: 120 }}>Current</th><th style={{ width: 190 }}>Status</th></tr></thead>
            <tbody>
              {inFolder.map(({ manual, current, workings }) => (
                <tr key={manual.id}>
                  <td><span className={"ent " + manual.entity}>{manual.entity}</span></td>
                  <td className="mono">{manual.code}</td>
                  <td><Link href={`/docs/manual/${manual.id}`}><b>{manual.title}</b></Link>{!folder && <div className="mini">{manual.path}</div>}</td>
                  <td className="mini">{manual.owner_role}</td>
                  <td className="mono">{current ? `Iss ${current.issue} Rev ${current.rev}` : "—"}{current?.published_at && <div className="mini">{current.published_at}</div>}</td>
                  <td>{current ? <span className="pill green">Published</span> : <span className="pill red">Never published</span>}{workings.map((w) => <span key={w.id} className="pill amber ml-1">Rev {w.rev} · {STEP_LABEL[w.step]}</span>)}</td>
                </tr>
              ))}
              {!inFolder.length && <tr><td colSpan={6} className="p-6 text-slate6">No document here.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
