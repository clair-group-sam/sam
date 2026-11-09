import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { fr, hm, registersSession, scopeOf } from "../guard";

type L = { id: number; at: string; actor: string | null; entity: string | null; object_type: string; object_id: string; action: string; after: unknown; prev_hash: string | null; hash: string | null };

/* Registers · Audit log: the append-only, hash-chained journal of every change S.A.M. records. Filter by object or action. */
export default async function AuditLog({ searchParams }: { searchParams: Promise<{ o?: string; a?: string; p?: string }> }) {
  const s = await registersSession(); const sp = await searchParams;
  const db = supabaseAdmin(); const scope = scopeOf(s);
  const page = Math.max(0, Number(sp.p ?? 0) || 0);
  let q = db.from("audit_log").select("*").order("id", { ascending: false }).range(page * 200, page * 200 + 199);
  if (scope) q = q.or(`entity.in.(${scope.join(",")}),entity.is.null`);
  if (sp.o) q = q.eq("object_type", sp.o);
  if (sp.a) q = q.ilike("action", `%${sp.a}%`);
  const [{ data }, { data: ppl }] = await Promise.all([q, db.from("people").select("id,display_name")]);
  const rows = (data ?? []) as L[];
  const P = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  // chain check on the page shown: each entry carries the hash of the one before it
  let broken = 0; for (let i = 0; i < rows.length - 1; i++) if (rows[i].prev_hash && rows[i + 1].hash && rows[i].prev_hash !== rows[i + 1].hash) broken++;
  const types = [...new Set(rows.map((r) => r.object_type))].sort();
  const qs = (x: Record<string, string | number | undefined>) => "?" + Object.entries({ o: sp.o, a: sp.a, ...x }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return (
    <>
      <PageHeader eyebrow="Registers, Audit log" title="Audit log" sub="Every change S.A.M. records, newest first. Entries cannot be edited; each one carries the hash of the previous one, so a gap or an edit shows." />
      <div className="flex flex-wrap gap-3 items-center mb-3">
        <form className="findbar" action="/admin/log" style={{ flex: "1 1 280px" }}>{sp.o && <input type="hidden" name="o" value={sp.o} />}<input name="a" defaultValue={sp.a ?? ""} placeholder="Filter by action (published, created, step_…)" aria-label="Filter by action" /></form>
        <span className={"pill " + (broken ? "red" : "green")}>{broken ? `${broken} break(s) in the chain on this page` : "Chain intact on this page"}</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-3"><Link className={"pill" + (!sp.o ? " green" : "")} href={`/admin/log${qs({ o: undefined, p: undefined })}`}>All objects</Link>{types.map((t) => <Link key={t} className={"pill" + (sp.o === t ? " green" : "")} href={`/admin/log${qs({ o: t, p: undefined })}`}>{t.replace(/_/g, " ")}</Link>)}</div>
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!rows.length ? <p className="p-4 mini">No entry.</p> : (
        <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>When</th><th className="entcol">Entity</th><th>Who</th><th>Object</th><th>Action</th><th>Detail</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td className="due">{fr(r.at)} <span className="mini">{hm(r.at)}</span></td><td className="entcol">{r.entity ? <span className={"ent " + r.entity}>{r.entity}</span> : <span className="mini">group</span>}</td>
            <td>{P.get(r.actor ?? "") ?? <span className="mini">S.A.M.</span>}</td><td className="mini">{r.object_type.replace(/_/g, " ")}</td><td><b>{r.action.replace(/_/g, " ")}</b></td>
            <td className="mini mono" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.after ? JSON.stringify(r.after) : ""}>{r.after ? JSON.stringify(r.after).slice(0, 140) : ""}</td></tr>)}
        </tbody></table></div>)}</div></section>
      <div className="flex gap-2 justify-end mt-3">{page > 0 && <Link className="btn" href={`/admin/log${qs({ p: page - 1 })}`}>Newer</Link>}{rows.length === 200 && <Link className="btn" href={`/admin/log${qs({ p: page + 1 })}`}>Older</Link>}</div>
    </>
  );
}
