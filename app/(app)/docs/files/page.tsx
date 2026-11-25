import Link from "next/link";
import { fr as frd } from "@/lib/dates";
import { redirect } from "next/navigation";
import { mayCreateManual } from "@/lib/create";
import { kindLabel } from "@/lib/cert";
import { moveCertificate } from "@/app/(app)/docs/drop/actions";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader, Metric } from "@/components/Page";
import { daysUntil, type Certificate } from "@/lib/docs";

export default async function Certificates({ searchParams }: { searchParams: Promise<{ all?: string; entity?: string; folder?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { all, entity: qe, folder: qf } = await searchParams;
  const canDrop = await mayCreateManual(s);
  const sb = await supabaseServer();
  let q = sb.from("certificates").select("*").order("valid_until", { ascending: true, nullsFirst: false });
  if (s.entity !== "ALL") q = q.eq("entity", s.entity); else if (qe && (s.group || s.entities.includes(qe))) q = q.eq("entity", qe); else if (!s.group) q = q.in("entity", s.entities);
  if (qf) q = qf === "Unfiled" ? q.is("folder", null) : q.eq("folder", qf);
  const { data } = await q;
  const everything = (data ?? []) as (Certificate & { archived_at?: string | null; reference?: string | null; summary?: string | null; folder?: string | null })[];
  const rows = all ? everything : everything.filter((c) => !c.archived_at);
  const superseded = everything.length - everything.filter((c) => !c.archived_at).length;
  // classement : Approvals (par catégorie) · Aircraft (par type, puis par immatriculation) · autres dossiers. A folder written
  // "APPROVALS › <category>" or "AIRCRAFT › <type> <reg>" places a document by hand; otherwise its category is read from its title.
  type Row = (typeof rows)[number];
  const approvalCat = (c: Row): string => {
    const f = (c.folder ?? "").split(" › "); if (/^approvals$/i.test(f[0]) && f[1]) return f.slice(1).join(" / ");
    const t = c.title;
    if (/^INS\b|insurance/i.test(t)) return "Insurance";
    if (/CAMO/i.test(t)) return "CAMO";
    if (/^NCC\b|NCC Operations/i.test(t)) return "NCC declarations";
    if (/FAOC|TCO|Block Permit|USA|Part 375|Visa Waiver|Overflight|Customs Bond/i.test(t)) return "Foreign operations";
    if (/EFB|EGLC|LIFUS|Waiver|approval\b/i.test(t) && !/3Letter/i.test(t)) return "Specific approvals";
    return "AOC & operations";
  };
  const aircraftOf = (c: Row): { type: string; reg: string } => {
    const f = (c.folder ?? "").split(" › "); const leaf = /^aircraft$/i.test(f[0]) ? (f[1] ?? "") : "";
    const m = /^(\S+)\s+(\S+)$/.exec(leaf.trim().replace(/\s+/g, " "));
    const reg = c.registration ?? (m ? m[2].replace(/^(9H|F)-?/, "$1-") : "");
    return { type: m?.[1] ?? "All aircraft", reg: reg || "General" };
  };
  const topOf = (c: Row): "Approvals" | "Aircraft" | string => {
    const f0 = (c.folder ?? "").split(" › ")[0];
    if (/^aircraft$/i.test(f0) || c.scope === "aircraft" || /^certificates$/i.test(c.folder ?? "")) return "Aircraft"; // the old "CERTIFICATES" folder holds the aircraft document list
    if (/^approvals$/i.test(f0) || (c.scope === "organisation" && !c.folder)) return "Approvals";
    return c.folder ?? "Unfiled";
  };
  type Node = { key: string; label: string; items: Row[]; kids: Node[] };
  const tree = new Map<string, Node>(); // entity|top
  const nodeIn = (list: Node[], key: string, label: string) => { let n = list.find((x) => x.key === key); if (!n) { n = { key, label, items: [], kids: [] }; list.push(n); } return n; };
  for (const c of rows) {
    const top = topOf(c); const k = `${c.entity}|${top}`;
    if (!tree.has(k)) tree.set(k, { key: k, label: top, items: [], kids: [] });
    const t = tree.get(k)!;
    if (top === "Approvals") nodeIn(t.kids, `${k}|${approvalCat(c)}`, approvalCat(c)).items.push(c);
    else if (top === "Aircraft") { const a = aircraftOf(c); const ty = nodeIn(t.kids, `${k}|${a.type}`, a.type); nodeIn(ty.kids, `${ty.key}|${a.reg}`, a.reg).items.push(c); }
    else t.items.push(c);
  }
  const ORDER = ["Approvals", "Aircraft"];
  const groups = [...tree.values()].sort((a, b) => { const [ea, ta] = a.key.split("|"), [eb, tb] = b.key.split("|"); return ea.localeCompare(eb) || ((ORDER.indexOf(ta) + 1 || 9) - (ORDER.indexOf(tb) + 1 || 9)) || ta.localeCompare(tb); });
  const CAT_ORDER = ["AOC & operations", "CAMO", "NCC declarations", "Specific approvals", "Foreign operations", "Insurance"];
  for (const g of groups) { g.kids.sort((a, b) => ((CAT_ORDER.indexOf(a.label) + 1 || 50) - (CAT_ORDER.indexOf(b.label) + 1 || 50)) || a.label.localeCompare(b.label)); for (const k of g.kids) k.kids.sort((a, b) => a.label.localeCompare(b.label)); }
  const all_ = (n: Node): Row[] => [...n.items, ...n.kids.flatMap(all_)];
  const flags = (list: Row[]) => { const ds = list.map((c) => daysUntil(c.valid_until)); return { ex: ds.filter((d) => d !== null && d < 0).length, sn: ds.filter((d) => d !== null && d >= 0 && d <= 90).length }; };
  const Badges = ({ list }: { list: Row[] }) => { const f = flags(list); return <>{f.ex > 0 && <span className="pill red">{f.ex} expired</span>}{f.sn > 0 && <span className="pill amber">{f.sn} ≤ 90 days</span>}<span className="mini mono" style={{ marginLeft: "auto" }}>{list.length}</span></>; };
  const foldersOf = new Map<string, string[]>();
  for (const c of everything) if (c.folder) { const l = foldersOf.get(c.entity) ?? []; if (!l.includes(c.folder)) l.push(c.folder); foldersOf.set(c.entity, l.sort()); }
  const soon = rows.filter((c) => { const d = daysUntil(c.valid_until); return d !== null && d <= 90; });
  const expired = rows.filter((c) => { const d = daysUntil(c.valid_until); return d !== null && d < 0; });
  const CertTable = ({ list }: { list: Row[] }) => (
          <table className="tbl"><thead><tr><th>Kind</th><th>Title</th><th>Issuer</th><th>Valid until</th>{canDrop && <th>Folder</th>}</tr></thead>
            <tbody>
              {list.map((c) => { const d = daysUntil(c.valid_until); return (
                <tr key={c.id}><td className="mini">{kindLabel(c.kind)}{c.registration ? <div className="mono">{c.registration}</div> : null}</td>
                  <td style={{ opacity: c.archived_at ? 0.55 : 1 }}><b>{c.title}</b>{c.archived_at && <span className="pill ml-2">superseded</span>}{c.reference && <div className="mini">ref. {c.reference}</div>}{c.file_path && <div className="mini">{c.file_path.startsWith("wm:") ? "file in Web Manuals (to migrate)" : <a className="underline" href={`/api/files/${c.file_path}`} target="_blank" rel="noreferrer">Open file</a>}</div>}</td>
                  <td className="mini">{c.issuer}</td>
                  <td className="mono">{c.valid_until ? frd(c.valid_until) : "no expiry"}{d !== null && <div><span className={"pill " + (d < 0 ? "red" : d <= 30 ? "red" : d <= 90 ? "amber" : "green")}>{d < 0 ? `expired ${-d} d ago` : `${d} d left`}</span></div>}</td>
                  {canDrop && <td style={{ width: 300 }}>
                    <form action={moveCertificate} className="flex gap-1">
                      <input type="hidden" name="id" value={c.id} />
                      <select name="folder" defaultValue={c.folder ?? ""} className="inp" style={{ padding: "4px 6px", fontSize: 12 }}>{(foldersOf.get(c.entity) ?? []).map((f) => <option key={f} value={f}>{f}</option>)}</select>
                      <input name="folder_new" className="inp" placeholder="or new" style={{ padding: "4px 6px", fontSize: 12, width: 90 }} />
                      <button className="btn" type="submit" style={{ padding: "4px 8px", fontSize: 12 }}>Move</button>
                    </form></td>}
                </tr>); })}
            </tbody></table>
  );
  return (
    <>
      <PageHeader eyebrow="Documents, Certificates & Validities" title="Certificates & Validities" sub={`Organisation approvals and aircraft documents, with their validity. Alerts at 90 / 30 / 7 days (DOC-10).${qe ? `, ${qe}` : ""}${qf ? ` › ${qf}` : ""}`}
        right={<>{superseded > 0 && <Link className="btn" href={all ? "/docs/files" : "/docs/files?all=1"}>{all ? "Hide superseded" : `Show superseded (${superseded})`}</Link>}{canDrop && <Link className="btn primary" href="/docs/drop">+ Drop a document</Link>}</>} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Certificates" value={rows.length} />
        <Metric label="Expiring ≤ 90 days" value={soon.length - expired.length} tone={soon.length - expired.length ? "amber" : undefined} />
        <Metric label="Expired" value={expired.length} tone={expired.length ? "red" : undefined} />
      </div>
      {groups.map((g) => (
        // one folded panel per family, closed by default; sub-panels by category (approvals) or by type then registration (aircraft).
        // What needs attention shows on the closed panels.
        <details key={g.key} className="card dept mb-3" open={!!qf || groups.length === 1}>
          <summary><span className={"ent " + g.key.split("|")[0]}>{g.key.split("|")[0]}</span><span className="dname">{g.label.replace(/ › /g, " / ")}</span><Badges list={all_(g)} /></summary>
          {g.items.length > 0 && <CertTable list={g.items} />}
          {g.kids.map((k) => (
            <details key={k.key} className="certsub" open={!!qf}>
              <summary><span className="cname">{k.label}</span><Badges list={all_(k)} /></summary>
              {k.items.length > 0 && <CertTable list={k.items} />}
              {k.kids.map((r) => (
                <details key={r.key} className="certsub l2" open={!!qf}>
                  <summary><span className="cname mono">{r.label}</span><Badges list={r.items} /></summary>
                  <CertTable list={r.items} />
                </details>))}
            </details>))}
        </details>))}
      {!rows.length && <section className="card"><div className="cb text-slate6">No certificate in this scope yet.</div></section>}
    </>
  );
}
