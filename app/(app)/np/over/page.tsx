import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { postsOf, snapshotOf } from "@/lib/np";
import { chartKey, chartsIn, orgChartSvg } from "@/lib/orgchart";
import { savePost, deletePost } from "./actions";

const STATUS: Record<string, [string, string]> = { accepted: ["green", "accepted by the authority"], pending: ["amber", "acceptance pending"], not_required: ["", "no acceptance required"] };

/** NP management › Overview: posts of the entity and the organisation chart drawn from them; manuals whose chart is out of date. */
export default async function NpOverview({ searchParams }: { searchParams: Promise<{ entity?: string; ent?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams; const q = sp.entity ?? sp.ent;
  const ents = s.group ? ENTS4 : s.entities;
  const db = supabaseAdmin();
  // FB-019 · one entity selector: the top bar. With "All entities", land on the first entity that has posts (not an empty one).
  let entity = q && ents.includes(q) ? q : s.entity !== "ALL" && ents.includes(s.entity) ? s.entity : "";
  if (!entity) {
    const { data: withPosts } = await db.from("np_posts").select("entity").in("entity", ents);
    const has = new Set(((withPosts ?? []) as { entity: string }[]).map((x) => x.entity));
    entity = ents.find((e) => has.has(e)) ?? ents[0];
  }
  const posts = entity ? await postsOf(db, entity) : [];
  const snap = snapshotOf(entity ?? "", posts);
  const cmm = isCmm(s);

  // manuals of the entity that carry this chart: published revision and drafts, up to date or not
  type Use = { manualId: string; code: string; title: string; revId: string; rev: string; step: string; ref: string; upToDate: boolean };
  const uses: Use[] = [];
  if (entity) {
    const { data: secs } = await db.from("revision_sections").select("ref,deleted_at,html:body->>html,revisions!inner(id,rev,step,manual_id,manuals!inner(id,code,title,entity))").ilike("body->>html", `%data-sam-orgchart="${entity}"%`).is("deleted_at", null);
    type S = { ref: string; html: string | null; revisions: { id: string; rev: string; step: string; manual_id: string; manuals: { id: string; code: string; title: string; entity: string } } };
    const key = chartKey(snap);
    for (const x of (secs ?? []) as unknown as S[]) {
      const charts = chartsIn(x.html ?? "").filter((c) => c.entity === entity);
      if (!charts.length) continue;
      uses.push({ manualId: x.revisions.manuals.id, code: x.revisions.manuals.code, title: x.revisions.manuals.title, revId: x.revisions.id, rev: x.revisions.rev, step: x.revisions.step, ref: x.ref, upToDate: charts.every((c) => chartKey(c) === key) });
    }
    uses.sort((a, b) => a.code.localeCompare(b.code) || b.rev.localeCompare(a.rev));
  }
  const published = (st: string) => st === "published" || st === "repository";

  return (
    <>
      <PageHeader eyebrow="NP management · Overview" title={`Nominated persons — ${ENT[entity ?? ""]?.name ?? entity}`} sub="Posts, holders and deputies. The organisation charts of the manuals are drawn from this list." />
      {ents.length > 1 && s.entity === "ALL" && <div className="chips mb-4 flex items-center gap-2">{ents.map((e) => <Link key={e} href={`/np/over?entity=${e}`} className={"ent " + e + (e === entity ? " on" : "")}>{e}</Link>)}<span className="mini">— or pick the entity in the top bar</span></div>}

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Organisation chart</span><span className="mini">as it is today in NP management</span></div>
        <div className="cb"><figure className="orgchart">{posts.length ? <span dangerouslySetInnerHTML={{ __html: orgChartSvg(snap) }} /> : <span className="mini">No post defined yet for this entity.</span>}</figure></div>
      </section>

      {uses.length > 0 && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Manuals carrying this chart</span><span className="mini">a published manual keeps the chart approved with its revision</span></div>
          <table className="tbl"><tbody>{uses.map((u, i) => (
            <tr key={i}>
              <td className="mono" style={{ width: 160 }}>{u.code} · {u.ref}</td>
              <td>{u.title}<div className="mini">Rev {u.rev} · {published(u.step) ? "published" : "in progress"}</div></td>
              <td style={{ width: 170 }}><span className={"pill " + (u.upToDate ? "green" : "amber")}>{u.upToDate ? "up to date" : "out of date"}</span></td>
              <td style={{ width: 230 }} className="text-right">
                {!u.upToDate && !published(u.step) && <Link className="btn" href={`/docs/editor/${u.revId}?tab=write&sec=${encodeURIComponent(u.ref)}`}>Update in Rev {u.rev}</Link>}
                {!u.upToDate && published(u.step) && !uses.some((o) => o.manualId === u.manualId && !published(o.step)) && <Link className="btn" href={`/docs/manual/${u.manualId}?sec=${encodeURIComponent(u.ref)}`}>Start a revision</Link>}
                {u.upToDate && <Link className="mini underline" href={`/docs/manual/${u.manualId}?rev=${u.revId}&sec=${encodeURIComponent(u.ref)}`}>Open</Link>}
              </td>
            </tr>))}</tbody></table>
        </section>
      )}

      <section className="card">
        <div className="ch"><span className="eyebrow">Posts</span><span className="mini">{posts.length}</span></div>
        <table className="tbl nptbl">
          <thead><tr><th>Post</th><th>Title in the manuals</th><th>Reports to</th><th>Holder</th><th>Deputy</th><th>Authority</th><th>Since</th>{cmm && <th />}</tr></thead>
          <tbody>
            {posts.map((p) => cmm ? (
              <tr key={p.id}>
                <td colSpan={8} className="p-0">
                  <form action={savePost} className="nprow">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="entity" value={entity} />
                    <input name="code" defaultValue={p.code} className="inp mono" style={{ width: 70 }} />
                    <input name="title" defaultValue={p.title} className="inp" />
                    <select name="parent_code" defaultValue={p.parent_code ?? ""} className="inp" style={{ width: 90 }}><option value="">—</option>{posts.filter((o) => o.code !== p.code).map((o) => <option key={o.code} value={o.code}>{o.code}</option>)}</select>
                    <input name="holder_name" defaultValue={p.holder_name ?? ""} className="inp" placeholder="vacant" />
                    <input name="deputy_name" defaultValue={p.deputy_name ?? ""} className="inp" placeholder="no deputy" />
                    <select name="status" defaultValue={p.status} className="inp" style={{ width: 130 }}><option value="accepted">accepted</option><option value="pending">pending</option><option value="not_required">not required</option></select>
                    <input name="since" type="date" defaultValue={p.since ?? ""} className="inp" style={{ width: 140 }} />
                    <input type="hidden" name="ord" value={p.ord} /><input type="hidden" name="regulatory" value={p.regulatory ?? ""} />
                    <button className="btn" type="submit">Save</button>
                    <button className="btn" formAction={deletePost} type="submit" title="Delete this post">✕</button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={p.id}><td className="mono">{p.code}</td><td>{p.title}</td><td className="mono">{p.parent_code ?? "—"}</td><td><b>{p.holder_name ?? "vacant"}</b></td><td>{p.deputy_name ?? <span className="mini">—</span>}</td>
                <td><span className={"pill " + (STATUS[p.status]?.[0] ?? "")}>{STATUS[p.status]?.[1] ?? p.status}</span></td><td className="mono">{p.since ?? ""}</td></tr>
            ))}
            {!posts.length && <tr><td colSpan={8} className="p-5 text-slate6">No post yet.</td></tr>}
          </tbody>
        </table>
        {cmm && entity && (
          <form action={savePost} className="nprow add">
            <input type="hidden" name="entity" value={entity} /><input type="hidden" name="ord" value={posts.length + 1} />
            <input name="code" className="inp mono" style={{ width: 70 }} placeholder="Code" required />
            <input name="title" className="inp" placeholder="Title as written in the manuals" required />
            <select name="parent_code" className="inp" style={{ width: 90 }} defaultValue=""><option value="">reports to</option>{posts.map((o) => <option key={o.code} value={o.code}>{o.code}</option>)}</select>
            <input name="holder_name" className="inp" placeholder="Holder (First LAST)" />
            <input name="deputy_name" className="inp" placeholder="Deputy" />
            <select name="status" className="inp" style={{ width: 130 }} defaultValue="pending"><option value="accepted">accepted</option><option value="pending">pending</option><option value="not_required">not required</option></select>
            <input name="since" type="date" className="inp" style={{ width: 140 }} />
            <button className="btn primary" type="submit">+ Add post</button>
          </form>
        )}
      </section>
    </>
  );
}
