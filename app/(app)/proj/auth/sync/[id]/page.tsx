import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { isCmm } from "@/lib/revisions";
import { fr } from "@/lib/authority";
import { parseLines, planSync, type Proposal } from "@/lib/portal-sync";
import { applyReading, closeFindingFromReading, openFindingFromReading } from "../actions";

/* PRJ-05 · one reading against S.A.M.: per line, what S.A.M. holds and what would change. Ticked lines are applied; the rest stays. */
const TONE: Record<Proposal["action"], [string, string]> = { create: ["To open in S.A.M.", "amber"], update: ["Changed", "amber"], same: ["Same as S.A.M.", "green"], missing: ["Not in S.A.M.", "red"], info: ["Information", ""] };
export default async function Reading({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login"); if (!isCmm(s)) redirect("/proj/auth");
  const { id } = await params; const { msg } = await searchParams; const db = supabaseAdmin();
  const { data } = await db.from("portal_readings").select("*").eq("id", id).maybeSingle();
  const r = data as { id: string; read_on: string; source: string | null; lines: unknown; applied: Record<string, { at: string; by: string; what: string }> | null } | null; if (!r) notFound();
  const { proposals, unseen, types } = await planSync(db, parseLines(r.lines), r.read_on, r.applied ?? {});
  const count = (a: Proposal["action"]) => proposals.filter((p) => p.action === a).length;
  const todo = proposals.filter((p) => (p.action === "create" || p.action === "update") && !p.applied).length;
  const ents = [...new Set(proposals.map((p) => p.line.entity))];
  return (
    <>
      <PageHeader eyebrow="Projects, CAA applications, Portal readings" title={`Portal reading of ${fr(r.read_on)}`} sub={`${r.source ?? "Portals"}: ${proposals.length} lines compared with S.A.M. Tick the lines to apply; a stage is never moved by a reading, the portal's wording is stored beside it.`} right={<Link className="btn" href="/proj/auth/sync">All readings</Link>} />
      {msg && <div className="card mb-4"><div className="cb">{msg}</div></div>}
      <div className="grid grid-cols-5 gap-4 mb-5">
        <Metric label="To open in S.A.M." value={count("create")} tone={count("create") ? "amber" : undefined} hint="on the portal, not in S.A.M." />
        <Metric label="Changed" value={count("update")} tone={count("update") ? "amber" : undefined} hint="status, date, turn, exchange" />
        <Metric label="Same as S.A.M." value={count("same")} tone="green" />
        <Metric label="Findings not in S.A.M." value={count("missing")} tone={count("missing") ? "red" : undefined} hint="to raise in Compliance" />
        <Metric label="In S.A.M., not read" value={unseen.length} tone={unseen.length ? "amber" : undefined} hint="at the authority here, absent from the reading" />
      </div>
      <form action={applyReading}><input type="hidden" name="id" value={r.id} />
        {ents.map((e) => <section key={e} className="card mb-4"><div className="ch"><span className={"ent " + e}>{e}</span><span className="mini">{proposals.filter((p) => p.line.entity === e).length} lines</span></div>
          <div className="cb" style={{ padding: 0, overflowX: "auto" }}><table className="tbl"><thead><tr><th></th><th>Portal</th><th>Read on the portal</th><th>S.A.M.</th><th>What would change</th></tr></thead><tbody>
            {proposals.filter((p) => p.line.entity === e).map((p) => { const l = p.line; const can = (p.action === "create" || p.action === "update" || (p.action === "same" && !p.applied)) && p.object !== "none"; const done = r.applied?.[l.key];
              return <tr key={l.key}>
                <td style={{ width: 34 }}>{can && !done ? <input type="checkbox" name="pick" value={l.key} aria-label={`Apply ${l.key}`} defaultChecked={p.action === "update"} /> : null}</td>
                <td style={{ minWidth: 200 }}><b>{l.key}</b> <span className="mini">{p.object === "finding" ? "finding" : p.object === "file" ? "application" : ""}</span><div className="mono mini">{l.number}</div><span className={"pill " + TONE[p.action][1]}>{done ? `${done.what} ${fr(done.at)}` : TONE[p.action][0]}</span></td>
                <td style={{ maxWidth: 340 }}>{p.action === "create" && !done ? <input name={`title_${l.key}`} className="inp" defaultValue={l.title} aria-label="Title in S.A.M." style={{ marginTop: 0 }} /> : <b>{l.title}</b>}
                  <div className="mini">{l.status}{l.due ? `, due ${fr(l.due)}` : ""}{l.turn ? `, ${l.turn === "us" ? "our turn" : "the authority's turn"}` : ""}{l.assessor ? `, ${l.assessor}` : ""}</div>
                  {l.last && <div className="mini">Last exchange: {l.last.slice(0, 220)}</div>}{l.next && <div className="mini">To do: {l.next}{l.who ? `, ${l.who}` : ""}</div>}</td>
                <td className="mini" style={{ maxWidth: 240 }}>{p.href && p.id ? <Link className="underline" href={p.href}>{p.holds}</Link> : p.action === "create" && !done ? <label>Type<select name={`type_${l.key}`} className="inp" defaultValue={p.typeGuess ?? ""}>{types.filter((t) => t.entities.includes(l.entity)).map((t) => <option key={t.code} value={t.code}>{t.code}, {t.name.slice(0, 40)}</option>)}</select></label> : p.action === "missing" ? <button className="btn" type="submit" formAction={openFindingFromReading} name="open" value={l.key}>Open this finding in S.A.M.</button> : "—"}</td>
                <td className="mini" style={{ maxWidth: 360 }}>{p.changes.map((c) => <div key={c.field}><b>{c.label}</b>: {c.from ? <><s>{c.from.slice(0, 80)}</s> → </> : ""}{(c.to ?? "").slice(0, 160)}</div>)}{p.note && <div className={p.action === "missing" ? "late" : ""}>{p.note}</div>}{l.closed && p.id && <div className="flex gap-2 items-end mt-1"><label><span className="mini">Closed by the authority on</span><input type="date" name={`closed_on_${l.key}`} className="inp" defaultValue={r.read_on} max={r.read_on} style={{ marginTop: 0 }} /></label><button className="btn" type="submit" formAction={closeFindingFromReading} name="close" value={l.key}>Close in S.A.M.</button></div>}{!p.changes.length && !p.note && p.action === "same" ? "Nothing: the date of the reading is recorded" : ""}</td>
              </tr>; })}
          </tbody></table></div></section>)}
        {unseen.length > 0 && <section className="card mb-4"><div className="ch"><span className="eyebrow">In S.A.M. at the authority, absent from this reading</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{unseen.map((u) => <tr key={u.id}><td><span className={"ent " + u.entity}>{u.entity}</span></td><td className="mono">{u.ref}</td><td><Link className="underline" href={`/proj/auth/${u.id}`}>{u.title}</Link></td><td className="mini">{u.stage}: closed on the portal, or not read?</td></tr>)}</tbody></table></div></section>}
        <div className="flex justify-end gap-3 items-center"><span className="mini">{todo} line{todo === 1 ? "" : "s"} to decide</span><button className="btn primary">Apply the ticked lines</button></div>
      </form>
    </>
  );
}
