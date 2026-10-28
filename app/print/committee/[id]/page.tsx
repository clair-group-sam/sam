import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import PrintAuto from "@/components/PrintAuto";
import { isJoint, kindName, packFor, type Committee } from "@/lib/committees";

export const dynamic = "force-dynamic";
const CSS = `
@page { size: A4; margin: 16mm 14mm 16mm 14mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9px Inter, Arial; color: #6b7a8c } }
body{background:#fff}
.mn{font:11px/1.5 Inter, Arial, sans-serif;color:#0d2a3f}
.mn h1{font-size:18px;margin:0 0 2px}.mn h2{font-size:12.5px;margin:14px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #0d2a3f;text-transform:uppercase;letter-spacing:.06em}
.mn .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.mn .ent{font-weight:700;font-size:12px}
.mn table{width:100%;border-collapse:collapse;margin:4px 0}.mn th,.mn td{border:1px solid #c9d3dc;padding:4px 6px;vertical-align:top;text-align:left}.mn th{background:#f1f5f8;font-weight:700}
.mn .kv td:first-child{width:28%;color:#44546a;background:#f8fafb}
.mn .it{page-break-inside:avoid;margin:8px 0}.mn .it b{font-size:11.5px}.mn ul{margin:2px 0 2px 14px;padding:0}.mn .mini{font-size:9.5px;color:#6b7a8c}
.mn .pre{white-space:pre-wrap}.mn .sig td{height:44px}
`;

/** Printable minutes (MSM §4.5 / §4.6): attendees, items with the figures presented, notes and decisions, actions assigned. Kept 5 years (MSM §1.6.5). */
export default async function PrintCommittee({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("committees").select("*").eq("id", id).maybeSingle();
  const c = data as Committee | null; if (!c || !(c.entities?.length ? c.entities : [c.entity]).some((e) => s.entities.includes(e))) notFound();
  const { data: acts } = await db.from("safety_actions").select("number,title,owner_role,due,status").eq("committee_id", c.id).order("created_at");
  const A = (acts ?? []) as { number: string; title: string; owner_role: string | null; due: string | null; status: string }[];
  const chair = c.attendees.find((a) => /\bAM\b/.test(a.role ?? ""));
  return (
    <div className="mn" style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
      <style>{CSS}</style>
      <PrintAuto fileName={`${c.entity} ${c.number} minutes`} auto={sp.auto === "1"} />
      <div className="top"><div><div className="ent">{(c.entities?.length ? c.entities : [c.entity]).map((e) => ENT[e]?.name ?? e).join(" · ")}</div><h1>{c.number} — {c.title}</h1><div className="mini">{isJoint(c) ? "Joint meeting · " : ""}{kindName(c.entity, c.kind)} · Minutes{c.status !== "closed" ? " — DRAFT, not issued" : ` issued ${c.closed_at?.slice(0, 10)}`}</div></div><div className="mini" style={{ textAlign: "right" }}>MSM §{c.kind === "sag" ? "4.6" : c.entity === "ASF" ? "4.2" : "4.5"}<br />Record kept 5 years (MSM §1.6.5)</div></div>
      <table className="kv"><tbody>
        <tr><td>Date</td><td>{c.planned_on}{c.starts_at ? ` · ${c.starts_at.slice(11, 16)}${c.ends_at ? `–${c.ends_at.slice(11, 16)}` : ""} UTC` : ""}</td></tr>
        <tr><td>Location</td><td>{c.location ?? "—"}</td></tr>
        {c.topic && <tr><td>Topic</td><td>{c.topic}</td></tr>}
        <tr><td>{c.kind === "sag" ? "Facilitator" : "Chair"}</td><td>{c.kind === "sag" ? c.attendees.find((a) => /SM/.test(a.role ?? ""))?.name ?? "—" : chair?.name ?? "Accountable Manager"}</td></tr>
      </tbody></table>
      <h2>Attendees</h2>
      <table><thead><tr><th>Name</th><th>Role</th><th style={{ width: 90 }}>Attendance</th></tr></thead><tbody>{c.attendees.map((a, i) => <tr key={i}><td>{a.name}</td><td>{a.role}</td><td>{a.present ? "Present" : a.present === false ? "Apologies" : "—"}</td></tr>)}</tbody></table>
      {c.minutes && <><h2>Summary</h2><div className="pre">{c.minutes}</div></>}
      <h2>Agenda, discussion and decisions</h2>
      {c.agenda.map((x, i) => { const f = packFor(x.key, c.pack); return (
        <div className="it" key={x.key}><b>{i + 1}. {x.title}</b>{x.ref && <span className="mini"> · {x.ref}</span>}
          {f.length > 0 && <ul>{f.map((l, j) => <li key={j} className={j ? "mini" : ""}>{l}</li>)}</ul>}
          {x.notes && <div className="pre">{x.notes}</div>}
          {x.decision && <div><b>Decision:</b> {x.decision}</div>}
          {!x.notes && !x.decision && !f.length && <div className="mini">No discussion recorded.</div>}
        </div>); })}
      <h2>Actions assigned</h2>
      <table><thead><tr><th style={{ width: 120 }}>Number</th><th>Action</th><th style={{ width: 70 }}>Owner</th><th style={{ width: 80 }}>Due</th></tr></thead><tbody>{A.map((a) => <tr key={a.number}><td>{a.number}</td><td>{a.title}</td><td>{a.owner_role ?? ""}</td><td>{a.due ?? ""}</td></tr>)}{!A.length && <tr><td colSpan={4} className="mini">No action.</td></tr>}</tbody></table>
      <h2>Sign-off</h2>
      <table className="sig"><tbody><tr><td style={{ width: "50%" }}><span className="mini">{c.kind === "sag" ? "Safety Manager" : "Accountable Manager (chair)"}</span></td><td><span className="mini">Safety Manager (organiser)</span></td></tr></tbody></table>
    </div>
  );
}
