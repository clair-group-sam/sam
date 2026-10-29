import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import PrintAuto from "@/components/PrintAuto";
import { FACTOR_CAT, INV_LEVEL, INV_STATUS, mayRead, type Investigation } from "@/lib/investigations";

export const dynamic = "force-dynamic";
const CSS = `
@page { size: A4; margin: 16mm 14mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9px Inter, Arial; color: #6b7a8c } }
body{background:#fff}
.mn{font:11px/1.5 Inter, Arial, sans-serif;color:#0d2a3f}
.mn h1{font-size:18px;margin:0 0 2px}.mn h2{font-size:12.5px;margin:14px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #0d2a3f;text-transform:uppercase;letter-spacing:.06em}
.mn table{width:100%;border-collapse:collapse;margin:4px 0}.mn th,.mn td{border:1px solid #c9d3dc;padding:4px 6px;vertical-align:top;text-align:left}.mn th{background:#f1f5f8}
.mn .kv td:first-child{width:28%;color:#44546a;background:#f8fafb}.mn .pre{white-space:pre-wrap}.mn .mini{font-size:9.5px;color:#6b7a8c}.mn .sig td{height:44px}
`;

/** Printable internal investigation report (confidential). */
export default async function PrintInvestigation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("investigations").select("*").eq("id", id).maybeSingle();
  const i = data as Investigation | null; if (!i || !s.entities.includes(i.entity) || !mayRead(s, i)) notFound();
  const { data: acts } = await db.from("safety_actions").select("number,title,owner_role,due,status").eq("investigation_id", i.id).order("created_at");
  const A = (acts ?? []) as { number: string; title: string; owner_role: string | null; due: string | null }[];
  return (
    <div className="mn" style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
      <style>{CSS}</style>
      <PrintAuto fileName={`${i.number} investigation report`} auto={sp.auto === "1"} />
      <div><b>{ENT[i.entity]?.name ?? i.entity}</b> · <span className="mini">CONFIDENTIAL — internal safety investigation (just culture: not to apportion blame or liability)</span></div>
      <h1>{i.number} — {i.title}</h1>
      <div className="mini">{INV_LEVEL[i.level]?.[0]} · {INV_STATUS[i.status]?.[0]}{i.closed_at ? ` ${i.closed_at.slice(0, 10)}` : " — DRAFT"}</div>
      <table className="kv"><tbody>
        <tr><td>Report</td><td>{i.report_id ?? "—"}</td></tr><tr><td>Lead</td><td>{i.lead_name ?? "—"}</td></tr>
        <tr><td>Team</td><td>{i.team.map((t) => `${t.name}${t.role ? ` (${t.role})` : ""}`).join(", ") || "—"}</td></tr>
        <tr><td>Opened · due</td><td>{i.created_at.slice(0, 10)} · {i.due ?? "—"}</td></tr>
      </tbody></table>
      {i.report_text ? <><h2>Investigation report</h2><div className="pre">{i.report_text}</div></> : <>
        <h2>Terms of reference</h2><div className="pre">{i.terms ?? "—"}</div>
        <h2>Factual information</h2>{i.timeline.length > 0 && <table><tbody>{i.timeline.map((t, k) => <tr key={k}><td style={{ width: 130 }}>{t.at.replace("T", " ")}</td><td>{t.text}</td></tr>)}</tbody></table>}<div className="pre">{i.facts ?? "—"}</div>
        <h2>Analysis</h2><ul>{i.factors.map((f, k) => <li key={k}><b>{FACTOR_CAT[f.cat]?.split(" (")[0] ?? f.cat}:</b> {f.text}</li>)}</ul>
        <h2>Causes</h2><div className="pre">{i.causes ?? "—"}</div><h2>Conclusions</h2><div className="pre">{i.conclusions ?? "—"}</div></>}
      <h2>Safety recommendations</h2>
      <table><thead><tr><th style={{ width: 130 }}>Action</th><th>Recommendation</th><th style={{ width: 70 }}>Owner</th><th style={{ width: 80 }}>Due</th></tr></thead><tbody>{A.map((a) => <tr key={a.number}><td>{a.number}</td><td>{a.title}</td><td>{a.owner_role ?? ""}</td><td>{a.due ?? ""}</td></tr>)}{!A.length && <tr><td colSpan={4} className="mini">None.</td></tr>}</tbody></table>
      <h2>Sign-off</h2>
      <table className="sig"><tbody><tr><td style={{ width: "50%" }}><span className="mini">Investigation lead</span></td><td><span className="mini">Safety Manager</span></td></tr></tbody></table>
    </div>
  );
}
