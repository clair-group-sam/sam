import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { isCmm } from "@/lib/revisions";
import { today, fr } from "@/lib/authority";
import { recordReading } from "./actions";

/* PRJ-05 · Projects › CAA applications › Portal readings: paste what the portals showed (the CAA point), S.A.M. compares it with its
 * files and findings and proposes the changes. No portal password in S.A.M.: a person reads the portal, S.A.M. keeps the reading. */
export default async function PortalReadings({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const s = await getSession(); if (!s) redirect("/login"); if (!isCmm(s)) redirect("/proj/auth");
  const { data } = await supabaseAdmin().from("portal_readings").select("id,read_on,source,entities,lines,applied,created_at").order("read_on", { ascending: false }).limit(30);
  const rs = (data ?? []) as { id: string; read_on: string; source: string | null; entities: string[]; lines: unknown; applied: Record<string, unknown> | null }[];
  const n = (x: unknown) => (Array.isArray(x) ? x.length : Array.isArray((x as { rows?: unknown[] })?.rows) ? (x as { rows: unknown[] }).rows.length : 0);
  return (
    <>
      <PageHeader eyebrow="Projects, CAA applications, Portal readings" title="Portal readings" sub="What TMCAD, METEOR and Centrik showed on a given day, compared line by line with the files and findings S.A.M. holds. S.A.M. proposes, you tick what to apply." right={<Link className="btn" href="/proj/auth">CAA applications</Link>} />
      {err && <div className="card mb-4"><div className="cb"><span className="pill red">not saved</span> <span className="mini">{err}</span></div></div>}
      <section className="card mb-4"><div className="ch"><span className="eyebrow">New reading</span></div>
        <form action={recordReading} className="cb grid gap-2">
          <div className="grid grid-cols-2 gap-3"><label><span className="mini">Read on</span><input type="date" name="read_on" className="inp" defaultValue={today()} required /></label><label><span className="mini">Portals read</span><input name="source" className="inp" placeholder="TMCAD, Centrik AJD Compliance, METEOR ASTONJET, METEOR ASTONFLY" /></label></div>
          <label><span className="mini">The reading (JSON list: entity, kind, number, title, status, assessor, due, turn, last exchange, next task, who — the keys of the CAA point are accepted as they are)</span><textarea name="lines" className="inp mono" rows={8} required placeholder='[{"entite":"AJD","nature":"Dossier","numero":"APP/AJD/OPS_9/39410","objet":"Addition of Aircraft","statut":"Assessing","echeance":"2026-11-23","balle":"Nous", …}]' /></label>
          <div className="flex justify-end"><button className="btn primary">Compare with S.A.M.</button></div>
          <p className="mini">Nothing is changed at this step. Names of third parties in a title (a trainee, a pilot) can be shortened in the review before a file is opened.</p>
        </form></section>
      <section className="card"><div className="ch"><span className="eyebrow">Readings kept</span><span className="mini">{rs.length}</span></div>
        <div className="cb" style={{ padding: 0 }}>{rs.length ? <table className="tbl"><thead><tr><th>Read on</th><th>Portals</th><th>Entities</th><th>Lines</th><th>Applied</th></tr></thead><tbody>
          {rs.map((r) => <tr key={r.id}><td className="mono"><Link className="underline" href={`/proj/auth/sync/${r.id}`}>{fr(r.read_on)}</Link></td><td className="mini">{r.source ?? "—"}</td><td>{r.entities.map((e) => <span key={e} className={"ent " + e} style={{ marginRight: 4 }}>{e}</span>)}</td><td className="mono">{n(r.lines)}</td><td className="mono">{Object.keys(r.applied ?? {}).length}</td></tr>)}
        </tbody></table> : <p className="p-4 mini">No reading yet.</p>}</div></section>
    </>
  );
}
