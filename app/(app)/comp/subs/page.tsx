import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT_COLOR, ENTS4 } from "@/lib/nav";
import { CONTROL_LABEL, CONTROL_TONE, controlOf, type Subcontractor } from "@/lib/compliance-registers";
import { today } from "@/lib/authority";
import { archiveSub, linkAudit, saveSub } from "./actions";

type Sp = { s?: string };
type A = { id: string; number: string; title: string; status: string; done_on: string | null; planned_month: string; subcontractor_id: string | null; subcontractor: string | null; kind: string; entity: string };
/* COMP-06 · Subcontractors (ENR-CM-11 · ORO.GEN.205 / ORA.GEN.205): contract, access clause, Part-IS clause, control cadence; the controls are the subcontractor audits of the programme. */
export default async function Subcontractors({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin(); const desk = s.role === "cmm" || s.roles.map(basePost).includes("CMM"); const t0 = today();
  let q = db.from("subcontractors").select("*").eq("active", true).order("entity").order("code").order("name");
  if (scope) q = q.in("entity", scope);
  let aq = db.from("audits").select("id,number,title,status,done_on,planned_month,subcontractor_id,subcontractor,kind,entity").order("planned_month", { ascending: false }).limit(3000);
  if (scope) aq = aq.in("entity", scope);
  const [{ data: sd }, { data: ad }] = await Promise.all([q, aq]);
  const subs = (sd ?? []) as Subcontractor[]; const audits = (ad ?? []) as A[];
  const rows = subs.map((x) => ({ x, c: controlOf(x, audits, t0) }));
  const open = rows.find((r) => r.x.id === sp.s) ?? null;
  const ents = scope ?? ENTS4;
  const unlinked = audits.filter((a) => a.kind === "subcontractor" && !a.subcontractor_id);
  return (
    <>
      <PageHeader eyebrow="Compliance · Subcontractors" title="Subcontractors" sub="Contracted activities (ENR-CM-11): contract and its clauses (authority access, Part-IS), the control cadence, the last and next control. A control is a subcontractor audit of the programme, linked to the row."
        right={desk ? <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Subcontractor</summary>
          <form action={saveSub} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 480, zIndex: 5 }}>
            <div className="grid grid-cols-4 gap-2"><select name="entity" className="inp" defaultValue={ents[0]}>{ents.map((e) => <option key={e} value={e}>{e}</option>)}</select><input name="code" className="inp mono" placeholder="3P 15" /><input name="name" className="inp col-span-2" placeholder="Name" required /></div>
            <div className="grid grid-cols-2 gap-2"><input name="service" className="inp" placeholder="Service (FSTD C680 · e-learning…)" /><input name="approval_ref" className="inp mono" placeholder="Approval ref (EU-A0268, MT.145.xxx)" /></div>
            <div className="grid grid-cols-3 gap-2"><input name="contract_ref" className="inp" placeholder="Contract ref" /><input type="date" name="contract_from" className="inp" /><input type="date" name="contract_until" className="inp" /></div>
            <div className="grid grid-cols-3 gap-2"><select name="access_clause" className="inp" defaultValue=""><option value="">Access clause ?</option><option value="yes">Access clause: yes</option><option value="no">Access clause: no</option></select><select name="is_clause" className="inp" defaultValue=""><option value="">Part-IS clause ?</option><option value="yes">Part-IS clause: yes</option><option value="no">Part-IS clause: no</option></select><input name="every_months" type="number" className="inp" defaultValue={12} min={1} title="Control every (months)" /></div>
            <div className="flex justify-end"><button className="btn primary">Create</button></div></form></details> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Subcontractors" value={subs.length} hint={`${subs.filter((x) => x.access_clause).length} with access clause`} />
        <Metric label="Under control" value={rows.filter((r) => r.c.status === "under_control").length} tone="green" />
        <Metric label="Control due / overdue" value={`${rows.filter((r) => r.c.status === "control_due").length} · ${rows.filter((r) => r.c.status === "control_overdue").length}`} tone={rows.some((r) => r.c.status === "control_overdue") ? "red" : rows.some((r) => r.c.status === "control_due") ? "amber" : undefined} />
        <Metric label="Never controlled · contract expired" value={`${rows.filter((r) => r.c.status === "not_controlled").length} · ${rows.filter((r) => r.c.status === "contract_expired").length}`} tone={rows.some((r) => r.c.status === "contract_expired") ? "red" : undefined} />
      </div>
      <section className="card mb-4"><div className="cb" style={{ padding: 0 }}>{!rows.length ? <p className="p-4 mini">No subcontractor in your scope.</p> : (
        <table className="tbl"><thead><tr><th>Subcontractor</th><th>Service</th><th>Contract</th><th>Clauses</th><th>Last control</th><th>Next</th><th>Status</th></tr></thead><tbody>{rows.map(({ x, c }) => (
          <tr key={x.id}><td><Link href={`/comp/subs?s=${x.id}#sub`}><b>{x.name}</b></Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[x.entity] ?? "#888" }} />{x.entity}{x.code ? ` · ${x.code}` : ""}{x.approval_ref ? ` · ${x.approval_ref}` : ""}</div></td>
            <td className="mini">{x.service ?? "—"}</td><td className="mini">{x.contract_ref ?? "—"}{x.contract_until ? <div className={x.contract_until < t0 ? "late" : ""}>until {x.contract_until}</div> : null}</td>
            <td className="mini">{x.access_clause === true ? "Access ✓" : x.access_clause === false ? <span className="red">Access ✗</span> : "Access ?"} · {x.is_clause === true ? "IS ✓" : x.is_clause === false ? <span className="red">IS ✗</span> : "IS ?"}</td>
            <td className="mono mini">{c.last ?? "—"}</td><td className="mono mini">{c.next ?? (c.planned ? `${c.planned.planned_month.slice(0, 7)} planned` : "—")}</td>
            <td><span className={"pill " + (CONTROL_TONE[c.status] ?? "")}>{CONTROL_LABEL[c.status]}</span></td></tr>))}</tbody></table>)}</div></section>

      {open && <div id="sub" className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <section className="card"><div className="ch"><span><b>{open.x.name}</b> <span className="mini">{open.x.code}</span></span><span className={"pill " + (CONTROL_TONE[open.c.status] ?? "")}>{CONTROL_LABEL[open.c.status]}</span></div>
          <div className="cb">{desk ? <form action={saveSub} className="grid gap-2"><input type="hidden" name="id" value={open.x.id} />
            <div className="grid grid-cols-4 gap-2"><input name="code" className="inp mono" defaultValue={open.x.code ?? ""} /><input name="name" className="inp col-span-3" defaultValue={open.x.name} /></div>
            <div className="grid grid-cols-2 gap-2"><input name="service" className="inp" defaultValue={open.x.service ?? ""} placeholder="Service" /><input name="approval_ref" className="inp mono" defaultValue={open.x.approval_ref ?? ""} placeholder="Approval ref" /></div>
            <div className="grid grid-cols-3 gap-2"><input name="contract_ref" className="inp" defaultValue={open.x.contract_ref ?? ""} placeholder="Contract ref" /><input type="date" name="contract_from" className="inp" defaultValue={open.x.contract_from ?? ""} /><input type="date" name="contract_until" className="inp" defaultValue={open.x.contract_until ?? ""} /></div>
            <div className="grid grid-cols-3 gap-2"><select name="access_clause" className="inp" defaultValue={open.x.access_clause === true ? "yes" : open.x.access_clause === false ? "no" : ""}><option value="">Access clause ?</option><option value="yes">Access clause: yes</option><option value="no">Access clause: no</option></select><select name="is_clause" className="inp" defaultValue={open.x.is_clause === true ? "yes" : open.x.is_clause === false ? "no" : ""}><option value="">Part-IS clause ?</option><option value="yes">Part-IS clause: yes</option><option value="no">Part-IS clause: no</option></select><label><span className="mini">Control every (months)</span><input name="every_months" type="number" className="inp" defaultValue={open.x.every_months} /></label></div>
            <input name="contact" className="inp" defaultValue={open.x.contact ?? ""} placeholder="Contact (function, not personal data)" />
            <textarea name="status_note" className="inp" rows={2} defaultValue={open.x.status_note ?? ""} placeholder="Note" />
            <div className="flex justify-between"><button className="btn primary sm">Save</button></div></form> : <div className="mini">{open.x.service} · {open.x.contract_ref ?? "no contract ref"} · every {open.x.every_months} months</div>}
            {desk && <form action={archiveSub} className="mt-2"><input type="hidden" name="id" value={open.x.id} /><button className="btn sm">Remove from the register</button></form>}
          </div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Controls (subcontractor audits)</span></div><div className="cb" style={{ padding: 0 }}>
          <table className="tbl"><tbody>{audits.filter((a) => a.subcontractor_id === open.x.id).map((a) => <tr key={a.id}><td><Link href={`/comp/audits/${a.id}`}><b className="mono">{a.number}</b> {a.title}</Link></td><td className="mini">{a.done_on ?? a.planned_month.slice(0, 7)}</td><td className="mini">{a.status}</td>{desk && <td><form action={linkAudit}><input type="hidden" name="audit" value={a.id} /><button className="btn sm">Detach</button></form></td>}</tr>)}{!audits.some((a) => a.subcontractor_id === open.x.id) && <tr><td className="mini">No control linked yet{unlinked.length ? " — attach one below" : ""}.</td></tr>}</tbody></table>
          {desk && unlinked.length > 0 && <form action={linkAudit} className="cb flex gap-2" style={{ borderTop: "1px solid var(--line)" }}><input type="hidden" name="sub" value={open.x.id} /><select name="audit" className="inp" style={{ flex: 1 }}>{unlinked.map((a) => <option key={a.id} value={a.id}>{a.number} — {a.title}{a.subcontractor ? ` (${a.subcontractor})` : ""}</option>)}</select><button className="btn sm">Attach this audit</button></form>}
          <p className="cb mini">Plan the next control from Compliance › Audit programme (module of kind “Subcontractor audit”); it appears here once linked.</p>
        </div></section>
      </div>}
    </>
  );
}
