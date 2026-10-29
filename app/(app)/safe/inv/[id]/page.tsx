import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_STATUS } from "@/lib/actions-shared";
import { FACTOR_CAT, INV_LEVEL, INV_STATUS, INV_STEPS, invLate, mayEdit, mayRead, type Investigation } from "@/lib/investigations";
import { cancelInvestigation, closeInvestigation, draftInvReport, saveAnalysis, saveConclusions, saveFacts, saveScope, saveTeam } from "../actions";

export const maxDuration = 60;

/** One internal safety investigation: scope & team, facts & timeline, analysis, recommendations (safety actions), conclusions & report, close. */
export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params; const db = supabaseAdmin();
  const { data } = await db.from("investigations").select("*").eq("id", id).maybeSingle();
  const i = data as Investigation | null;
  if (!i || !s.entities.includes(i.entity) || !mayRead(s, i)) notFound();
  const [{ data: rep }, { data: acts }, { data: ev }, { data: ppl }] = await Promise.all([
    i.report_id ? db.from("reports").select("id,headline,headline_en,narrative,narrative_en,event_date,aircraft,phase,location,status").eq("id", i.report_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("safety_actions").select("id,number,title,status,due,owner_role").eq("investigation_id", i.id).order("created_at"),
    db.from("investigation_events").select("at,kind,note").eq("investigation_id", i.id).order("at", { ascending: false }).limit(40),
    db.from("people").select("id,display_name").contains("entities", [i.entity]).order("display_name").limit(400),
  ]);
  const r = rep as { id: string; headline: string; headline_en: string | null; narrative: string; narrative_en: string | null; event_date: string | null; aircraft: string | null; phase: string | null; location: string | null; status: string } | null;
  const A = (acts ?? []) as { id: string; number: string; title: string; status: string; due: string | null; owner_role: string | null }[];
  const P = (ppl ?? []) as { id: string; display_name: string }[];
  const edit = mayEdit(s, i) && !["closed", "cancelled"].includes(i.status);
  const step = INV_STEPS.indexOf(i.status as never);
  const Hid = () => <input type="hidden" name="id" value={i.id} />;
  const T = ({ v }: { v: string | null }) => (v ? <p style={{ whiteSpace: "pre-wrap" }}>{v}</p> : <p className="mini">Not written.</p>);
  return (
    <>
      <PageHeader eyebrow={`Safety · Investigations · ${i.entity}`} title={`${i.number} — ${i.title}`} sub={`${INV_LEVEL[i.level]?.[0] ?? i.level} · lead ${i.lead_name ?? "—"} · due ${i.due ?? "—"}`}
        tag={<span className="flex gap-2"><span className={"pill " + (invLate(i) ? "red" : INV_STATUS[i.status]?.[1] ?? "")}>{invLate(i) ? "Overdue" : INV_STATUS[i.status]?.[0]}</span><span className="pill">Confidential · just culture</span></span>}
        right={<><Link href="/safe/inv" className="btn">← Investigations</Link>{i.report_text && <a className="btn" href={`/print/investigation/${i.id}`} target="_blank" rel="noreferrer">Report PDF</a>}</>} />

      {i.status !== "cancelled" && <div className="steps mb-4">{["1 · Scope & team", "2 · Facts", "3 · Analysis", "4 · Conclusions & report", "5 · Closed"].map((l, k) => <span key={l} className={step >= k ? "on" : ""}>{l}</span>)}</div>}

      <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
        <div>
          {r && <section className="card mb-5"><div className="ch"><span className="eyebrow">Report</span><Link className="mini underline ml-auto" href={`/safe/reports/${r.id}`}>{r.id} ↗</Link></div>
            <div className="cb"><b>{r.headline_en ?? r.headline}</b><div className="mini">{[r.event_date, r.aircraft, r.phase, r.location].filter(Boolean).join(" · ")}</div><p className="mt-2" style={{ whiteSpace: "pre-wrap" }}>{(r.narrative_en ?? r.narrative).slice(0, 1500)}</p></div></section>}

          <section className="card mb-5"><div className="ch"><span className="eyebrow">1 · Terms of reference</span></div>
            <div className="cb">{edit ? <form action={saveScope} className="grid grid-cols-3 gap-2"><Hid />
              <label className="col-span-3"><span className="mini">Title</span><input name="title" className="inp" defaultValue={i.title} /></label>
              <label><span className="mini">Level</span><select name="level" className="inp" defaultValue={i.level}>{Object.entries(INV_LEVEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="mini">Lead</span><select name="lead_person" className="inp" defaultValue={i.lead_person ?? ""}><option value="">—</option>{P.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
              <label><span className="mini">Due</span><input type="date" name="due" className="inp" defaultValue={i.due ?? ""} /></label>
              <label className="col-span-3"><span className="mini">Scope and the questions the investigation must answer</span><textarea name="terms" className="inp" rows={3} defaultValue={i.terms ?? ""} /></label>
              <div className="col-span-3 flex justify-end"><button className="btn">Save</button></div></form> : <T v={i.terms} />}</div></section>

          <section className="card mb-5"><div className="ch"><span className="eyebrow">2 · Facts</span><span className="mini">interviews, flight data, documents, records — facts only</span></div>
            <div className="cb">
              <table className="tbl mb-2"><thead><tr><th style={{ width: 150 }}>When (UTC)</th><th>Sequence of events</th>{edit && <th style={{ width: 40 }} />}</tr></thead>
                <tbody>{i.timeline.map((t, k) => <tr key={k}><td className="mono">{t.at.replace("T", " ")}</td><td>{t.text}</td>{edit && <td><form action={saveFacts}><Hid /><input type="hidden" name={`trm${k}`} value="1" /><button className="btn" title="Remove">✕</button></form></td>}</tr>)}
                  {!i.timeline.length && <tr><td colSpan={3} className="mini">No event in the timeline yet.</td></tr>}</tbody></table>
              {edit ? <form action={saveFacts} className="grid gap-2"><Hid />
                <div className="flex gap-2"><input type="datetime-local" name="t_at" className="inp" style={{ width: 220, marginTop: 0 }} /><input name="t_text" className="inp" placeholder="+ Add an event to the timeline" style={{ marginTop: 0 }} /></div>
                <textarea name="facts" className="inp" rows={6} defaultValue={i.facts ?? ""} placeholder="Factual information gathered: crew / staff statements, data, weather, aircraft, documents, training records…" />
                <div className="flex justify-end"><button className="btn">Save</button></div></form> : <T v={i.facts} />}
            </div></section>

          <section className="card mb-5"><div className="ch"><span className="eyebrow">3 · Analysis</span><span className="mini">contributing factors, then causes</span></div>
            <div className="cb">
              {Object.entries(FACTOR_CAT).map(([cat, l]) => { const f = i.factors.map((x, k) => ({ ...x, k })).filter((x) => x.cat === cat); return f.length ? (
                <div key={cat} className="mb-2"><div className="mini"><b>{l}</b></div><ul style={{ margin: "2px 0 0 16px", listStyle: "disc" }}>{f.map((x) => <li key={x.k} className="flex gap-2 items-start"><span style={{ flex: 1 }}>{x.text}</span>{edit && <form action={saveAnalysis}><Hid /><input type="hidden" name={`frm${x.k}`} value="1" /><button className="btn" title="Remove">✕</button></form>}</li>)}</ul></div>) : null; })}
              {!i.factors.length && <p className="mini mb-2">No contributing factor recorded.</p>}
              {edit ? <form action={saveAnalysis} className="grid gap-2"><Hid />
                <div className="flex gap-2"><select name="f_cat" className="inp" style={{ width: 260, marginTop: 0 }} defaultValue="human">{Object.entries(FACTOR_CAT).map(([k, l]) => <option key={k} value={k}>{l.split(" (")[0]}</option>)}</select><input name="f_text" className="inp" placeholder="+ Add a contributing factor" style={{ marginTop: 0 }} /></div>
                <label><span className="mini">Causes — why it happened (main and underlying)</span><textarea name="causes" className="inp" rows={3} defaultValue={i.causes ?? ""} /></label>
                <div className="flex justify-end"><button className="btn">Save</button></div></form> : <><div className="mini mt-2"><b>Causes</b></div><T v={i.causes} /></>}
            </div></section>

          <section className="card mb-5" id="actions"><div className="ch"><span className="eyebrow">Safety recommendations</span><span className="mini">each one is a safety action, followed in Safety › Actions</span></div>
            <table className="tbl"><tbody>{A.map((a) => <tr key={a.id}><td className="mono" style={{ width: 150 }}><Link className="underline" href={`/safe/actions/${a.id}`}>{a.number}</Link></td><td>{a.title}</td><td className="mini" style={{ width: 80 }}>{a.owner_role ?? ""}</td><td className="mono" style={{ width: 100 }}>{a.due ?? ""}</td><td style={{ width: 150 }}><span className={"pill " + (ACTION_STATUS[a.status]?.[1] ?? "")}>{ACTION_STATUS[a.status]?.[0] ?? a.status}</span></td></tr>)}
              {!A.length && <tr><td className="p-4 mini">No recommendation yet.</td></tr>}</tbody></table>
            {edit && <div className="cb"><NewActionForm entity={i.entity} source="investigation" investigation_id={i.id} report_id={i.report_id ?? undefined} stay /></div>}
          </section>

          <section className="card mb-5"><div className="ch"><span className="eyebrow">4 · Conclusions &amp; report</span>
            {edit && <form action={draftInvReport} className="ml-auto"><Hid /><button className="btn">{i.report_text ? "Draft the report again" : "Draft the report"}</button></form>}</div>
            <div className="cb">{edit ? <form action={saveConclusions} className="grid gap-2"><Hid />
              <label><span className="mini">Conclusions</span><textarea name="conclusions" className="inp" rows={3} defaultValue={i.conclusions ?? ""} /></label>
              <label><span className="mini">Investigation report{i.report_model ? " — drafted from the sections above, to check and complete" : ""}</span><textarea name="report_text" className="inp mono" rows={i.report_text ? 16 : 4} defaultValue={i.report_text ?? ""} /></label>
              <div className="flex justify-end"><button className="btn">Save</button></div></form>
              : <><div className="mini"><b>Conclusions</b></div><T v={i.conclusions} />{i.report_text && <><div className="mini mt-2"><b>Report</b></div><p className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{i.report_text}</p></>}</>}</div></section>
        </div>

        <div>
          <section className="card mb-5"><div className="ch"><span className="eyebrow">Team</span></div>
            <div className="cb">{edit ? <form action={saveTeam} className="grid gap-2"><Hid />
              {i.team.map((t, k) => <label key={k} className="flex gap-2 items-center"><span style={{ flex: 1 }}>{t.name}{t.role ? <span className="mini"> · {t.role}</span> : null}</span><span className="mini"><input type="checkbox" name={`rm${k}`} value="1" /> remove</span></label>)}
              <select name="new_person" className="inp" defaultValue=""><option value="">+ add a person…</option>{P.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select>
              <div className="flex gap-2"><input name="new_name" className="inp" placeholder="or an external expert" style={{ marginTop: 0 }} /><input name="new_role" className="inp" placeholder="role (SME, NPFO…)" style={{ marginTop: 0, width: 140 }} /></div>
              <div className="flex justify-end"><button className="btn">Save</button></div></form>
              : <ul>{i.team.map((t, k) => <li key={k}>{t.name}{t.role ? <span className="mini"> · {t.role}</span> : null}</li>)}{!i.team.length && <li className="mini">—</li>}</ul>}</div></section>

          {edit && <section className="card mb-5"><div className="ch"><span className="eyebrow">Close</span></div>
            <div className="cb grid gap-2"><p className="mini">Closing freezes the investigation. The report gets an entry: give the reporter feedback, then close the report. Recommendations stay open in Safety › Actions until verified.</p>
              <form action={closeInvestigation}><Hid /><button className="btn primary" disabled={!i.conclusions || !i.report_text}>Close the investigation</button></form>
              {(!i.conclusions || !i.report_text) && <span className="mini">Conclusions and report needed first.</span>}
              <details><summary className="mini cursor-pointer">Cancel instead…</summary><form action={cancelInvestigation} className="flex gap-2 mt-1"><Hid /><input name="reason" className="inp" placeholder="Why" style={{ marginTop: 0 }} required /><button className="btn">Cancel it</button></form></details>
            </div></section>}

          {i.status === "closed" && mayEdit(s, i) && <section className="card mb-5"><div className="ch"><span className="eyebrow">Share the lessons learned</span></div>
            <div className="cb"><p className="mini mb-2">A de-identified safety bulletin drafted from this investigation, sent to the people concerned.</p><Link className="btn" href={`/safe/promo?inv=${i.id}${i.report_id ? `&report=${i.report_id}` : ""}`}>+ Safety bulletin</Link></div></section>}

          <section className="card"><div className="ch"><span className="eyebrow">History</span></div>
            <ul className="cb mini" style={{ display: "grid", gap: 4 }}>{((ev ?? []) as { at: string; kind: string; note: string | null }[]).map((e, k) => <li key={k}><span className="mono">{e.at.slice(0, 16).replace("T", " ")}</span> · {e.note ?? e.kind}</li>)}</ul></section>
        </div>
      </div>
    </>
  );
}
