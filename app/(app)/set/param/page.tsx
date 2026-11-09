import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { isAdmin, saveParam } from "../actions";

/* Settings · Parameters: the few numbers S.A.M. uses by default (delays, alerts, budget). Each change is logged. */
export default async function Parameters() {
  const s = await getSession(); if (!s) redirect("/login");
  const admin = await isAdmin(s);
  const db = supabaseAdmin();
  const [{ data }, { data: ppl }] = await Promise.all([db.from("app_params").select("*").order("key"), db.from("people").select("id,display_name")]);
  const rows = (data ?? []) as { key: string; value: string; label: string; hint: string | null; updated_by: string | null; updated_at: string }[];
  const P = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return (
    <>
      <PageHeader eyebrow="Settings, Parameters" title="Parameters" sub="Default delays, alert thresholds and the AI budget. Changes apply to what is created from now on." />
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!rows.length ? <p className="p-4 mini">The parameters table is empty: apply the migration of 09/11.</p> : (
        <table className="tbl"><thead><tr><th>Parameter</th><th>Value</th><th>Last change</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.key}><td><b>{r.label}</b><div className="mini">{r.hint}</div></td>
            <td style={{ width: 260 }}>{admin ? <form action={saveParam} className="flex gap-2"><input type="hidden" name="key" value={r.key} /><input name="value" className="inp mono" defaultValue={r.value} aria-label={r.label} /><button className="btn" type="submit">Save</button></form> : <span className="mono">{r.value}</span>}</td>
            <td className="mini">{r.updated_at.slice(0, 10).split("-").reverse().join("/")}{r.updated_by ? `, ${P.get(r.updated_by) ?? ""}` : ""}</td></tr>)}
        </tbody></table>)}</div></section>
    </>
  );
}
