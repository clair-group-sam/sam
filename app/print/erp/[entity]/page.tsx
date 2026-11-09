import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import PrintAuto from "@/components/PrintAuto";
import { INFO, after } from "@/lib/erp";

export const dynamic = "force-dynamic";
const CSS = `
@page { size: A4; margin: 14mm 12mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9px Inter, Arial; color: #6b7a8c } }
body{background:#fff}
.mn{font:10.5px/1.45 Inter, Arial, sans-serif;color:#0d2a3f}
.mn h1{font-size:18px;margin:0 0 2px}.mn h2{font-size:12.5px;margin:16px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #0d2a3f}
.mn h3{font-size:11.5px;margin:10px 0 3px}
.mn table{width:100%;border-collapse:collapse;margin:4px 0}.mn th,.mn td{border:1px solid #c9d3dc;padding:3px 6px;vertical-align:top;text-align:left}.mn th{background:#f1f5f8}
.mn .mini{font-size:9px;color:#6b7a8c}.mn .cl{break-inside:avoid}.mn .bx td:first-child{width:16px}.mn .bx td:last-child{width:70px}
.mn .sheet td{height:20px}.mn .sheet td:first-child{width:34%;color:#44546a;background:#f8fafb}
.mn .pb{break-before:page}
`;
type Ct = { crisis_role: string; kind: string; post: string | null; name: string | null; deputy: string | null; organisation: string | null; phone: string | null; email: string | null; available: string | null; note: string | null };

/** ERP binder: the paper copy the MSM requires (crisis room, cupboard), printed from S.A.M. so that it is always the current one,
 *  and usable when S.A.M. or the network is down (Part-IS finding: everything is cloud). */
export default async function ErpBinder({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { entity } = await params; const sp = await searchParams;
  const s = await getSession(); if (!s) redirect("/login");
  if (!ENT[entity] || (!s.group && !s.entities.includes(entity))) notFound();
  const db = supabaseAdmin();
  const [{ data: pl }, { data: ct }, { data: ms }, { data: cl }, { data: np }] = await Promise.all([
    db.from("erp_plans").select("*").eq("entity", entity).eq("active", true).order("code"),
    db.from("erp_contacts").select("*").eq("entity", entity).eq("active", true).order("ord"),
    db.from("erp_milestones").select("*").eq("entity", entity).eq("active", true).order("minutes").order("ord"),
    db.from("erp_checklists").select("*").eq("entity", entity).eq("active", true).order("ord"),
    db.from("np_posts").select("code,holder_name,deputy_name").eq("entity", entity),
  ]);
  const plan = ((pl ?? []) as Record<string, string | null>[])[0];
  const H = new Map(((np ?? []) as { code: string; holder_name: string | null; deputy_name: string | null }[]).map((x) => [x.code.toUpperCase(), x]));
  const C = ((ct ?? []) as Ct[]).map((c) => { const h = c.post ? H.get(c.post.toUpperCase()) : undefined; return h?.holder_name ? { ...c, name: h.holder_name, deputy: h.deputy_name ?? c.deputy } : c; });
  const M = (ms ?? []) as { label: string; minutes: number; owner_role: string | null; applies: string; source: string | null }[];
  const L = (cl ?? []) as { code: string | null; title: string; phase: string; owner_role: string | null; applies: string; items: string; source: string | null }[];
  const printed = new Date().toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";
  const name = ENT[entity]?.name ?? entity;
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity, object_type: "erp_binder", object_id: entity, action: "printed", after: null });
  return (
    <div className="mn" style={{ maxWidth: 820, margin: "0 auto", padding: 20 }}>
      <style>{CSS}</style>
      <PrintAuto fileName={`ERP binder ${entity} ${new Date().toISOString().slice(0, 10)}`} auto={sp.auto === "1"} />
      <div><b>{name}</b> <span className="mini">Printed from S.A.M. on {printed} by {s.name}. Check this date: an older copy may hold wrong numbers.</span></div>
      <h1>Emergency response plan, binder</h1>
      {plan && <div className="mini">{[plan.manual_ref, plan.location, plan.deputy_rule].filter(Boolean).join(". ")}</div>}
      <h2>Who to call</h2>
      <table><thead><tr><th>Role</th><th>Name, deputy</th><th>Phone</th><th>E-mail</th></tr></thead><tbody>
        {C.map((c, i) => <tr key={i}><td><b>{c.crisis_role}</b>{c.post ? ` (${c.post})` : ""}<div className="mini">{c.organisation ?? ""}</div></td><td>{c.name ?? ""}{c.deputy ? <div className="mini">Deputy: {c.deputy}</div> : null}</td><td>{c.phone ?? "________________"}<div className="mini">{c.available ?? ""}</div></td><td>{c.email ?? ""}</td></tr>)}
      </tbody></table>
      {plan?.cell_safety && <p className="mini">Unit for a safety emergency: {plan.cell_safety}. For a security or cyber emergency: {plan.cell_security ?? "as decided by the AM"}.</p>}
      <h2>Response times</h2>
      <table className="bx"><tbody>{M.map((m, i) => <tr key={i}><td>☐</td><td><b>{m.label}</b><div className="mini">{[m.owner_role, m.applies !== "all" ? m.applies : null, m.source].filter(Boolean).join(", ")}</div></td><td>{after(m.minutes)}</td></tr>)}</tbody></table>
      <h2 className="pb">Primary information sheet</h2>
      <table className="sheet"><tbody>
        <tr><td>Date and time of the call (UTC)</td><td></td></tr>
        {INFO.map(([k, l]) => <tr key={k}><td>{l}</td><td></td></tr>)}
        <tr><td>Details of the event</td><td style={{ height: 80 }}></td></tr>
      </tbody></table>
      <p className="mini">Send it to the ERP mailbox once filled, and enter it in S.A.M. (Activation mode) as soon as it is reachable.</p>
      <h2 className="pb">Checklists</h2>
      {L.map((c, i) => <div key={i} className="cl"><h3>{c.code ? `${c.code}, ` : ""}{c.title} <span className="mini">{[c.owner_role, c.phase, c.applies !== "all" ? c.applies : null].filter(Boolean).join(", ")}</span></h3>
        <table className="bx"><tbody>{c.items.split("\n").map((x) => x.trim()).filter(Boolean).map((x, j) => <tr key={j}><td>☐</td><td>{x}</td><td className="mini">time, initials</td></tr>)}</tbody></table>
        {c.source && <div className="mini">{c.source}</div>}</div>)}
      <h2 className="pb">Crisis log</h2>
      <table><thead><tr><th style={{ width: 70 }}>Time UTC</th><th>Fact, decision, call</th><th style={{ width: 70 }}>Initials</th></tr></thead><tbody>{Array.from({ length: 28 }, (_, i) => <tr key={i}><td style={{ height: 20 }}></td><td></td><td></td></tr>)}</tbody></table>
    </div>
  );
}
