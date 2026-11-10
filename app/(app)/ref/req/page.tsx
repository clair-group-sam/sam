import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";

/* References · Requirements register: the regulations that apply to the working entity, as S.A.M. holds them (Regulation › Easy Access
 * Rules): domain, version read, when it was read, how many implementing rules are loaded, when it was last checked for a change. */
type Reg = { key: string; short: string; title: string; number: string | null; entities: string[]; domains: string[]; current_version: string | null; version_since: string | null; items_version: string | null; checked_at: string | null; check_result: string | null; page_url: string; active: boolean };
export default async function Requirements() {
  const s = await getSession(); if (!s) redirect("/login");
  if (s.role === "user") redirect("/home/mine");
  const ents = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const { data } = await db.from("regulations").select("key,short,title,number,entities,domains,current_version,version_since,items_version,checked_at,check_result,page_url,active").eq("active", true).order("sort").order("short");
  const regs = (data ?? []) as Reg[];
  return (
    <>
      <PageHeader eyebrow="References, Requirements register" title="Requirements register" sub="The regulations each entity answers to, with the version S.A.M. has read and when it last checked EASA for a change. Articles and AMC/GM are in Regulation › Easy Access Rules." right={<Link className="btn" href="/reg/ear">Open Easy Access Rules</Link>} />
      {ents.map((e) => { const mine = regs.filter((r) => r.entities.includes(e)); return (
        <section key={e} className="card mb-4">
          <div className="ch"><b>{ENT[e]?.name ?? e}</b><span className="mini">{ENT[e]?.qual}, {ENT[e]?.auth} · {mine.length} regulation{mine.length === 1 ? "" : "s"}</span></div>
          <div className="cb" style={{ padding: 0 }}>
            {mine.length ? <table className="tbl"><thead><tr><th>Regulation</th><th>Domains</th><th>Version read</th><th>Last check</th><th></th></tr></thead><tbody>
              {mine.map((r) => <tr key={r.key}><td><b>{r.short}</b><div className="mini">{r.number ? `${r.number}, ` : ""}{r.title}</div></td><td className="mini">{r.domains.join(", ")}</td><td className="mini">{r.current_version ?? "—"}{r.version_since ? `, since ${r.version_since}` : ""}</td><td className="mini">{r.checked_at ? r.checked_at.slice(0, 10) : "never"}{r.check_result ? `, ${r.check_result}` : ""}</td><td><Link className="mini underline" href={`/reg/ear/${r.key}`}>Open the rules</Link></td></tr>)}
            </tbody></table> : <p className="p-4 mini">No regulation attached to this entity yet: Regulation › Easy Access Rules sets which entities each regulation applies to.</p>}
          </div>
        </section>); })}
      {regs.some((r) => !ents.some((e) => r.entities.includes(e))) && <p className="mini">Other regulations loaded in S.A.M., not attached to {ents.length > 1 ? "these entities" : "this entity"}: {regs.filter((r) => !ents.some((e) => r.entities.includes(e))).map((r) => r.short).join(", ")}.</p>}
    </>
  );
}
