import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isAdmin, restorePerson, reviewRights, savePerson, saveRights, suspendPerson } from "../../set/actions";
import { ENTS4 } from "@/lib/nav";

type P = { id: string; display_name: string; email: string | null; job_title: string | null; home_entity: string | null; entities: string[] | null; roles: string[] | null; is_group_function: boolean; last_seen_at: string | null; can_create_manuals: boolean; sam_roles: string[] | null; sam_entities: string[] | null; sam_group: boolean | null; entra_roles: string[] | null; entra_entities: string[] | null; entra_group: boolean | null; suspended_at: string | null; suspended_note: string | null; entra_changed_at: string | null; entra_change: string | null; rights_reviewed_at: string | null };
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
  // RIGHTS-03 · rights to check: S.A.M. does not read the directory, so it shows who holds rights and no longer signs in (60 days),
  // and whose Microsoft groups changed at their last sign-in. It never removes a right by itself.
  const t60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const hasRights = (p: P) => (p.sam_roles ?? p.roles ?? []).some((r) => basePost(r) !== "USER");
  const check = !admin ? [] : all.filter((p) => !p.suspended_at && hasRights(p)).map((p) => {
    const why: string[] = [];
    if (p.entra_changed_at && (!p.rights_reviewed_at || p.rights_reviewed_at < p.entra_changed_at)) why.push(`${p.entra_change ?? "Microsoft groups changed"} Seen on ${fr(p.entra_changed_at)}.`);
    if (p.last_seen_at && p.last_seen_at < t60 && (!p.rights_reviewed_at || p.rights_reviewed_at < t60)) why.push(`Has not signed in since ${fr(p.last_seen_at)}.`);
    return { p, why }; }).filter((x) => x.why.length);
  const posts = (p: P) => (p.roles ?? []).filter((r) => !["USER", "SUPERADMIN"].includes(basePost(r)));
  return (
    <>
      <PageHeader eyebrow="Users & fleet, People" title="People" sub="Everyone who uses S.A.M. in the working entity. Microsoft Entra says who each person is and gives their entities; the posts and roles are given here in S.A.M. (and by NP management, Changes & approvals) and are not changed at sign-in." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="People" value={all.length} />
        <Metric label="With a post" value={all.filter((p) => posts(p).length).length} hint="AM, CMM, SM, NP and deputies" />
        <Metric label="Active in 30 days" value={all.filter((p) => p.last_seen_at && p.last_seen_at > t30).length} />
      </div>
      {check.length > 0 && <section className="card mb-4" style={{ borderLeft: "4px solid var(--amber, #d98a00)" }}>
        <div className="ch"><span className="eyebrow">Rights to check</span><span className="mini">{check.length} {check.length === 1 ? "person holds" : "people hold"} posts or roles in S.A.M.: still justified?</span></div>
        <table className="tbl"><tbody>{check.map(({ p, why }) => <tr key={p.id}>
          <td style={{ width: 240 }}><Link className="underline" href={`/users/book?p=${p.id}#person`}><b>{p.display_name}</b></Link><div className="mono mini">{(p.sam_roles ?? []).filter((r) => r !== "USER").join(", ")}</div></td>
          <td className="mini">{why.map((w, i) => <div key={i}>{w}</div>)}</td>
          <td style={{ width: 300 }}><div className="flex gap-2 justify-end">
            <form action={reviewRights}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="why" value={why.join(" ")} /><button className="btn" type="submit">It is normal</button></form>
            <form action={suspendPerson}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="note" value={why.join(" ")} /><button className="btn" type="submit">Suspend access</button></form></div></td></tr>)}</tbody></table>
        <div className="cb mini">S.A.M. cannot ask Microsoft whether an account still exists: this list is a reminder, nothing is removed by itself. To change the posts or roles of a person, open their card.</div></section>}
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
          {admin && (open.suspended_at
            ? <form action={restorePerson} className="flex flex-wrap gap-3 items-center" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}><input type="hidden" name="id" value={open.id} /><span className="pill red">access suspended since {fr(open.suspended_at)}</span>{open.suspended_note && <span className="mini">{open.suspended_note}</span>}<button className="btn" type="submit">Restore access</button></form>
            : !(open.roles ?? []).includes("SUPERADMIN") && open.id !== s.person?.id && <form action={suspendPerson} className="flex flex-wrap gap-3 items-end" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}><input type="hidden" name="id" value={open.id} />
              <label style={{ flex: 1, minWidth: 260 }}><span className="mini">Suspend the access to S.A.M. (departure, long absence): the reason, kept in the audit log</span><input name="note" className="inp" /></label><button className="btn" type="submit">Suspend access</button>
              <span className="mini" style={{ flexBasis: "100%" }}>Immediate, even on a session already open. The posts and roles are kept, so that restoring gives everything back; remove them above if the person has left.</span></form>)}
        </div></section>}
      <form className="findbar mb-3" action="/users/book"><input name="q" defaultValue={sp.q ?? ""} placeholder="Search by name, e-mail, post" aria-label="Search people" /></form>
      <section className="card"><div className="cb" style={{ padding: 0 }}>{!list.length ? <p className="p-4 mini">Nobody matches.</p> : (
        <table className="tbl"><thead><tr><th>Name</th><th>Job title</th><th>Posts</th><th className="entcol">Home</th><th>Last seen</th></tr></thead><tbody>
          {list.map((p) => <tr key={p.id} className={open?.id === p.id ? "on" : ""}><td><Link href={`/users/book?p=${p.id}#person`}><b>{p.display_name}</b></Link>{p.suspended_at && <span className="pill red" style={{ marginLeft: 6 }}>suspended</span>}<div className="mini">{p.email}</div></td>
            <td className="mini">{p.job_title ?? ""}</td><td className="mono mini">{posts(p).join(", ")}{p.is_group_function ? <span className="pill" style={{ marginLeft: 6 }}>group</span> : null}</td>
            <td className="entcol">{p.home_entity ? <span className={"ent " + p.home_entity}>{p.home_entity}</span> : ""}</td><td className="due">{fr(p.last_seen_at)}</td></tr>)}
        </tbody></table>)}</div></section>
    </>
  );
}
