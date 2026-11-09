import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isAdmin, removeGroup, saveGroup } from "../actions";

type G = { group_id: string; name: string | null; entity: string | null; role: string | null; is_group_function: boolean; first_seen_at: string; last_seen_at: string | null; mapped_at: string | null };
const fr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

/* Settings · Entra groups sync (IAM-01): each Microsoft 365 group seen at sign-in is mapped to an entity and a post; the person's scope is recomputed at the next sign-in. */
export default async function EntraGroups() {
  const s = await getSession(); if (!s) redirect("/login");
  const admin = await isAdmin(s);
  const { data } = await supabaseAdmin().from("entra_groups").select("*").order("mapped_at", { ascending: true, nullsFirst: true }).order("name");
  const rows = (data ?? []) as G[];
  const pending = rows.filter((g) => !g.mapped_at);
  const Form = ({ g }: { g?: G }) => (
    <form action={saveGroup} className="grid gap-2" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 120px 90px auto auto", alignItems: "center" }}>
      {g ? <input type="hidden" name="group_id" value={g.group_id} /> : null}
      {g ? <input name="name" className="inp" defaultValue={g.name ?? ""} placeholder="Group name as in Entra" aria-label="Group name" /> : <input name="group_id" className="inp mono" placeholder="Group GUID" aria-label="Group GUID" required />}
      {!g && <input name="name" className="inp" placeholder="Group name" aria-label="Group name" />}
      <select name="entity" className="inp" defaultValue={g?.entity ?? ""} aria-label="Entity"><option value="">No entity</option>{ENTS4.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select>
      <input name="role" className="inp mono" defaultValue={g?.role ?? ""} placeholder="CMM, NPFO, USER" aria-label="Post" />
      <label className="flex gap-1 items-center mini"><input type="checkbox" name="is_group_function" defaultChecked={g?.is_group_function} /> group</label>
      <button className="btn primary" type="submit">{g?.mapped_at ? "Save" : "Map"}</button>
    </form>
  );
  return (
    <>
      <PageHeader eyebrow="Settings, Entra groups sync" title="Entra groups sync" sub="Microsoft 365 groups seen in the sign-in token. Map each one to an entity and a post: people get their scope and posts at their next sign-in. Group names are typed here (S.A.M. does not read the directory)." />
      {pending.length > 0 && <section className="card mb-4 sentback"><div className="ch"><span className="eyebrow">To map</span><span className="mini">{pending.length} group(s) seen, not mapped yet</span></div>
        <div className="cb grid gap-3">{pending.map((g) => <div key={g.group_id}><div className="mono mini mb-1">{g.group_id}, first seen {fr(g.first_seen_at)}</div>{admin ? <Form g={g} /> : null}</div>)}</div></section>}
      <section className="card mb-4"><div className="ch"><span className="eyebrow">Mapped groups</span></div><div className="cb" style={{ padding: 0 }}>{!rows.filter((g) => g.mapped_at).length ? <p className="p-4 mini">No group mapped yet.</p> : (
        <table className="tbl"><thead><tr><th>Group</th><th>Entity</th><th>Post</th><th>Last seen</th><th></th></tr></thead><tbody>
          {rows.filter((g) => g.mapped_at).map((g) => <tr key={g.group_id}><td><b>{g.name ?? "(no name)"}</b><div className="mono mini">{g.group_id}</div></td><td>{g.is_group_function ? "Group function" : g.entity ? ENT[g.entity]?.name ?? g.entity : ""}</td><td className="mono">{g.role ?? ""}</td><td className="due">{fr(g.last_seen_at)}</td>
            <td style={{ textAlign: "right" }}>{admin && <form action={removeGroup}><input type="hidden" name="group_id" value={g.group_id} /><button className="btn sm" type="submit">Unmap</button></form>}</td></tr>)}
        </tbody></table>)}</div></section>
      {admin && <section className="card"><div className="ch"><span className="eyebrow">Add a group by its id</span><span className="mini">before anyone of that group has signed in</span></div><div className="cb"><Form /></div></section>}
    </>
  );
}
