import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import AutoRefresh from "@/components/AutoRefresh";
import { ENT } from "@/lib/nav";
import { ERC_BARRIERS, ERC_OUTCOMES, STATUS, ercTone, ercValue, isSafetyDesk, morClock, seesReporter } from "@/lib/safety";
import { createAssessment, dismissMatch, linkReport, suggestForReport } from "../../risk/actions";
import type { Suggestion } from "@/lib/risk-match";
import { ACTION_STATUS } from "@/lib/actions-shared";
import { acknowledge, askReporter, classify, recordMor, rerunAnalysis, sendFeedback, setErc, setReportStatus } from "./actions";

export const maxDuration = 60;
type Rep = { id: string; entity: string; received_at: string; event_date: string | null; event_time_utc: string | null; aircraft: string | null; flight_ref: string | null; phase: string | null; location: string | null; headline: string; headline_en: string | null; narrative: string; narrative_en: string | null; complements: Record<string, string>; contributing: string | null; anonymous: boolean; reporter_person: string | null; status: string; language: string | null; feedback: string | null; mor_ref: string | null; mor_filed_at: string | null; source?: string; external_no?: string | null; report_type?: string | null; reporter_name?: string | null; source_erc?: number | null; occurrence_class?: string | null; risk_category?: string | null; event_type?: string | null; investigation?: string | null; findings?: string | null; closed_by_name?: string | null; hazard_label?: string | null };
type An = { adrep: string[]; primary_hazard: string | null; erc_outcome: string | null; erc_barriers: string | null; erc_value: number | null; erc_override_by: string | null; mor_status: string | null; mor_basis: string | null; mor_draft: string | null; questions: string[]; suggested_actions: string[]; summary: string | null; confirmed_at: string | null; ran_at: string | null; error: string | null };
type Ev = { id: number; at: string; kind: string; note: string | null; to_reporter: boolean };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Safety › Reports › report: the report as sent, and on the right the SM's analysis (ADREP, ERC, MOR 72 h, questions, actions, MOR draft). */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  if (!isSafetyDesk(s)) redirect("/safe/mine");
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("*").eq("id", id).maybeSingle();
  const r = data as Rep | null;
  if (!r || !s.entities.includes(r.entity)) notFound();
  if (r.status === "received") { await acknowledge(id); r.status = "acknowledged"; }
  const [{ data: an }, { data: evs }, rep] = await Promise.all([
    db.from("report_analysis").select("*").eq("report_id", id).maybeSingle(),
    db.from("report_events").select("id,at,kind,note,to_reporter").eq("report_id", id).order("at"),
    r.reporter_person && seesReporter(s) ? db.from("people").select("display_name,email,job_title").eq("id", r.reporter_person).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const a = an as An | null; const events = (evs ?? []) as Ev[];
  const [{ data: hzo }, { data: lk }, { data: mt }] = await Promise.all([
    db.from("hazards").select("id,ref,title,status,risk_assessments!inner(number,kind,status)").eq("entity", r.entity).eq("proposed", false).neq("status", "closed").eq("risk_assessments.kind", "hazard_log").order("ref").limit(500),
    db.from("hazard_reports").select("hazards(id,ref,title)").eq("report_id", id),
    db.from("risk_matches").select("suggestions,ran_at").eq("subject_kind", "report").eq("subject_id", id).maybeSingle(),
  ]);
  const sugg = ((mt as { suggestions: Suggestion[] } | null)?.suggestions ?? []);
  const { data: acts } = await db.from("safety_actions").select("id,number,title,status,due,owner_role").eq("report_id", id).order("created_at");
  const actions = (acts ?? []) as { id: string; number: string; title: string; status: string; due: string | null; owner_role: string | null }[];
  const hazOpts = ((hzo ?? []) as unknown as { id: string; ref: string; title: string; risk_assessments: { number: string } }[]).map((h) => ({ id: h.id, title: h.title, number: h.risk_assessments.number })).sort((x, y) => x.number.localeCompare(y.number));
  const linked = ((lk ?? []) as unknown as { hazards: { id: string; ref: string; title: string } | null }[]).map((x) => x.hazards).filter(Boolean) as { id: string; ref: string; title: string }[];
  const who = rep.data as { display_name: string; email: string; job_title: string | null } | null;
  const clock = morClock(r.received_at, r.mor_filed_at, a?.confirmed_at ? a.mor_status : null);
  const erc = a?.erc_value ?? ercValue(a?.erc_outcome, a?.erc_barriers);
  const translated = r.narrative_en && r.language && r.language !== "en";
  const closed = r.status === "closed";

  return (
    <>
      <PageHeader eyebrow={`Safety · Report ${r.id} · ${ENT[r.entity]?.name ?? r.entity}`} title={r.headline_en && translated ? r.headline_en : r.headline}
        tag={<span className="flex gap-2 items-center"><span className={"pill " + (STATUS[r.status]?.[1] ?? "")}>{STATUS[r.status]?.[0] ?? r.status}</span>
          <span className={"pill " + (clock.state === "late" ? "red" : clock.state === "running" ? (clock.left <= 24 ? "red" : "amber") : "green")}>MOR · {clock.label}</span>
          {erc != null && <span className={"pill " + ercTone(erc)}>ERC {erc}</span>}</span>}
        sub={`Received ${when(r.received_at)} · the 72 h run from receipt (EU 376/2014 art. 4(8)) · deadline ${when(clock.deadline.toISOString())}`}
        right={<Link href="/safe/reports" className="btn">All reports</Link>} />

      <div className="repgrid2">
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">The report, as sent</span><span className="mini">{r.source && r.source !== "sam" ? (seesReporter(s) ? (r.reporter_name ?? (r.anonymous ? "anonymous" : "—")) + " · " : "") + `imported from Centrik · ${r.external_no ?? ""}` : r.anonymous ? "anonymous" : who ? `${who.display_name}${who.job_title ? " · " + who.job_title : ""}` : seesReporter(s) ? "reporter not found" : "reporter identity: SM / FSO only"}</span></div>
            <div className="cb">
              <table className="tbl mb-3"><tbody>
                <tr><td className="mini" style={{ width: 130 }}>When</td><td>{r.event_date ?? "—"} {r.event_time_utc ? r.event_time_utc.slice(0, 5) + " UTC" : ""}</td></tr>
                <tr><td className="mini">Aircraft · flight</td><td>{r.aircraft ?? "—"} {r.flight_ref ? "· " + r.flight_ref : ""}</td></tr>
                <tr><td className="mini">Phase · where</td><td>{r.phase ?? "—"} {r.location ? "· " + r.location : ""}</td></tr>
              </tbody></table>
              <div className="narr">{translated ? r.narrative_en : r.narrative}</div>
              {Object.keys(r.complements ?? {}).length > 0 && <><div className="eyebrow mt-4 mb-1">Precisions given before sending</div><ul className="mini">{Object.entries(r.complements).map(([k, v]) => <li key={k}><b>{k.replace(/_/g, " ")}:</b> {v}</li>)}</ul></>}
              {r.contributing && <><div className="eyebrow mt-4 mb-1">Contributing factors in the reporter&apos;s view</div><p>{r.contributing}</p></>}
              {translated && <details className="mt-4"><summary className="mini underline cursor-pointer">Original text ({r.language})</summary><div className="narr mt-2">{r.narrative}</div></details>}
            </div>
          </section>

          {r.source && r.source !== "sam" && (
            <section className="card mb-4">
              <div className="ch"><span className="eyebrow">As recorded in Centrik</span><span className="mini">report {r.external_no} · read-only history</span></div>
              <div className="cb">
                <table className="tbl mb-3"><tbody>
                  {r.report_type && <tr><td className="mini" style={{ width: 150 }}>Report type</td><td>{r.report_type}</td></tr>}
                  {r.source_erc != null && <tr><td className="mini">ERC (Centrik)</td><td><span className={"pill " + (r.source_erc >= 300 ? "red" : r.source_erc >= 20 ? "amber" : "green")}>{r.source_erc}</span></td></tr>}
                  {r.occurrence_class && <tr><td className="mini">Occurrence class</td><td>{r.occurrence_class}</td></tr>}
                  {r.risk_category && <tr><td className="mini">Risk category</td><td>{r.risk_category}</td></tr>}
                  {r.event_type && <tr><td className="mini">Event type</td><td>{r.event_type}</td></tr>}
                  {r.hazard_label && <tr><td className="mini">Risk register</td><td>{r.hazard_label}</td></tr>}
                  {r.closed_by_name && <tr><td className="mini">Closed by</td><td>{r.closed_by_name}</td></tr>}
                </tbody></table>
                {r.investigation && <><div className="eyebrow mb-1">Investigation</div><div className="narr mb-3">{r.investigation}</div></>}
                {r.findings && <><div className="eyebrow mb-1">Findings and observations</div><div className="narr">{r.findings}</div></>}
              </div>
            </section>
          )}

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Journal</span><span className="mini">append-only · ✉ = seen by the reporter</span></div>
            <div className="cb"><ul className="journal">{events.map((e) => <li key={e.id}><span className="mini mono mr-2">{when(e.at)}</span>{e.to_reporter && <span title="seen by the reporter">✉ </span>}<b>{e.kind}</b> — {e.note}</li>)}</ul></div>
          </section>

          {!closed && (
            <section className="card mb-4">
              <div className="ch"><span className="eyebrow">Reporter</span><span className="mini">feedback is due to every reporter (376/2014 art. 13(4))</span></div>
              <div className="cb">
                {r.reporter_person ? (
                  <form action={askReporter} className="flex gap-2 mb-3"><input type="hidden" name="id" value={r.id} /><input name="question" className="inp flex-1" placeholder="Ask the reporter a factual question (shown in My reports)" required /><button className="btn">Ask</button></form>
                ) : <p className="mini mb-3">Anonymous report: no question can be sent.</p>}
                <form action={sendFeedback} className="flex gap-2"><input type="hidden" name="id" value={r.id} /><textarea name="feedback" className="inp flex-1" rows={2} defaultValue={r.feedback ?? ""} placeholder="What was done with the report" required /><button className="btn">Send feedback</button></form>
              </div>
            </section>
          )}
        </div>

        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">SAM · analysis for the Safety Manager</span><span className="mini">never shown to the reporter</span></div>
            <div className="cb">
              {!a?.ran_at && <p className="mini">SAM is preparing the analysis (about 30 seconds) — this page refreshes by itself.<AutoRefresh every={5000} /></p>}
              {a?.error && <p className="mini red">The analysis could not be prepared: {a.error}</p>}
              {a?.summary && <p className="mb-3">{a.summary}</p>}
              {a?.adrep?.length ? <p className="mb-2"><span className="eyebrow mr-2">ADREP / CICTT</span>{a.adrep.map((x) => <span key={x} className="kind k-comp mr-1">{x}</span>)}</p> : null}
              {a?.primary_hazard && <p className="mini mb-3">Hazard: {a.primary_hazard}</p>}
              <form action={rerunAnalysis}><input type="hidden" name="id" value={r.id} /><button className="mini underline">Prepare the analysis again</button></form>
            </div>
          </section>

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">ERC · ARMS event risk classification</span><span className="mini">{a?.erc_override_by ? "set by the SM" : erc != null ? "proposed by SAM — click to change" : "click a cell"}</span></div>
            <div className="cb">
              <table className="erc"><thead><tr><th>Most credible accident outcome</th>{ERC_BARRIERS.map((b) => <th key={b.id}>{b.label}</th>)}</tr></thead>
                <tbody>{ERC_OUTCOMES.map((o) => (
                  <tr key={o.id}><th title={o.hint}>{o.label}</th>{ERC_BARRIERS.map((b) => { const v = ercValue(o.id, b.id)!; return (
                    <td key={b.id} className={ercTone(v)}><form action={setErc}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="outcome" value={o.id} /><input type="hidden" name="barriers" value={b.id} /><button className={a?.erc_outcome === o.id && a?.erc_barriers === b.id ? "on" : ""} disabled={closed}>{v}</button></form></td>); })}</tr>
                ))}</tbody></table>
              <p className="mini mt-2">Columns: barriers that remained between the event and the outcome.</p>
            </div>
          </section>

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">MOR · Regulation (EU) 376/2014 &amp; 2015/1018</span><span className={"pill " + (clock.state === "late" ? "red" : clock.state === "running" ? "amber" : "green")}>{clock.label}</span></div>
            <div className="cb">
              {a?.mor_status && <p className="mb-2">SAM&apos;s view: <b>{a.mor_status === "mandatory" ? "mandatory occurrence" : a.mor_status === "likely" ? "probably mandatory" : "voluntary report"}</b>{a.mor_basis ? " — " + a.mor_basis : ""}</p>}
              {!a?.confirmed_at && !closed ? (
                <form action={classify} className="mt-2"><input type="hidden" name="id" value={r.id} />
                  <input name="basis" className="inp mb-2" defaultValue={a?.mor_basis ?? ""} placeholder="Basis (2015/1018 annex item, or why not reportable)" />
                  <div className="flex gap-2 flex-wrap"><label className="rchip-radio"><input type="radio" name="mor" value="mandatory" defaultChecked={a?.mor_status !== "voluntary"} required /> Mandatory — MOR to file</label><label className="rchip-radio"><input type="radio" name="mor" value="voluntary" defaultChecked={a?.mor_status === "voluntary"} /> Not reportable — voluntary</label><button className="btn primary">Confirm the decision</button></div>
                </form>
              ) : a?.confirmed_at && <p className="mini">Decided by the SM: {a.mor_status === "mandatory" ? "MOR to file" : "not a mandatory occurrence"}.</p>}
              {a?.mor_status === "mandatory" && a?.confirmed_at && !r.mor_filed_at && (
                <form action={recordMor} className="flex gap-2 mt-3"><input type="hidden" name="id" value={r.id} /><input name="ref" className="inp flex-1" placeholder="ECCAIRS / authority reference once filed" required /><button className="btn primary">Record as filed</button></form>
              )}
              {r.mor_filed_at && <p className="mt-2"><span className="pill green">Filed</span> {r.mor_ref} · {when(r.mor_filed_at)}</p>}
              {a?.mor_draft && <details className="mt-3" open={a.mor_status !== "voluntary" && !r.mor_filed_at}><summary className="mini underline cursor-pointer">De-identified MOR draft (for ECCAIRS / E5X)</summary><div className="narr mini mt-2">{a.mor_draft}</div></details>}
            </div>
          </section>

          {(a?.questions?.length || a?.suggested_actions?.length) ? (
            <section className="card mb-4">
              <div className="ch"><span className="eyebrow">Suggestions</span></div>
              <div className="cb">
                {a?.questions?.length ? <><div className="eyebrow mb-1">Questions for the reporter</div><ul className="mini mb-3">{a.questions.map((q, i) => <li key={i}>· {q}</li>)}</ul></> : null}
                {a?.suggested_actions?.length ? <><div className="eyebrow mb-1">Actions to consider</div><ul className="mini">{a.suggested_actions.map((q, i) => <li key={i} className="flex gap-2 items-start mb-1"><span className="flex-1">· {q}</span>{isSafetyDesk(s) && (actions.some((x) => x.title === q) ? <span className="mini">✓ raised</span> : <Link className="btn" href={`/safe/actions/new?entity=${r.entity}&report=${r.id}&title=${encodeURIComponent(q)}`}>Raise</Link>)}</li>)}</ul></> : null}
              </div>
            </section>
          ) : null}

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Risk register</span><span className="mini">each new occurrence reassesses its hazard (MSM §3.5.1)</span></div>
            <div className="cb grid gap-3">
              {linked.length > 0 && <div className="mini">Linked to: {linked.map((l) => <Link key={l.id} className="underline mr-2" href={`/safe/risk/${l.id}`}>{l.ref} {l.title}</Link>)}</div>}
              {isSafetyDesk(s) && (mt ? sugg.filter((x) => !linked.some((l) => l.id === x.id)).map((x) => (
                <div key={x.id} className="flex gap-2 items-center"><span className="flex-1">🤝 <Link className="underline mono" href={`/safe/risk/${x.id}`}>{x.ref}</Link> {x.title} <span className={"pill " + (x.score >= 0.8 ? "green" : "amber")}>{Math.round(x.score * 100)}%</span>{x.why && <div className="mini">{x.why}</div>}</span>
                  <form action={linkReport}><input type="hidden" name="report_id" value={r.id} /><input type="hidden" name="hazard_id" value={x.id} /><button className="btn">Link</button></form>
                  <form action={dismissMatch}><input type="hidden" name="kind" value="report" /><input type="hidden" name="subject" value={r.id} /><input type="hidden" name="other" value={x.id} /><button className="btn" title="Not this hazard">✕</button></form></div>))
                : hazOpts.length > 0 && <form action={suggestForReport}><input type="hidden" name="report_id" value={r.id} /><button className="btn">🤝 Which hazard of the log?</button></form>)}
              {mt && !sugg.length && !linked.length && <p className="mini">SAM found no hazard of the log for this occurrence — create a new entry if it is a lasting hazard.</p>}
              {hazOpts.length > 0 && (
                <form action={linkReport} className="flex gap-2"><input type="hidden" name="report_id" value={r.id} />
                  <select name="hazard_id" className="inp flex-1" style={{ marginTop: 0 }} required defaultValue="">{[<option key="" value="" disabled>Link to a hazard of the log…</option>, ...hazOpts.map((h) => <option key={h.id} value={h.id}>{h.number} · {h.title}</option>)]}</select>
                  <button className="btn">Link</button></form>
              )}
              <form action={createAssessment} className="grid gap-2"><input type="hidden" name="entity" value={r.entity} /><input type="hidden" name="report_id" value={r.id} /><input type="hidden" name="kind" value="hazard_log" />
                <input name="name" className="inp" defaultValue={`HZ - ${a?.primary_hazard ?? r.headline_en ?? r.headline}`.slice(0, 160)} required />
                <input type="hidden" name="hazard_title" value={(a?.primary_hazard ?? r.headline_en ?? r.headline).slice(0, 200)} />
                <div className="flex justify-end"><button className="btn">New hazard log entry from this report</button></div></form>
            </div>
          </section>

          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Actions</span><span className="mini">{actions.length}</span></div>
            <div className="cb grid gap-1">
              {actions.map((x) => <div key={x.id} className="flex gap-2 items-center"><Link className="underline mono" href={`/safe/actions/${x.id}`}>{x.number}</Link><span className="flex-1">{x.title}</span><span className={"pill " + (ACTION_STATUS[x.status]?.[1] ?? "")}>{ACTION_STATUS[x.status]?.[0]}</span></div>)}
              {!actions.length && <p className="mini">No action raised for this report.</p>}
              {isSafetyDesk(s) && <Link className="btn mt-1" style={{ justifySelf: "start" }} href={`/safe/actions/new?entity=${r.entity}&report=${r.id}`}>+ Raise an action</Link>}
            </div>
          </section>

          <section className="card">
            <div className="ch"><span className="eyebrow">Report status</span></div>
            <div className="cb flex gap-2">
              {r.status !== "investigation" && !closed && <form action={setReportStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="investigation" /><button className="btn">Open an investigation</button></form>}
              {!closed && <form action={setReportStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="closed" /><button className="btn" disabled={clock.state === "running" || clock.state === "late"} title={clock.state === "running" || clock.state === "late" ? "Decide on the MOR first" : ""}>Close the report</button></form>}
              {closed && <span className="mini">Closed.</span>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
