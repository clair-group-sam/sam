import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isAdmin, savePerson, saveRights } from "../../set/actions";
import { ENTS4 } from "@/lib/nav";

type P = { id: string; display_name: string; email: string | null; job_title: string | null; home_entity: string | null; entities: string[] | null; roles: string[] | null; is_group_function: boolean; last_seen_at: string | null; can_create_manuals: boolean; sam_roles: string[] | null; sam_entities: string[] | null; sam_group: boolean | null; entra_roles: string[] | null; entra_entities: string[] | null; entra_group: boolean | null };
const fr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "never");

/* Users & fleet · People: the directory of S.A.M. users in the working entity. Roles and scope come from the Entra groups at each sign-in. */
export default async function People({ searchParams }: { searchParams: Promise<{ q?: string; p?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams; const db = supabaseAdmin();
  const { data } = await db.from("people").select("*").order("display_name");
  let all = (data ?? []) as P[];
  if (s.entity !== "ALL") all = all.filter((p) => p.is_group_function || p.home_entity === s.entity || (p.entities ?? []).includes(s.entity));
  else if (!s.group) all = all.filter((p) => p.is_group_function || s.entities.includes(p.home_entity ?? "") || (p.entities ?? []).some((e) => s.entities.includes(e))); // "ALL" of someone in several entities: the people of those entities
  else if (!s.group) all = all.filter((p) => p.is_group_function || (p.entities ?? []).some((e) => s.entities.includes(e)));
  const q = (sp.q ?? "").toLowerCase().trim();
  const list = q ? all.filter((p) => [p.display_name, p.email, p.job_title, ...(p.roles ?? [])].join(" ").toLowerCase().includes(q)) : all;
  const admin = await isAdmin(s);
  const open = sp.p ? all.find((p) => p.id === sp.p) ?? null : null;
  const t30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const posts = (p: P) => (p.roles ?? []).filter((r) => !["USER", "SUPERADMIN"].includes(basePost(r)));
  return (
    <>
      <PageHeader eyebrow="Users & fleet, People" title="People" sub="Everyone who uses S.A.M. in the working entity. Microsoft Entra says who each person is and gives their entities; the posts and roles are given here in S.A.M. (and by NP management, Changes & approvals) and are not changed at sign-in." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="People" value={all.length} />
        <Metric label="With a post" value={all.filter((p) => posts(p).length).length} hint="AM, CMM, SM, NP and deputies" />
        <Metric label="Active in 30 days" value={all.filter((p) => p.last_seen_at && p.last_seen_at > t30).length} />
      </div>
      {open && <section className="card mb-4" id="person"><div className="ch"><span><b>{open.display_name}</b> <span className="mini">{open.email}</span></span><Link className="mini" href="/users/book">Close</Link></div>
        <div className="cb grid gap-3">
          <p className="mini">Home entity {open.home_entity ? ENT[open.home_entity]?.name ?? open.home_entity : "none"}{open.is_group_function ? ", group function (all entities)" : `, scope ${(open.entities ?? []).join(", ") || "none"}`}. Posts: {(open.roles ?? []).join(", ") || "none"}. Last seen {fr(open.last_seen_at)}.</p>
          {admin && <form action={savePerson} className="grid grid-cols-3 gap-3 items-end"><input type="hidden" name="id" value={open.id} />
            <label className="block col-span-2"><span className="eyebrow">Job title</span><input name="job_title" className="inp" defaultValue={open.job_title ?? ""} /></label>
            <label className="flex gap-2 items-center"><input type="checkbox" name="can_create_manuals" defaultChecked={open.can_create_manuals} /> May create manuals</label>
            <div className="col-span-3 flex justify-end"><button className="btn primary" type="submit">Save</button></div></form>}
          {admin && (() => { const sugg = (open.entra_roles ?? []).filter((r) => !(open.sam_roles ?? []).includes(r) && r !== "USER"); return (
            <form action={saveRights} className="grid gap-3" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}><input type="hidden" name="id" value={open.id} />
              <div className="eyebrow">Rights given in S.A.M.</div>
              <p className="mini">From Microsoft Entra: entities {(open.entra_entities ?? []).join(", ") || "none"}{open.entra_group ? ", group function" : ""}.{sugg.length ? ` The groups of this person suggest: ${sugg.join(", ")} (not given until written below).` : ""}</p>
              <label className="block"><span className="mini">Posts and roles, separated by commas (CMM, SM, AM, NPFO, NPFO_DEP, USER…)</span><input name="roles" className="inp mono" defaultValue={(open.sam_roles ?? []).join(", ")} /></label>
              <div className="flex flex-wrap gap-4 items-center"><span className="mini">Entities added by S.A.M.:</span>{ENTS4.map((e) => <label key={e} className="flex gap-1 items-center"><input type="checkbox" name="entities" value={e} defaultChecked={(open.sam_entities ?? []).includes(e)} /> {e}</label>)}
                <label className="flex gap-1 items-center"><input type="checkbox" name="sam_group" defaultChecked={!!open.sam_group} /> group function (all entities)</label></div>
              <div className="flex justify-between items-center"><span className="mini">A post of a nominated person is better changed in NP management, Changes &amp; approvals: the rights follow.</span><button className="btn primary" type="submit">Save the rights</button></div>
            </form>); })()}
        </div></section>}
      <form className="findbar mb-3" action="/users/book"><input name="q" defaultValue={sp.q ?? ""} placeholder="Search by name, e-mail, post" aria-label="Search people" /></form>
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!list.length ? <p className="p-4 mini">Nobody matches.</p> : (
        <table className="tbl"><thead><tr><th>Name</th><th>Job title</th><th>Posts</th><th className="entcol">Home</th><th>Last seen</th></tr></thead><tbody>
          {list.map((p) => <tr key={p.id} className={open?.id === p.id ? "on" : ""}><td><Link href={`/users/book?p=${p.id}#person`}><b>{p.display_name}</b></Link><div className="mini">{p.email}</div></td>
            <td className="mini">{p.job_title ?? ""}</td><td className="mono mini">{posts(p).join(", ")}{p.is_group_function ? <span className="pill" style={{ marginLeft: 6 }}>group</span> : null}</td>
            <td className="entcol">{p.home_entity ? <span className={"ent " + p.home_entity}>{p.home_entity}</span> : ""}</td><td className="due">{fr(p.last_seen_at)}</td></tr>)}
        </tbody></table>)}</div></section>
    </>
  );
}
