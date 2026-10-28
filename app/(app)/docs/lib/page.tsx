import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { STEP_LABEL, listManuals } from "@/lib/docs";
import { mayCreateManual } from "@/lib/create";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENTS4 } from "@/lib/nav";
import FolderTree, { type TNode } from "@/components/FolderTree";
import { isTestData, TEST_PILL_TITLE } from "@/lib/testdata";

const FAMILY_COLORS: Record<string, string> = { "1": "#7d166d", "2": "#0e8cc4", "3": "#248a3d", "4": "#b86e00", "5": "#b43a0f", "6": "#6b5bd2" };
type Row = Awaited<ReturnType<typeof listManuals>>[number];
type Node = { name: string; full: string; depth: number; count: number; worst: 0 | 1 | 2; children: Map<string, Node> };

function status(r: Row): 0 | 1 | 2 { return r.working ? 1 : r.current ? 0 : 2; }
function buildTree(rows: Row[], byEntity = false): Map<string, Node> {
  const root = new Map<string, Node>();
  for (const r of rows) {
    const parts = [...(byEntity ? [`${ENT[r.manual.entity]?.name ?? r.manual.entity} (${r.manual.entity})`] : []), ...(r.manual.path ?? "Unfiled").split(" › ")];
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
  const canCreate = await mayCreateManual(s);
  const ents = [...new Set(rows.map((r) => r.manual.entity))];
  const several = s.entity === "ALL" && ents.length > 1;
  const tree = buildTree(rows, several);
  const entOfFolder = (f: string) => (several ? /\(([A-Z]{3})\)$/.exec(f.split(" › ")[0])?.[1] ?? null : null);
  const sbc = await supabaseServer();
  let cq = sbc.from("certificates").select("id", { count: "exact", head: true });
  if (s.entity !== "ALL") cq = cq.eq("entity", s.entity);
  const { count: certCount } = await cq;
  const pathOf = (r: Row) => [...(several ? [`${ENT[r.manual.entity]?.name ?? r.manual.entity} (${r.manual.entity})`] : []), ...(r.manual.path ?? "Unfiled").split(" › ")].join(" › ");
  const inFolder = folder ? rows.filter((r) => pathOf(r) === folder || pathOf(r).startsWith(folder + " › ")) : rows;
  void entOfFolder;

  // shortcuts across entities: to acknowledge, favourites, recently opened
  const byId = new Map(rows.map((r) => [r.manual.id, r]));
  let favs: Row[] = [], recent: Row[] = [], toRead: { title: string; link: string; entity: string }[] = [];
  if (s.person && !q) {
    const adm = supabaseAdmin();
    const [f, v, t] = await Promise.all([
      adm.from("manual_favourites").select("manual_id").eq("person_id", s.person.id).order("created_at", { ascending: false }),
      adm.from("manual_views").select("manual_id").eq("person_id", s.person.id).order("viewed_at", { ascending: false }).limit(12),
      adm.from("tasks").select("title,link,entity").eq("owner_person", s.person.id).eq("kind", "reading").eq("status", "open").order("due").limit(8),
    ]);
    favs = ((f.data ?? []) as { manual_id: string }[]).map((x) => byId.get(x.manual_id)).filter(Boolean) as Row[];
    recent = ((v.data ?? []) as { manual_id: string }[]).map((x) => byId.get(x.manual_id)).filter(Boolean).slice(0, 8) as Row[];
    toRead = ((t.data ?? []) as { title: string; link: string; entity: string }[]).filter((x) => s.entity === "ALL" || x.entity === s.entity);
  }
  const realRows = rows.filter((r) => !isTestData(r.manual.code, r.manual.title)); // FB-024
  const testRows = rows.length - realRows.length;
  const published = realRows.filter((r) => r.current).length, drafts = realRows.filter((r) => r.workings.length).length, never = realRows.filter((r) => !r.current).length;

  // Search: the manuals of the working entity, or every manual of the scope in group view; published text only. Results grouped by manual,
  // each with the chapters where the words are found (one line per passage, a passage repeated in several chapters shown once).
  type Hit = { manual_id: string; entity: string; code: string; title: string; ref: string; stitle: string | null; snippet: string; also: string[] };
  type Group = { manual_id: string; entity: string; code: string; title: string; titleMatch: boolean; hits: Hit[] };
  let groups: Group[] = []; let nHits = 0;
  if (q.trim()) {
    const sb = await supabaseServer();
    let qq = sb.from("revision_sections").select("ref,title,body_text,revision_id,revisions!inner(manual_id,step,manuals!inner(code,title,entity))").textSearch("body_text", q, { type: "websearch", config: "simple" }).in("revisions.step", ["published", "repository"]);
    qq = s.entity === "ALL" ? (s.group ? qq : qq.in("revisions.manuals.entity", s.entities)) : qq.eq("revisions.manuals.entity", s.entity);
    const { data } = await qq.limit(400);
    type Row = { ref: string; title: string | null; body_text: string; revision_id: string; revisions: { manual_id: string; step: string; manuals: { code: string; title: string; entity: string } } };
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !/^(or|and|et|ou)$/.test(w)).map((w) => w.replace(/^[-"]+|"+$/g, ""));
    const byM = new Map<string, Group>();
    for (const h of (data ?? []) as unknown as Row[]) {
      const m = h.revisions.manuals; const low = h.body_text.toLowerCase();
      const i = Math.max(0, Math.min(...words.map((w) => { const k = low.indexOf(w); return k < 0 ? Infinity : k; })));
      const snippet = h.body_text.slice(Math.max(0, (Number.isFinite(i) ? i : 0) - 80), (Number.isFinite(i) ? i : 0) + 170).replace(/\s+/g, " ");
      if (!byM.has(h.revisions.manual_id)) byM.set(h.revisions.manual_id, { manual_id: h.revisions.manual_id, entity: m.entity, code: m.code, title: m.title, titleMatch: false, hits: [] });
      const g = byM.get(h.revisions.manual_id)!;
      if (g.hits.some((x) => x.ref === h.ref)) continue; // the same chapter in another published revision of the manual
      const dup = g.hits.find((x) => x.snippet === snippet);
      if (dup) { if (!dup.also.includes(h.ref)) dup.also.push(h.ref); } else g.hits.push({ manual_id: h.revisions.manual_id, entity: m.entity, code: m.code, title: m.title, ref: h.ref, stitle: h.title, snippet, also: [] });
    }
    // manuals whose code or title matches come first, even without a passage
    const ql = q.toLowerCase();
    for (const r of realRows) if (`${r.manual.code} ${r.manual.title}`.toLowerCase().includes(ql) && (s.entity === "ALL" || r.manual.entity === s.entity)) {
      const g = byM.get(r.manual.id) ?? { manual_id: r.manual.id, entity: r.manual.entity, code: r.manual.code, title: r.manual.title, titleMatch: true, hits: [] }; g.titleMatch = true; byM.set(r.manual.id, g);
    }
    const nat = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    groups = [...byM.values()].map((g) => ({ ...g, hits: g.hits.sort((x, y) => nat(x.ref, y.ref)) })).sort((x, y) => Number(y.titleMatch) - Number(x.titleMatch) || y.hits.length - x.hits.length || nat(x.code, y.code));
    nHits = groups.reduce((n, g) => n + g.hits.length, 0);
  }
  const scope = s.entity === "ALL" ? "all entities" : `${ENT[s.entity]?.name} (${s.entity})`;
  const famColor = (name: string) => FAMILY_COLORS[name.trim()[0]] ?? "#5b7183";
  const ENT_COLOR: Record<string, string> = { AJD: "#006c9c", ASJ: "#3a7a1b", ASF: "#b08300", TEC: "#b43a0f" };

  // certificates of each entity, as "1. Certificates" with their folders, inside the entity (or at the top for one entity)
  let cq2 = supabaseAdmin().from("certificates").select("entity,folder,valid_until").is("archived_at", null);
  if (s.entity !== "ALL") cq2 = cq2.eq("entity", s.entity); else if (!s.group) cq2 = cq2.in("entity", s.entities);
  const { data: certRows } = await cq2;
  const today = new Date().toISOString().slice(0, 10), in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const certWorst = (v: string | null): 0 | 1 | 2 => (!v ? 0 : v < today ? 2 : v <= in90 ? 1 : 0);
  const certNode = (entity: string, prefix: string, depth: number): TNode | null => {
    const list = ((certRows ?? []) as { entity: string; folder: string | null; valid_until: string | null }[]).filter((c) => c.entity === entity);
    const folders = new Map<string, { n: number; w: 0 | 1 | 2 }>();
    for (const c of list) { const f = c.folder ?? "Unfiled"; const x = folders.get(f) ?? { n: 0, w: 0 as 0 | 1 | 2 }; x.n++; x.w = Math.max(x.w, certWorst(c.valid_until)) as 0 | 1 | 2; folders.set(f, x); }
    const full = prefix ? `${prefix} › 1. Certificates` : "1. Certificates";
    return { name: "1. Certificates", full, depth, count: list.length, worst: Math.max(0, ...[...folders.values()].map((x) => x.w)) as 0 | 1 | 2, href: `/docs/files?entity=${entity}`, color: FAMILY_COLORS["1"],
      children: [...folders.entries()].sort().map(([f, x]) => ({ name: f, full: `${full} › ${f}`, depth: depth + 1, count: x.n, worst: x.w, href: `/docs/files?entity=${entity}&folder=${encodeURIComponent(f)}`, children: [] })) };
  };
  const toT = (nodes: Map<string, Node>, color?: string): TNode[] => [...nodes.values()].map((n) => {
    const isEnt = several && n.depth === 0;
    const c = isEnt ? ENT_COLOR[/\(([A-Z]{3})\)$/.exec(n.name)?.[1] ?? ""] : color ?? famColor(n.name);
    const kids = toT(n.children, isEnt ? undefined : c);
    return { name: n.name, full: n.full, depth: n.depth, count: n.count, worst: n.worst, href: `/docs/lib?folder=${encodeURIComponent(n.full)}`, color: c, entity: isEnt, children: kids };
  });
  let tnodes = toT(tree);
  if (several) {
    // every entity in scope gets its node (with its certificates) even without a manual yet
    const shown = (s.group ? ENTS4 : s.entities).filter((e) => tnodes.some((t) => t.name.endsWith(`(${e})`)) || ((certRows ?? []) as { entity: string }[]).some((c) => c.entity === e));
    tnodes = shown.map((e) => {
      const label = `${ENT[e]?.name ?? e} (${e})`;
      const t = tnodes.find((x) => x.name === label) ?? { name: label, full: label, depth: 0, count: 0, worst: 0 as 0 | 1 | 2, href: `/docs/lib?folder=${encodeURIComponent(label)}`, color: ENT_COLOR[e], entity: true, children: [] };
      const cn = certNode(e, label, 1);
      return { ...t, count: t.count + (cn?.count ?? 0), children: cn && cn.count ? [cn, ...t.children] : t.children };
    });
  } else if (s.entity !== "ALL" || ents.length === 1) {
    const e = s.entity !== "ALL" ? s.entity : ents[0];
    const cn = e ? certNode(e, "", 0) : null;
    if (cn) tnodes = [cn, ...tnodes];
  }

  return (
    <>
      <PageHeader eyebrow="Documents · Library" title="Document library" sub={`Manuals as the unit of revision and approval (DOC-01) · ${scope}`}
        right={canCreate ? <><Link href="/docs/drop" className="btn">+ Drop a document</Link><Link href={`/docs/new${s.entity !== "ALL" ? `?entity=${s.entity}` : ""}`} className="btn primary">+ New manual</Link></> : undefined} />
      <form className="card mb-5" action="/docs/lib" method="get">
        <div className="p-3 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search the manuals — title, chapter or text (e.g. sous-traitance, MEL, dégivrage)…" className="flex-1 border border-line rounded-lg px-4 py-2.5 text-sm" />
          <button className="btn primary" type="submit">Search</button>
          {q && <Link href="/docs/lib" className="btn">Clear</Link>}
        </div>
      </form>
      {q && (
        <section className="card mb-5">
          <div className="ch"><span className="eyebrow">“{q}” · {groups.length} manual{groups.length === 1 ? "" : "s"} · {nHits} passage{nHits === 1 ? "" : "s"}</span><span className="mini">published text · {s.entity === "ALL" ? "every manual of the group" : `manuals of ${ENT[s.entity]?.name ?? s.entity}`}</span></div>
          <div className="srch">
            {groups.map((g) => {
              const href = (ref?: string) => `/docs/manual/${g.manual_id}?${ref ? `sec=${encodeURIComponent(ref)}&` : ""}q=${encodeURIComponent(q)}`;
              return (
                <details key={g.manual_id} className="srch-m" open={groups.length <= 6 || g.titleMatch}>
                  <summary><span className={"ent " + g.entity}>{g.entity}</span><Link href={href()} className="srch-t"><b>{g.code}</b> {g.title}</Link><span className="mini ml-auto">{g.hits.length ? `${g.hits.length} passage${g.hits.length === 1 ? "" : "s"}` : "title"}</span></summary>
                  {g.hits.length > 0 && <ul>{g.hits.slice(0, 12).map((h, i) => (
                    <li key={i}><Link href={href(h.ref)}><span className="mono">{h.ref}</span> <b>{h.stitle ?? ""}</b></Link>{h.also.length ? <span className="mini"> · also in {h.also.join(", ")}</span> : null}<div className="mini">…{h.snippet}…</div></li>))}
                    {g.hits.length > 12 && <li><Link className="underline mini" href={href()}>+ {g.hits.length - 12} more in {g.code} — open the manual with the search</Link></li>}</ul>}
                </details>);
            })}
            {!groups.length && <p className="p-5 text-slate6">Nothing found in the published manuals{s.entity === "ALL" ? "" : ` of ${ENT[s.entity]?.name ?? s.entity} — try the group view to search every manual`}.</p>}
          </div>
        </section>
      )}
      {!q && (toRead.length > 0 || favs.length > 0 || recent.length > 0) && (
        <div className="shortcuts">
          <section className="card"><div className="ch"><span className="eyebrow">To acknowledge</span><span className="mini">{toRead.length}</span></div>
            {toRead.map((t, i) => <div key={i} className="row"><span className={"ent " + t.entity}>{t.entity}</span><Link href={t.link} className="underline">{t.title}</Link></div>)}
            {!toRead.length && <div className="row mini">Nothing to read.</div>}</section>
          <section className="card"><div className="ch"><span className="eyebrow">★ Favourites</span><span className="mini">{favs.length}</span></div>
            {favs.map((r) => <div key={r.manual.id} className="row"><span className={"ent " + r.manual.entity}>{r.manual.entity}</span><Link href={`/docs/manual/${r.manual.id}`}><b className="mono">{r.manual.code}</b> {r.manual.title}</Link></div>)}
            {!favs.length && <div className="row mini">Open a manual and click ☆ to add it here.</div>}</section>
          <section className="card"><div className="ch"><span className="eyebrow">Recently opened</span></div>
            {recent.map((r) => <div key={r.manual.id} className="row"><span className={"ent " + r.manual.entity}>{r.manual.entity}</span><Link href={`/docs/manual/${r.manual.id}`}><b className="mono">{r.manual.code}</b> {r.manual.title}</Link><span className="mini">{r.current ? `Rev ${r.current.rev}` : ""}</span></div>)}
            {!recent.length && <div className="row mini">—</div>}</section>
        </div>
      )}
      {q && <p className="mini mb-4">The passages above are the search result. <Link className="underline" href="/docs/lib">Clear the search</Link> to browse the library.</p>}
      {!q && <><div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Manuals" value={realRows.length} hint={`structured, revisable${testRows ? ` · + ${testRows} test` : ""}${certCount ? ` · + ${certCount} certificate${certCount > 1 ? "s" : ""} in the folders` : ""}`} />
        <Metric label="Published" value={published} hint="current revision available" />
        <Metric label="Revisions in progress" value={drafts} tone={drafts ? "amber" : undefined} hint="draft, review or authority" />
        <Metric label="Never published" value={never} tone={never ? "red" : undefined} hint="to clean or publish" />
      </div>
      <div className="flex gap-4 items-start">
        <aside className="card folders">
          <div className="ch"><span className="eyebrow">Folders</span><span className="mini">colour = worst status inside</span></div>
          <FolderTree nodes={tnodes} selected={folder} total={rows.length + (certCount ?? 0)} several={several} />{/* FB-006 · folder counts include certificates, so does the total */}
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
                  <td><Link href={`/docs/manual/${manual.id}`}><b>{manual.title}</b></Link>{(manual as typeof manual & { internal?: boolean }).internal && <span className="nature ml-2">internal</span>}{isTestData(manual.code, manual.title) && <span className="pill ml-2" title={TEST_PILL_TITLE}>test</span>}{!folder && <div className="mini">{manual.path}</div>}</td>
                  <td className="mini">{manual.owner_role}</td>
                  <td className="mono">{current ? `Iss ${current.issue} Rev ${current.rev}` : "—"}{current?.published_at && <div className="mini">{current.published_at}</div>}</td>
                  <td>{current ? <span className="pill green">Published</span> : <span className="pill red">Never published</span>}{workings.map((w) => <span key={w.id} className="pill amber ml-1">Rev {w.rev} · {STEP_LABEL[w.step]}</span>)}</td>
                </tr>
              ))}
              {!inFolder.length && <tr><td colSpan={6} className="p-6 text-slate6">No document here.</td></tr>}
            </tbody>
          </table>
        </section>
      </div></>}
    </>
  );
}
