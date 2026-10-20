import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader } from "@/components/Page";
import { STEP_LABEL, listManuals } from "@/lib/docs";

export default async function MyManuals() {
  const s = await getSession();
  if (!s) redirect("/login");
  const rows = await listManuals(s);
  const mineRoles = new Set(s.roles.map((r) => r.toUpperCase()));
  const owned = s.role === "cmm" ? rows : rows.filter((r) => mineRoles.has(r.manual.owner_role.toUpperCase()));
  const sb = await supabaseServer();
  const currentIds = rows.map((r) => r.current?.id).filter((x): x is string => !!x);
  const { data: rd } = s.person && currentIds.length ? await sb.from("readings").select("revision_id,acknowledged_at").eq("person_id", s.person.id).in("revision_id", currentIds) : { data: [] };
  const ack = new Set(((rd ?? []) as { revision_id: string; acknowledged_at: string | null }[]).filter((r) => r.acknowledged_at).map((r) => r.revision_id));
  const toRead = rows.filter((r) => r.current && !ack.has(r.current.id));
  return (
    <>
      <PageHeader eyebrow="Documents · My manuals" title="My manuals" sub={s.role === "cmm" ? "As CMM you own the compliance side of every manual." : "Manuals of your post, and what you still have to read."} />
      <div className="grid grid-cols-2 gap-4">
        <section className="card"><div className="ch"><span className="eyebrow">To read and acknowledge</span><span className="mini">{toRead.length}</span></div>
          <table className="tbl"><tbody>
            {toRead.map(({ manual, current }) => <tr key={manual.id}><td><Link href={`/docs/manual/${manual.id}`}><b>{manual.code} — {manual.title}</b></Link><div className="mini">Rev {current!.rev} · published {current!.published_at}</div></td><td className="text-right"><Link className="btn" href={`/docs/manual/${manual.id}`}>Read ›</Link></td></tr>)}
            {!toRead.length && <tr><td className="p-5 text-slate6">Nothing to read — you are up to date.</td></tr>}
          </tbody></table></section>
        <section className="card"><div className="ch"><span className="eyebrow">Manuals I own</span><span className="mini">{owned.length}</span></div>
          <table className="tbl"><tbody>
            {owned.map(({ manual, current, working }) => <tr key={manual.id}><td><Link href={`/docs/manual/${manual.id}`}><b>{manual.code} — {manual.title}</b></Link><div className="mini">{manual.entity} · owner {manual.owner_role}</div></td><td className="text-right">{working ? <span className="pill amber">{STEP_LABEL[working.step]}</span> : current ? <span className="pill green">Rev {current.rev}</span> : <span className="pill red">Never published</span>}</td></tr>)}
            {!owned.length && <tr><td className="p-5 text-slate6">No manual is attached to your post yet.</td></tr>}
          </tbody></table></section>
      </div>
    </>
  );
}
