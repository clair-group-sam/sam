import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { STEP_LABEL } from "@/lib/docs";
import { fr, hm, registersSession, scopeOf } from "../guard";

type L = { id: number; at: string; actor: string | null; entity: string; object_id: string; action: string; after: { code?: string; rev?: string; from?: string; note?: string } | null; hash: string | null };
const ACTS = ["step_approved_np", "step_approved_compliance", "step_signed", "step_with_civil_aviation", "step_published", "step_repository"];

/* Registers · Signature register: every approval and signature act on a manual revision, from the chained audit log (append-only). */
export default async function SignatureRegister({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await registersSession(); const sp = await searchParams;
  const db = supabaseAdmin(); const scope = scopeOf(s);
  let q = db.from("audit_log").select("id,at,actor,entity,object_id,action,after,hash").eq("object_type", "revision").in("action", ACTS).order("at", { ascending: false }).limit(1000);
  if (scope) q = q.in("entity", scope);
  const { data } = await q; let rows = (data ?? []) as L[];
  if (sp.m) rows = rows.filter((r) => (r.after?.code ?? "").toLowerCase().includes(sp.m!.toLowerCase()));
  const { data: ppl } = await db.from("people").select("id,display_name,job_title");
  const P = new Map(((ppl ?? []) as { id: string; display_name: string; job_title: string | null }[]).map((p) => [p.id, p]));
  const n = (a: string) => rows.filter((r) => r.action === a).length;
  return (
    <>
      <PageHeader eyebrow="Registers, Signature register" title="Signature register" sub="Every approval and signature on a manual revision: who, when, from which step. Read from the audit log, whose entries are chained by hash and cannot be changed." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="NP approvals" value={n("step_approved_np")} />
        <Metric label="Compliance approvals" value={n("step_approved_compliance")} />
        <Metric label="Signatures" value={n("step_signed")} />
        <Metric label="Publications" value={n("step_published")} />
      </div>
      <form className="findbar mb-3" action="/admin/signreg"><input name="m" defaultValue={sp.m ?? ""} placeholder="Filter by manual code (OM-A, CAE…)" aria-label="Filter by manual code" /></form>
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!rows.length ? <p className="p-4 mini">No approval recorded in this scope yet.</p> : (
        <table className="tbl"><thead><tr><th>Date</th><th className="entcol">Entity</th><th>Manual</th><th>Act</th><th>By</th><th>Seal</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td className="due">{fr(r.at)} <span className="mini">{hm(r.at)}</span></td><td className="entcol"><span className={"ent " + r.entity}>{r.entity}</span></td>
            <td><Link href={`/docs/editor/${r.object_id}`}><b className="mono">{r.after?.code ?? "?"}</b> Rev {r.after?.rev ?? "?"}</Link>{r.after?.note ? <div className="mini">{r.after.note}</div> : null}</td>
            <td>{STEP_LABEL[r.action.replace("step_", "")] ?? r.action}<div className="mini">from {STEP_LABEL[r.after?.from ?? ""] ?? r.after?.from ?? "?"}</div></td>
            <td><b>{P.get(r.actor ?? "")?.display_name ?? "S.A.M."}</b><div className="mini">{P.get(r.actor ?? "")?.job_title ?? ""}</div></td>
            <td className="mono mini" title={r.hash ?? ""}>{r.hash ? r.hash.slice(0, 10) : ""}</td></tr>)}
        </tbody></table>)}</div></section>
    </>
  );
}
