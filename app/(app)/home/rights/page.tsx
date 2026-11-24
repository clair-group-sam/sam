import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost, isDeputy } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4, MODULES, ROLES, SUB } from "@/lib/nav";
import { ROLE_WORDS } from "@/lib/role-words";


/* My access rights, in words (opened from the menu under the name): who I am for S.A.M., in which organisations, the posts I hold,
 * what they let me open, and whom to ask for a change. The technical view (JSON) stays for the super admin. */
export default async function MyRights() {
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data: np } = await db.from("np_posts").select("entity,code,title,holder_person,holder_name,deputy_person,deputy_name");
  const posts = (np ?? []) as { entity: string; code: string; title: string | null; holder_person: string | null; holder_name: string | null; deputy_person: string | null; deputy_name: string | null }[];
  const ents = s.group ? ENTS4 : s.entities;
  // RIGHTS-04 · one line per post or role and per organisation where it is held
  const everywhere = ents.length ? ents.reduce<string[]>((acc, e, i) => (i === 0 ? [...(s.rolesByEntity[e] ?? [])] : acc.filter((r) => (s.rolesByEntity[e] ?? []).includes(r))), []) : s.roles;
  const label = (r: string) => { const code = basePost(r); const dep = isDeputy(r); const t = posts.find((p) => p.code.toUpperCase() === code && ents.includes(p.entity))?.title; return `${dep ? "Deputy, " : ""}${t && t.toUpperCase() !== code ? t : ROLE_WORDS[code] ?? code}`; };
  const rows = [
    ...everywhere.filter((r) => basePost(r) !== "USER" || ents.every((e) => (s.rolesByEntity[e] ?? []).length <= 1)).map((r) => ({ code: r, label: label(r), where: [s.group ? "every organisation" : ents.length > 1 ? "all your organisations" : ENT[ents[0]]?.name ?? ents[0] ?? ""] })),
    ...[...new Set(ents.flatMap((e) => (s.rolesByEntity[e] ?? []).filter((r) => !everywhere.includes(r))))].map((r) => ({ code: r, label: label(r), where: ents.filter((e) => (s.rolesByEntity[e] ?? []).includes(r)).map((e) => ENT[e]?.name ?? e) })),
  ];
  const R = ROLES[s.role]; const mods = MODULES.filter((m) => R.mods.includes(m.id) || (s.superadmin && !s.viewAs));
  const screens = (id: string) => (SUB[id] ?? []).filter((x) => !x.hidden && ((s.superadmin && !s.viewAs) || (R.subs[id] ?? []).includes(x.id))).map((x) => x.label);
  return (
    <>
      <PageHeader eyebrow="Home, My access rights" title="My access rights" sub="Who you are for S.A.M., in which organisations, the posts you hold and what they let you open." />
      {s.viewAs && <div className="card mb-4"><div className="cb">You are looking at S.A.M. as the profile <b>{s.viewAs}</b>: this page shows the rights of that profile, not yours.</div></div>}
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Who you are</span></div>
        <table className="tbl"><tbody>
          <tr><td style={{ width: 220 }} className="text-slate6">Name</td><td><b>{s.name}</b></td></tr>
          <tr><td className="text-slate6">Account</td><td>{s.email} <span className="mini">(your Microsoft account: S.A.M. has no password of its own)</span></td></tr>
          {s.person?.job_title && <tr><td className="text-slate6">Job title</td><td>{s.person.job_title}</td></tr>}
          {!s.person && <tr><td className="text-slate6">State</td><td className="red">Your account is not attached to a person in S.A.M. yet: ask Compliance.</td></tr>}
        </tbody></table>
      </section>
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Your organisations</span>{s.group && <span className="pill">group function: every organisation</span>}</div>
        <table className="tbl"><tbody>
          {ents.map((e) => <tr key={e}><td style={{ width: 220 }}><span className={"ent " + e}>{e}</span></td><td><b>{ENT[e]?.name ?? e}</b> <span className="mini">{ENT[e]?.qual}{ENT[e]?.auth ? `, ${ENT[e]?.auth}` : ""}</span>{s.entity === e && <span className="pill" style={{ marginLeft: 8 }}>the one you are working in now</span>}{s.defaultEntity === e && <span className="pill" style={{ marginLeft: 8 }}>opens by default</span>}</td></tr>)}
          {!ents.length && <tr><td className="p-5 text-slate6">No organisation yet: ask Compliance.</td></tr>}
        </tbody></table>
      </section>
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Your posts and roles</span></div>
        <table className="tbl"><thead><tr><th>Post or role</th><th>Where</th><th style={{ width: 140 }}>Code in S.A.M.</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.code}><td><b>{r.label}</b>{basePost(r.code) === "SUPERADMIN" && <div className="mini">Sets S.A.M. up and can look at it as any other profile.</div>}</td><td>{r.where.join(", ")}</td><td className="mono mini">{r.code}</td></tr>)}
        </tbody></table>
        <div className="cb mini">S.A.M. sends you the tasks addressed to these posts in the organisation where you hold them, and shows you what belongs to them there. The menus you see are those of the organisation you are working in. A deputy holds the same rights as the post they deputise.</div>
      </section>
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">What you can open</span><span className="mini">{mods.length} menus</span></div>
        <table className="tbl"><tbody>
          {mods.map((m) => <tr key={m.id}><td style={{ width: 220 }}><b>{m.label}</b></td><td className="mini">{screens(m.id).join(" · ")}</td></tr>)}
        </tbody></table>
      </section>
      <section className="card"><div className="cb mini">
        <p><b>Where this comes from.</b> Microsoft says who you are and which organisations you belong to. Your posts and roles are given in S.A.M. by the Compliance department; a change of nominated person moves them by itself.</p>
        <p className="mt-2"><b>Something is wrong or missing?</b> Ask the Compliance department: nothing here can be changed by yourself.</p>
        {s.superadmin && <p className="mt-2"><Link className="underline" href="/api/me" target="_blank">Technical view (for the administrator)</Link></p>}
      </div></section>
    </>
  );
}
