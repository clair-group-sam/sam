import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { postsOf } from "@/lib/np";

/* References · NP regulatory basis: every post of the working entity with the rule that requires it, who holds it and since when.
 * Read from NP management (np_posts.regulatory) — one truth; the org chart stays the place where it is edited. */
export default async function NpBasis() {
  const s = await getSession(); if (!s) redirect("/login");
  const ents = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const all = await Promise.all(ents.map(async (e) => ({ e, posts: await postsOf(db, e) })));
  return (
    <>
      <PageHeader eyebrow="References, NP regulatory basis" title="NP regulatory basis" sub="The posts the regulation requires (accountable manager, nominated persons, safety and compliance managers, ISM), the rule behind each, and who holds it today. Edited in NP management." right={<Link className="btn" href="/np/over">Open NP management</Link>} />
      {all.map(({ e, posts }) => (
        <section key={e} className="card mb-4">
          <div className="ch"><b>{ENT[e]?.name ?? e}</b><span className="mini">{ENT[e]?.qual}, {ENT[e]?.auth} · {posts.length} post{posts.length === 1 ? "" : "s"}</span></div>
          <div className="cb" style={{ padding: 0 }}>
            {posts.length ? <table className="tbl"><thead><tr><th>Post</th><th>Regulatory basis</th><th>Holder</th><th>Deputy</th><th>Since</th><th>Status</th></tr></thead><tbody>
              {posts.map((p) => <tr key={p.id}><td><b>{p.code}</b><div className="mini">{p.title}</div></td><td className="mini" style={{ maxWidth: 360 }}>{p.regulatory || <span className="late">not recorded</span>}</td><td>{p.holder_name || <span className="mini">no holder recorded</span>}</td><td className="mini">{p.deputy_name || ""}</td><td className="mini">{p.since ?? ""}</td><td><span className={"pill " + (p.status === "approved" || p.status === "active" ? "green" : p.status === "pending" ? "amber" : "")}>{p.status}</span></td></tr>)}
            </tbody></table> : <p className="p-4 mini">No post recorded yet for this entity: NP management › Posts & org chart creates them (« Create these posts from the Crisis directory »).</p>}
          </div>
        </section>))}
    </>
  );
}
