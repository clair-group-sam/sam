import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { HZ_STATUS, TOL_LABEL, mayEditRisk, tolerability, tolTone } from "@/lib/risk";
import { RiskMatrix, RiskPill } from "@/components/RiskMatrix";
import { addMitigation, doneMitigation, keepHazard, discardHazard, updateHazard } from "../actions";

type H = { id: string; entity: string; ref: string; title: string; description: string | null; consequence: string | null; source: string; report_id: string | null; moc_id: string | null; proposed: boolean; owner_role: string | null; status: string; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; review_date: string | null };
type M = { id: string; text: string; existing: boolean; owner_role: string | null; due: string | null; done_at: string | null };
type E = { id: number; at: string; kind: string; note: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Safety › Risk register › hazard: rating before / after (clickable matrices), barriers and mitigations (Inbox items for their owners), journal. */
export default async function HazardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("hazards").select("*").eq("id", id).maybeSingle();
  const h = data as H | null;
  if (!h || !s.entities.includes(h.entity)) notFound();
  const [{ data: ms }, { data: ev }, { data: moc }] = await Promise.all([
    db.from("hazard_mitigations").select("id,text,existing,owner_role,due,done_at").eq("hazard_id", id).order("created_at"),
    db.from("risk_events").select("id,at,kind,note").eq("hazard_id", id).order("at"),
    h.moc_id ? db.from("mocs").select("id,ref,title").eq("id", h.moc_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const mit = (ms ?? []) as M[]; const events = (ev ?? []) as E[]; const m = moc as { id: string; ref: string; title: string } | null;
  const edit = mayEditRisk(s) && h.status !== "closed";
  const tb = tolerability(h.lik_before, h.sev_before), ta = tolerability(h.lik_after, h.sev_after);
  return (
    <>
      <PageHeader eyebrow={`Safety · Risk register · ${h.ref}`} title={h.title}
        tag={<span className="flex gap-2 items-center"><span className={"pill " + (HZ_STATUS[h.status]?.[1] ?? "")}>{HZ_STATUS[h.status]?.[0]}</span><RiskPill lik={h.lik_before} sev={h.sev_before} prefix="initial" /><RiskPill lik={h.lik_after} sev={h.sev_after} prefix="residual" />{h.proposed && <span className="pill">proposed by SAM</span>}</span>}
        sub={`${h.entity} · ${h.source === "moc" && m ? `from ${m.ref} — ${m.title}` : h.source === "report" ? `from safety report ${h.report_id}` : h.source} · review by ${h.review_date ?? "—"}`}
        right={<>{m && <Link className="btn" href={`/safe/moc/${m.id}`}>{m.ref}</Link>}{h.report_id && <Link className="btn" href={`/safe/reports/${h.report_id}`}>Report {h.report_id}</Link>}<Link className="btn" href="/safe/risk">Register</Link></>} />
      {h.proposed && edit && (
        <section className="card hz-proposed mb-4"><div className="cb flex gap-3 items-center"><span className="flex-1">SAM proposed this hazard. Keep it (its mitigations with an owner then reach their Inbox) or discard it.</span>
          <form action={keepHazard}><input type="hidden" name="id" value={h.id} /><button className="btn primary">Keep</button></form><form action={discardHazard}><input type="hidden" name="id" value={h.id} /><button className="btn">Discard</button></form></div></section>
      )}
      <div className="repgrid2">
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Hazard</span></div>
            <form action={updateHazard} className="cb grid gap-2"><input type="hidden" name="id" value={h.id} />
              <label><span className="mini">Hazard</span><input name="title" className="inp" defaultValue={h.title} disabled={!edit} /></label>
              <label><span className="mini">Worst credible consequence</span><input name="consequence" className="inp" defaultValue={h.consequence ?? ""} disabled={!edit} /></label>
              <label><span className="mini">Description</span><textarea name="description" className="inp" rows={3} defaultValue={h.description ?? ""} disabled={!edit} /></label>
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" defaultValue={h.owner_role ?? ""} disabled={!edit} /></label><label><span className="mini">Next review</span><input type="date" name="review_date" className="inp" defaultValue={h.review_date ?? ""} disabled={!edit} /></label></div>
              {edit && <div className="flex justify-end"><button className="btn">Save</button></div>}
            </form>
          </section>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Barriers &amp; mitigations</span><span className="mini">a mitigation with an owner goes to their Inbox</span></div>
            <div className="cb">
              <table className="tbl mb-3"><tbody>{mit.map((x) => (
                <tr key={x.id}><td style={{ width: 120 }}><span className={"kind " + (x.existing ? "k-read" : x.done_at ? "k-read" : "k-cert")}>{x.existing ? "In place" : x.done_at ? "Done" : "To put in place"}</span></td>
                  <td>{x.text}<div className="mini">{x.owner_role ?? ""}{x.due ? ` · by ${x.due}` : ""}{x.done_at ? ` · done ${x.done_at.slice(0, 10)}` : ""}</div></td>
                  <td style={{ width: 90 }} className="text-right">{!x.existing && !x.done_at && edit && <form action={doneMitigation}><input type="hidden" name="id" value={x.id} /><button className="btn">Done</button></form>}</td></tr>))}
                {!mit.length && <tr><td className="mini p-3">No barrier listed yet.</td></tr>}</tbody></table>
              {edit && (
                <form action={addMitigation} className="grid gap-2" style={{ gridTemplateColumns: "1fr 130px 90px 140px auto" }}><input type="hidden" name="hazard_id" value={h.id} />
                  <input name="text" className="inp" placeholder="Barrier or mitigation" required />
                  <select name="existing" className="inp"><option value="0">to put in place</option><option value="1">already in place</option></select>
                  <input name="owner_role" className="inp mono" placeholder="post" />
                  <input type="date" name="due" className="inp" />
                  <button className="btn">Add</button>
                </form>
              )}
            </div>
          </section>
          <section className="card">
            <div className="ch"><span className="eyebrow">Journal</span></div>
            <div className="cb"><ul className="journal">{events.map((e) => <li key={e.id}><span className="mini mono mr-2">{when(e.at)}</span><b>{e.kind.replace(/_/g, " ")}</b> — {e.note}</li>)}</ul></div>
          </section>
        </div>
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Initial risk</span>{tb && <span className={"pill " + tolTone(tb)}>{TOL_LABEL[tb]}</span>}</div>
            <div className="cb"><RiskMatrix id={h.id} which="before" lik={h.lik_before} sev={h.sev_before} editable={edit} /><p className="mini mt-2">Before the mitigations to put in place, with the barriers already there.</p></div>
          </section>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Residual risk</span>{ta && <span className={"pill " + tolTone(ta)}>{TOL_LABEL[ta]}</span>}</div>
            <div className="cb"><RiskMatrix id={h.id} which="after" lik={h.lik_after} sev={h.sev_after} editable={edit} /><p className="mini mt-2">Once the mitigations are in place.</p></div>
          </section>
          {mayEditRisk(s) && (
            <section className="card"><div className="ch"><span className="eyebrow">Status</span></div>
              <div className="cb flex gap-2">{(["open", "monitoring", "closed"] as const).filter((x) => x !== h.status).map((x) => <form key={x} action={updateHazard}><input type="hidden" name="id" value={h.id} /><input type="hidden" name="status" value={x} /><button className="btn">{x === "open" ? "Reopen" : x === "monitoring" ? "Monitoring" : "Close the hazard"}</button></form>)}</div></section>
          )}
        </div>
      </div>
    </>
  );
}
