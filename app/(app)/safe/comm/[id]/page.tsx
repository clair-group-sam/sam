import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_STATUS } from "@/lib/actions-shared";
import { STATUS, entitiesLabel, isJoint, kindName, mayRun, packFor, type Committee } from "@/lib/committees";
import { ackMinutes, cancelCommittee, draftMinutes, issueMinutes, markHeld, preparePack, saveAttendees, saveItem, saveMinutes, updateCommittee } from "../actions";

const hm = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

/** One committee meeting: details, attendance, agenda with the figures presented, notes and decisions per item, actions, minutes. */
export default async function CommitteePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params; const db = supabaseAdmin();
  const { data } = await db.from("committees").select("*").eq("id", id).maybeSingle();
  const c = data as Committee | null; if (!c || !(c.entities?.length ? c.entities : [c.entity]).some((e) => s.entities.includes(e))) notFound();
  const [{ data: acts }, { data: ev }, { data: myTask }, { data: sags }, { data: parent }] = await Promise.all([
    db.from("safety_actions").select("id,number,title,status,due,owner_role,owner_person").eq("committee_id", c.id).order("created_at"),
    db.from("committee_events").select("at,kind,note").eq("committee_id", c.id).order("at", { ascending: false }).limit(30),
    s.person ? db.from("tasks").select("id").eq("kind", "committee_minutes").eq("ref_id", c.id).eq("owner_person", s.person.id).eq("status", "open").limit(1) : Promise.resolve({ data: [] }),
    c.kind === "srb" ? db.from("committees").select("id,number,title,status").eq("parent_id", c.id) : Promise.resolve({ data: [] }),
    c.parent_id ? db.from("committees").select("id,number").eq("id", c.parent_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const edit = mayRun(s) && c.status !== "closed" && c.status !== "cancelled";
  const A = (acts ?? []) as { id: string; number: string; title: string; status: string; due: string | null; owner_role: string | null }[];
  const present = c.attendees.filter((a) => a.present).length;
  const step = c.status === "planned" ? 1 : c.status === "held" ? 2 : 3;
  return (
    <>
      <PageHeader eyebrow={`Safety · Committees · ${entitiesLabel(c)}`} title={`${c.number} — ${c.title}`} sub={`${isJoint(c) ? `Joint meeting ${entitiesLabel(c)} · ` : ""}${kindName(c.entity, c.kind)} · ${c.planned_on ?? "date to set"}${c.starts_at ? ` ${hm(c.starts_at)}${c.ends_at ? `–${hm(c.ends_at)}` : ""} UTC` : ""}${c.location ? ` · ${c.location}` : ""}`}
        tag={<span className="flex gap-2 flex-wrap"><span className={"pill " + (STATUS[c.status]?.[1] ?? "")}>{STATUS[c.status]?.[0]}</span>{c.source !== "sam" && <span className="pill">from {c.source === "centrik" ? "Centrik" : "SharePoint"}{c.source_ref ? ` ${c.source_ref}` : ""}</span>}{(parent as { id: string; number: string } | null) && <Link className="pill" href={`/safe/comm/${(parent as { id: string }).id}`}>reports to {(parent as { number: string }).number}</Link>}</span>}
        right={<><Link href="/safe/comm" className="btn">← Committees</Link>{["held", "closed"].includes(c.status) && <a className="btn" href={`/print/committee/${c.id}`} target="_blank" rel="noreferrer">Minutes PDF</a>}</>} />

      {(myTask ?? []).length > 0 && <section className="card mb-4"><div className="cb flex items-center gap-3"><span>The minutes of this meeting were issued to you.</span><form action={ackMinutes} className="ml-auto"><input type="hidden" name="id" value={c.id} /><button className="btn primary">I have read the minutes</button></form></div></section>}

      {mayRun(s) && c.status !== "cancelled" && <div className="steps mb-4">
        <span className={step >= 1 ? "on" : ""}>1 · Plan &amp; prepare</span><span className={step >= 2 ? "on" : ""}>2 · Hold — attendance, notes, decisions, actions</span><span className={step >= 3 ? "on" : ""}>3 · Minutes issued</span>
      </div>}

      <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
        <div>
          <section className="card mb-5">
            <div className="ch"><span className="eyebrow">Agenda</span>{c.pack_at && <span className="mini">figures as at {c.pack_at.slice(0, 16).replace("T", " ")} UTC{c.pack?.since ? ` — since ${c.pack.since.slice(0, 10)}` : ""}</span>}
              {edit && <form action={preparePack} className="ml-auto"><input type="hidden" name="id" value={c.id} /><button className="btn">{c.pack ? "Refresh the figures" : "Prepare the figures"}</button></form>}</div>
            {c.agenda.map((x, i) => { const f = packFor(x.key, c.pack); return (
              <div key={x.key} className="cb agitem">
                <div className="flex gap-2 items-baseline"><b>{i + 1}. {x.title}</b>{x.ref && <span className="mini">{x.ref}</span>}</div>
                {f.length > 0 && <ul className="pack">{f.slice(0, 12).map((l, j) => <li key={j} className={j === 0 ? "" : "mini"}>{l}</li>)}{f.length > 12 && <li className="mini">… {f.length - 12} more in the PDF</li>}</ul>}
                {edit ? <form action={saveItem} className="grid gap-1 mt-2"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="key" value={x.key} />
                  <textarea name="notes" className="inp" rows={x.notes ? 3 : 1} defaultValue={x.notes ?? ""} placeholder="What was presented and discussed" />
                  <div className="flex gap-2"><input name="decision" className="inp" defaultValue={x.decision ?? ""} placeholder="Decision (if any)" style={{ marginTop: 0 }} /><button className="btn">Save</button><button className="btn" name="remove" value="1" title="Remove this item">✕</button></div></form>
                  : <>{x.notes && <p className="mt-1" style={{ whiteSpace: "pre-wrap" }}>{x.notes}</p>}{x.decision && <p className="mt-1"><b>Decision:</b> {x.decision}</p>}</>}
              </div>); })}
            {edit && <form action={saveItem} className="cb flex gap-2"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="key" value="__new" /><input name="title" className="inp" placeholder="+ Add an agenda item" style={{ marginTop: 0 }} /><button className="btn">Add</button></form>}
          </section>

          <section className="card mb-5" id="actions">
            <div className="ch"><span className="eyebrow">Actions decided</span><span className="mini">{A.length} — followed in Safety › Actions (owner, due date, evidence, verification)</span></div>
            <table className="tbl"><tbody>{A.map((a) => <tr key={a.id}><td className="mono" style={{ width: 150 }}><Link className="underline" href={`/safe/actions/${a.id}`}>{a.number}</Link></td><td>{a.title}</td><td className="mono" style={{ width: 80 }}>{a.owner_role ?? ""}</td><td className="mono" style={{ width: 100 }}>{a.due ?? ""}</td><td style={{ width: 150 }}><span className={"pill " + (ACTION_STATUS[a.status]?.[1] ?? "")}>{ACTION_STATUS[a.status]?.[0]}</span></td></tr>)}
              {!A.length && <tr><td className="p-4 mini">No action yet.</td></tr>}</tbody></table>
            {edit && <div className="cb"><NewActionForm entity={c.entity} source="committee" committee_id={c.id} stay compact /></div>}
          </section>

          {c.status !== "planned" && <section className="card mb-5">
            <div className="ch"><span className="eyebrow">Minutes</span>{c.minutes_model && <span className="mini">draft prepared by SAM from the notes — edited by the safety desk</span>}
              {edit && <form action={draftMinutes} className="ml-auto"><input type="hidden" name="id" value={c.id} /><button className="btn">{c.minutes ? "Draft again" : "Draft the minutes"}</button></form>}</div>
            <div className="cb">{edit ? <form action={saveMinutes} className="grid gap-2"><input type="hidden" name="id" value={c.id} /><textarea name="minutes" className="inp" rows={c.minutes ? 16 : 4} defaultValue={c.minutes ?? ""} placeholder="Summary of the minutes — drafted from the item notes, decisions and actions" /><div className="flex justify-end"><button className="btn">Keep the text</button></div></form>
              : c.minutes ? <p style={{ whiteSpace: "pre-wrap" }}>{c.minutes}</p> : <p className="mini">The minutes are the item notes and decisions above.</p>}</div>
            {edit && c.status === "held" && <div className="cb flex items-center gap-3 border-t"><span className="mini">Issuing freezes the minutes and sends a « read the minutes » task to the AM and to every attendee with a S.A.M. account.</span><form action={issueMinutes} className="ml-auto"><input type="hidden" name="id" value={c.id} /><button className="btn primary">Issue the minutes</button></form></div>}
          </section>}
        </div>

        <div>
          <section className="card mb-5">
            <div className="ch"><span className="eyebrow">Attendees</span><span className="mini">{present ? `${present} present` : `${c.attendees.length} invited`}</span></div>
            <form action={saveAttendees} className="cb grid gap-1">
              <input type="hidden" name="id" value={c.id} />
              {c.attendees.map((a, i) => (
                <div key={i} className="flex items-center gap-2 att">
                  <span className="flex-1"><b>{a.name}</b> <span className="mini">{a.role}</span></span>
                  {edit ? <><select name={`p${i}`} defaultValue={a.present === true ? "1" : a.present === false ? "0" : ""} className="inp" style={{ width: 110, marginTop: 0 }}><option value="">invited</option><option value="1">present</option><option value="0">apologies</option></select>
                    <label className="mini"><input type="checkbox" name={`rm${i}`} value="1" /> ✕</label></>
                    : <span className={"pill " + (a.present ? "green" : a.present === false ? "" : "blue")}>{a.present ? "present" : a.present === false ? "apologies" : "invited"}</span>}
                </div>))}
              {edit && <><div className="flex gap-1 mt-2"><input name="new_name" className="inp" placeholder="Add: name" style={{ marginTop: 0 }} /><input name="new_role" className="inp" placeholder="role" style={{ marginTop: 0, width: 90 }} /></div><button className="btn mt-1">Save attendance</button></>}
            </form>
          </section>

          {edit && <section className="card mb-5">
            <div className="ch"><span className="eyebrow">Details</span></div>
            <form action={updateCommittee} className="cb grid gap-2"><input type="hidden" name="id" value={c.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={c.title} /></label>
              {c.kind === "sag" && <label><span className="mini">Topic</span><input name="topic" className="inp" defaultValue={c.topic ?? ""} /></label>}
              <div className="grid grid-cols-3 gap-2"><label><span className="mini">Date</span><input type="date" name="planned_on" className="inp" defaultValue={c.planned_on ?? ""} /></label><label><span className="mini">Start UTC</span><input type="time" name="time" className="inp" defaultValue={hm(c.starts_at)} /></label><label><span className="mini">End UTC</span><input type="time" name="end_time" className="inp" defaultValue={hm(c.ends_at)} /></label></div>
              <label><span className="mini">Location</span><input name="location" className="inp" defaultValue={c.location ?? ""} /></label>
              <button className="btn">Save</button>
            </form>
            {c.status === "planned" && <form action={markHeld} className="cb border-t flex items-center gap-2"><input type="hidden" name="id" value={c.id} /><span className="mini flex-1">At the end of the meeting</span><button className="btn primary">Mark as held</button></form>}
            <form action={cancelCommittee} className="cb border-t flex gap-2"><input type="hidden" name="id" value={c.id} /><input name="reason" className="inp" placeholder="reason" style={{ marginTop: 0 }} /><button className="btn">Cancel the meeting</button></form>
          </section>}

          {c.kind === "srb" && ((sags ?? []) as { id: string; number: string; title: string; status: string }[]).length > 0 && <section className="card mb-5"><div className="ch"><span className="eyebrow">Action groups reporting here</span></div><div className="cb">{((sags ?? []) as { id: string; number: string; title: string }[]).map((g) => <div key={g.id}><Link className="underline mono" href={`/safe/comm/${g.id}`}>{g.number}</Link> {g.title}</div>)}</div></section>}

          <section className="card"><div className="ch"><span className="eyebrow">Journal</span></div><div className="cb">{((ev ?? []) as { at: string; kind: string; note: string | null }[]).map((e, i) => <div key={i} className="mini"><span className="mono">{e.at.slice(0, 16).replace("T", " ")}</span> {e.note}</div>)}</div></section>
        </div>
      </div>
    </>
  );
}
