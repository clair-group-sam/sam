import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { POSTS, peopleFor, resolveReaders } from "@/lib/audience";

/* References · Audiences: who receives what. The same tokens drive the readers of a manual, the recipients of a communication and
 * the Inbox tasks: ALL (the staff of the entity), ROLE:<post> (holders and deputies), PERSON:<id>. This page shows what each token
 * resolves to today, from People — so the desk knows, before publishing, who will be asked to read. */
export default async function Audiences() {
  const s = await getSession(); if (!s) redirect("/login");
  if (s.role === "user") redirect("/home/mine");
  const ents = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const all = await Promise.all(ents.map(async (e) => { const people = await peopleFor(db, e); return { e, people, all: resolveReaders(people, e, ["ALL"]), byPost: POSTS.map((p) => ({ post: p, readers: resolveReaders(people, e, [`ROLE:${p}`]) })) }; }));
  return (
    <>
      <PageHeader eyebrow="References, Audiences" title="Audiences" sub="What « all staff », a post or a named person resolves to, today, from People. Manuals, communications and safety bulletins use the same audiences." right={<Link className="btn" href="/users/book">Open People</Link>} />
      <section className="card mb-4"><div className="cb mini">
        <p><b>ALL</b>: everyone whose home entity is this one, or who is attached to it — group functions (finance, HR, IT…) are not included unless named by post or by name. <b>Post</b> (ROLE): the holders of the post and their deputies, read from the roles of People. <b>Person</b>: one named person, whatever their entity. A manual with no audience recorded is read by ALL.</p>
      </div></section>
      {all.map(({ e, all: everyone, byPost }) => (
        <section key={e} className="card mb-4">
          <div className="ch"><b>{ENT[e]?.name ?? e}</b><span className="mini">ALL = {everyone.length} people</span></div>
          <div className="cb" style={{ padding: 0 }}>
            <table className="tbl"><thead><tr><th>Audience</th><th>Resolves to</th><th>People</th></tr></thead><tbody>
              <tr><td><b>ALL</b><div className="mini">all staff of {ENT[e]?.name ?? e}</div></td><td className="mini">{everyone.length} people</td><td className="mini">{everyone.slice(0, 12).map((p) => p.display_name).join(", ")}{everyone.length > 12 ? `, +${everyone.length - 12}` : ""}</td></tr>
              {byPost.map(({ post, readers }) => <tr key={post}><td><b>{post}</b></td><td className="mini">{readers.length ? `${readers.length} (holders and deputies)` : <span className="late">nobody holds this post here</span>}</td><td className="mini">{readers.map((p) => p.display_name).join(", ")}</td></tr>)}
            </tbody></table>
          </div>
        </section>))}
    </>
  );
}
