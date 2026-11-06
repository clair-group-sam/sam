import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { AuditGrid } from "@/components/AuditGrid";
import { ENT, ENT_COLOR } from "@/lib/nav";
import { addMonths, coverage, cycleMonths, elapsedPct, KIND_LABEL, loadProgramme, monthLong, PROG_REF, PROG_STATUS, STATUS_LABEL, type AuditEvent } from "@/lib/audit-programme";
import { today } from "@/lib/authority";
import { addAudit, approveProgramme, archiveModule, cancelAudit, closeProgramme, planNextCycle, replanAudit, saveAuditPlan, saveModule, saveProgramme } from "../actions";
import { createChecklist } from "../cl/actions";

/* AUD-01 · one audit programme: the grid, the audits (move with a reason, cancel with a reason, dates and auditor), the modules and the requirements they cover, the coverage, the history. */
export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const x = await loadProgramme(db, id);
  if (!x) notFound();
  const { p, mods: rawMods, audits } = x;
  if (!s.group && !s.entities.includes(p.entity)) notFound();
  const desk = s.role === "cmm";
  const t0 = today();
  // a module's requirements = the rule codes of its checklist (when it has one) + those typed on the module
  type M = typeof rawMods[number] & { checklist_id?: string | null };
  const clIds = (rawMods as M[]).map((m) => m.checklist_id).filter(Boolean) as string[];
  const { data: clItems } = clIds.length ? await db.from("checklist_items").select("checklist_id,code").in("checklist_id", clIds).eq("active", true).limit(50000) : { data: [] };
  const { data: clRows } = clIds.length ? await db.from("checklists").select("id,code,title").in("id", clIds) : { data: [] };
  const clOf = (id: string | null | undefined) => ((clRows ?? []) as { id: string; code: string; title: string }[]).find((c) => c.id === id);
  const codesOf = (id: string | null | undefined) => [...new Set(((clItems ?? []) as { checklist_id: string; code: string }[]).filter((i) => i.checklist_id === id).map((i) => i.code))];
  const mods = (rawMods as M[]).map((m) => ({ ...m, requirements: [...new Set([...m.requirements, ...codesOf(m.checklist_id)])] }));
  const c = coverage(p, mods, audits, t0);
  const ms = cycleMonths(p);
  const { data: fA } = audits.length ? await db.from("findings").select("id,audit_id,level,due,closed_at").in("audit_id", audits.map((a) => a.id)) : { data: [] };
  const findingsAll = (fA ?? []) as { id: string; audit_id: string | null; level: string; due: string | null; closed_at: string | null }[];
  const [{ data: ppl }, { data: ev }, { data: nx }] = await Promise.all([
    db.from("people").select("id,display_name").limit(500),
    audits.length ? db.from("audit_events").select("*").in("audit_id", audits.map((a) => a.id)).order("at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
    db.from("audit_programmes").select("id,title").eq("previous_id", p.id).limit(1),
  ]);
  const people = (ppl ?? []) as { id: string; display_name: string }[];
  const name = (pid: string | null) => people.find((q) => q.id === pid)?.display_name ?? "—";
  const events = (ev ?? []) as AuditEvent[];
  const next = ((nx ?? []) as { id: string; title: string }[])[0];
  const modCode = (mid: string | null) => mods.find((m) => m.id === mid)?.code ?? "—";
  const active = mods.filter((m) => m.active);
  const MonthSelect = ({ name: n, def }: { name: string; def?: string }) => <select name={n} className="inp" defaultValue={def ?? ms[0]}>{ms.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}</select>;
  return (
    <>
      <PageHeader eyebrow={`Compliance, Audit programme, ${p.entity}`} title={p.title} sub={`${ENT[p.entity]?.name ?? p.entity}, ${p.reference ?? PROG_REF[p.entity]?.reference ?? ""}, ${PROG_REF[p.entity]?.msm ?? ""}, ${p.cycle_months}-month cycle ${p.starts_on} → ${p.ends_on}`}
        tag={<span className={"pill " + (p.status === "approved" ? "green" : p.status === "draft" ? "amber" : "")}>{PROG_STATUS[p.status]}{p.approved_at ? `, ${p.approved_at.slice(0, 10)}, ${name(p.approved_by)}` : ""}</span>}
        right={<div className="flex gap-2"><Link className="btn" href="/comp/prog">All programmes</Link>{desk && p.status === "draft" && <form action={approveProgramme}><input type="hidden" name="id" value={p.id} /><button className="btn primary">Approve the programme</button></form>}
          {desk && p.status !== "closed" && !next && <form action={planNextCycle}><input type="hidden" name="id" value={p.id} /><button className="btn">Plan next cycle</button></form>}
          {next && <Link className="btn" href={`/comp/prog/${next.id}`}>Next cycle ›</Link>}
          {desk && p.status === "approved" && p.ends_on < t0 && <form action={closeProgramme}><input type="hidden" name="id" value={p.id} /><button className="btn">Close the cycle</button></form>}</div>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Cycle elapsed" value={`${elapsedPct(p, t0)} %`} hint={`${c.done} done / ${c.done + c.planned} audits`} />
        <Metric label="Planned" value={c.planned} hint={c.late ? `${c.late} with the month passed` : "remaining"} tone={c.late ? "red" : undefined} />
        <Metric label="Replanned" value={c.replanned} hint={c.cancelled ? `${c.cancelled} cancelled` : "reason traced"} tone={c.replanned ? "amber" : undefined} />
        <Metric label="Coverage gaps" value={c.modulesWithout.length + c.gaps.length} hint={`${c.modulesWithout.length} module(s), ${c.gaps.length} requirement(s)`} tone={c.modulesWithout.length + c.gaps.length ? "amber" : "green"} />
      </div>

      <section className="card mb-4"><div className="ch"><span className="eyebrow">The cycle month by month</span></div><div className="cb"><AuditGrid p={p} mods={mods} audits={audits} t0={t0} /></div></section>

      <section className="card mb-4"><div className="ch"><span className="eyebrow">Audits, {audits.length}</span>
        {desk && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn sm">+ Audit</summary>
          <form action={addAudit} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 30, width: 480, zIndex: 5 }}>
            <input type="hidden" name="programme" value={p.id} />
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Module</span><select name="module" className="inp" defaultValue={active[0]?.id ?? ""}><option value="">—</option>{active.map((m) => <option key={m.id} value={m.id}>{m.code}, {m.title}</option>)}</select></label><label><span className="mini">Month</span><MonthSelect name="month" /></label></div>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Type (blank = the module's)</span><select name="kind" className="inp" defaultValue=""><option value="">—</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label><span className="mini">Date (if known)</span><input type="date" name="planned_on" className="inp" /></label></div>
            <label><span className="mini">Title (blank = the module)</span><input name="title" className="inp" /></label>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Lead auditor</span><select name="lead_auditor" className="inp" defaultValue=""><option value="">—</option>{people.map((q) => <option key={q.id} value={q.id}>{q.display_name}</option>)}</select></label><label><span className="mini">or external auditor / authority</span><input name="external_auditor" className="inp" placeholder="TTF, TM-CAD inspector…" /></label></div>
            <label><span className="mini">Subcontractor (subcontractor audits)</span><input name="subcontractor" className="inp" /></label>
            <label><span className="mini">Scope</span><textarea name="scope" className="inp" rows={2} /></label>
            <div className="flex justify-end"><button className="btn primary" type="submit">Plan</button></div></form></details>}</div>
        <div className="cb" style={{ padding: 0 }}>{!audits.length ? <p className="p-4 mini">No audit planned yet.</p> : (
          <table className="tbl"><thead><tr><th>Audit</th><th>Module</th><th>Month</th><th>Auditor</th><th>Status</th><th></th></tr></thead><tbody>{audits.map((a) => {
            const late = a.status === "planned" && addMonths(a.planned_month, 1) <= t0;
            const mayMove = desk || a.lead_auditor === s.person?.id;
            return (
              <tr key={a.id} id={a.number}>
                <td><Link href={`/comp/audits/${a.id}`}><b className="mono">{a.number}</b> {a.title}</Link><div className="mini">{KIND_LABEL[a.kind]}{a.subcontractor ? `, ${a.subcontractor}` : ""}{a.authority ? `, ${a.authority}` : ""}{a.scope ? `, ${a.scope}` : ""}</div></td>
                <td className="mono">{modCode(a.module_id)}</td>
                <td className={late ? "late" : ""}>{monthLong(a.planned_month)}{a.planned_on && <div className="mini mono">{a.planned_on}{a.planned_end ? ` → ${a.planned_end}` : ""}</div>}{a.replanned > 0 && <div className="mini" style={{ color: "#8a5a00" }}>replanned ×{a.replanned}</div>}</td>
                <td>{a.lead_auditor ? name(a.lead_auditor) : a.external_auditor ?? "—"}{a.lead_auditor && a.external_auditor && <div className="mini">{a.external_auditor}</div>}</td>
                <td><span className={"pill " + (a.status === "closed" ? "green" : a.status === "cancelled" ? "" : late ? "red" : a.status === "planned" ? "" : "amber")}>{STATUS_LABEL[a.status]}</span>{a.done_on && <div className="mini mono">{a.done_on}</div>}</td>
                <td>{mayMove && a.status !== "cancelled" && a.status !== "closed" && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn sm">Edit</summary>
                  <div className="card cb grid gap-3" style={{ position: "absolute", right: 0, top: 30, width: 440, zIndex: 5 }}>
                    <form action={saveAuditPlan} className="grid gap-2"><input type="hidden" name="id" value={a.id} />
                      <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={a.title} /></label>
                      <div className="grid grid-cols-2 gap-2"><label><span className="mini">From</span><input type="date" name="planned_on" className="inp" defaultValue={a.planned_on ?? ""} /></label><label><span className="mini">To</span><input type="date" name="planned_end" className="inp" defaultValue={a.planned_end ?? ""} /></label></div>
                      <div className="grid grid-cols-2 gap-2">{desk ? <label><span className="mini">Lead auditor</span><select name="lead_auditor" className="inp" defaultValue={a.lead_auditor ?? ""}><option value="">—</option>{people.map((q) => <option key={q.id} value={q.id}>{q.display_name}</option>)}</select></label> : <span />}<label><span className="mini">External auditor</span><input name="external_auditor" className="inp" defaultValue={a.external_auditor ?? ""} /></label></div>
                      <label><span className="mini">Scope</span><textarea name="scope" className="inp" rows={2} defaultValue={a.scope ?? ""} /></label>
                      <div className="grid grid-cols-2 gap-2"><label><span className="mini">Status</span><select name="status" className="inp" defaultValue={a.status}>{["planned", "in_progress", "report", "closed"].map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select></label><label><span className="mini">Done on</span><input type="date" name="done_on" className="inp" defaultValue={a.done_on ?? ""} /></label></div>
                      <div className="flex justify-end"><button className="btn primary sm">Save</button></div></form>
                    <form action={replanAudit} className="grid gap-2" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={a.id} />
                      <div className="grid grid-cols-2 gap-2"><label><span className="mini">Move to</span><MonthSelect name="month" def={a.planned_month} /></label><label><span className="mini">Why (kept)</span><input name="reason" className="inp" required /></label></div>
                      <div className="flex justify-end"><button className="btn sm">Move</button></div></form>
                    {desk && <form action={cancelAudit} className="grid gap-2" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="id" value={a.id} />
                      <label><span className="mini">Cancel, why (kept)</span><input name="reason" className="inp" required /></label>
                      <div className="flex justify-end"><button className="btn sm">Cancel the audit</button></div></form>}
                  </div></details>}</td>
              </tr>);
          })}</tbody></table>)}</div></section>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <section className="card"><div className="ch"><span className="eyebrow">Modules, areas to audit</span></div><div className="cb" style={{ padding: 0 }}>
          <table className="tbl"><thead><tr><th>Module</th><th>Type</th><th>Checklist</th><th>Audits</th>{desk && <th></th>}</tr></thead><tbody>{active.map((m) => (
            <tr key={m.id}><td><b className="mono">{m.code}</b> {m.title}{m.domain && <div className="mini">{m.domain}</div>}</td><td className="mini">{KIND_LABEL[m.kind]}</td>
              <td className="mini">{m.checklist_id && clOf(m.checklist_id) ? <><Link href={`/comp/prog/cl/${m.checklist_id}`}><b className="mono">{clOf(m.checklist_id)!.code}</b></Link>, {codesOf(m.checklist_id).length} rules</> : m.kind === "authority" ? "—" : desk ? <form action={createChecklist} className="flex gap-1"><input type="hidden" name="entity" value={p.entity} /><input type="hidden" name="programme" value={p.id} /><input type="hidden" name="module" value={m.id} /><input type="hidden" name="code" value={m.code} /><input type="hidden" name="title" value={m.title} /><input type="hidden" name="domain" value={m.domain ?? ""} /><button className="btn sm">Create / link {m.code}</button></form> : <span style={{ color: "#8a5a00" }}>no checklist</span>}{m.requirements.length > codesOf(m.checklist_id).length && <div className="mono" style={{ color: "var(--slate5)" }}>+ {m.requirements.filter((r) => !codesOf(m.checklist_id).includes(r)).join(", ")}</div>}</td>
              <td className={c.modulesWithout.some((x) => x.id === m.id) ? "late" : ""}>{audits.filter((a) => a.module_id === m.id && a.status !== "cancelled").length}</td>
              {desk && <td><details className="inlineedit" style={{ position: "relative" }}><summary className="btn sm">Edit</summary>
                <div className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 30, width: 400, zIndex: 5 }}>
                  <form action={saveModule} className="grid gap-2"><input type="hidden" name="programme" value={p.id} /><input type="hidden" name="id" value={m.id} />
                    <div className="grid grid-cols-3 gap-2"><label><span className="mini">Code</span><input name="code" className="inp mono" defaultValue={m.code} /></label><label className="col-span-2"><span className="mini">Title</span><input name="title" className="inp" defaultValue={m.title} /></label></div>
                    <div className="grid grid-cols-3 gap-2"><label><span className="mini">Domain</span><input name="domain" className="inp" defaultValue={m.domain ?? ""} /></label><label><span className="mini">Type</span><select name="kind" className="inp" defaultValue={m.kind}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label><span className="mini">Order</span><input name="sort" type="number" className="inp" defaultValue={m.sort} /></label></div>
                    <label><span className="mini">Requirements covered, one per line</span><textarea name="requirements" className="inp mono" rows={3} defaultValue={m.requirements.join("\n")} /></label>
                    <div className="flex justify-end"><button className="btn primary sm">Save</button></div></form>
                  <form action={archiveModule}><input type="hidden" name="programme" value={p.id} /><input type="hidden" name="id" value={m.id} /><button className="btn sm">Remove the module</button></form>
                </div></details></td>}
            </tr>))}
            {!active.length && <tr><td colSpan={5} className="mini">No module yet.</td></tr>}</tbody></table>
          {desk && <form action={saveModule} className="cb grid gap-2" style={{ borderTop: "1px solid var(--line)" }}><input type="hidden" name="programme" value={p.id} />
            <div className="grid grid-cols-4 gap-2"><input name="code" className="inp mono" placeholder="Code" required /><input name="title" className="inp col-span-2" placeholder="Area, e.g. Operating procedures" required /><select name="kind" className="inp" defaultValue="internal">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="grid grid-cols-4 gap-2"><select name="domain" className="inp" defaultValue={p.domains[0] ?? ""}><option value="">—</option>{(PROG_REF[p.entity]?.domains ?? []).map((d) => <option key={d}>{d}</option>)}</select><input name="requirements" className="inp mono col-span-2" placeholder="Requirements, separated by ;" /><button className="btn sm">+ Module</button></div></form>}
        </div></section>

        <section className="card"><div className="ch"><span className="eyebrow">Programme</span></div><div className="cb">
          {desk ? <form action={saveProgramme} className="grid gap-2"><input type="hidden" name="id" value={p.id} />
            <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={p.title} /></label>
            <div className="grid grid-cols-3 gap-2"><label><span className="mini">Reference</span><input name="reference" className="inp mono" defaultValue={p.reference ?? ""} /></label><label><span className="mini">Cycle (months)</span><input name="cycle_months" type="number" min={6} max={36} className="inp" defaultValue={p.cycle_months} /></label><label><span className="mini">Starts</span><input name="starts_on" type="month" className="inp" defaultValue={p.starts_on.slice(0, 7)} /></label></div>
            <label><span className="mini">Requirements the cycle must cover, one per line</span><textarea name="requirements" className="inp mono" rows={5} defaultValue={p.requirements.join("\n")} /></label>
            <label><span className="mini">Note</span><textarea name="note" className="inp" rows={2} defaultValue={p.note ?? ""} /></label>
            <div className="flex justify-end"><button className="btn primary sm">Save</button></div></form>
            : <div className="mini">{p.note ?? "—"}</div>}
          {p.approval_note && <p className="mini mt-2">Approval note: {p.approval_note}</p>}
        </div></section>
      </div>

      {p.requirements.length > 0 && <section className="card mb-4"><div className="ch"><span className="eyebrow">Coverage, modules × requirements</span><span className="mini">counted only for modules with an audit in the cycle</span></div><div className="cb" style={{ overflow: "auto" }}>
        <table className="matrix"><thead><tr><th>Module</th>{p.requirements.map((r) => <th key={r}>{r}</th>)}</tr></thead><tbody>
          {active.map((m) => <tr key={m.id}><td style={{ textAlign: "left" }}><b>{m.code}</b></td>{p.requirements.map((r) => { const has = m.requirements.some((x) => x.toLowerCase() === r.toLowerCase()); return <td key={r} className={has ? "x" : ""}>{has ? "×" : ""}</td>; })}</tr>)}
          <tr><td style={{ textAlign: "left" }}><b>Audited</b></td>{c.reqs.map((r) => <td key={r.req} className={r.modules.length ? "x" : "gap"}>{r.modules.length}</td>)}</tr>
        </tbody></table></div></section>}

      {audits.some((a) => a.status === "closed") && (() => { // the plan's "Overview" tab, computed: per audit done, findings level 1 / 2 / observations, closure on time
        const F = findingsAll;
        const rows = audits.filter((a) => a.status === "closed").map((a) => { const fa = F.filter((f) => f.audit_id === a.id); const closedLate = fa.filter((f) => f.closed_at && f.due && f.closed_at.slice(0, 10) > f.due).length; const openLate = fa.filter((f) => !f.closed_at && f.due && f.due < t0).length; const centrik = (a.note ?? "").match(/Centrik findings: (.*)/)?.[1] ?? null; return { a, l1: fa.filter((f) => f.level === "1").length, l2: fa.filter((f) => f.level === "2").length, obs: fa.filter((f) => f.level === "obs" || f.level === "3").length, open: fa.filter((f) => !f.closed_at).length, onTime: fa.length ? (closedLate || openLate ? "late" : "on time") : "—", centrik }; });
        const tot = rows.reduce((o, r) => ({ l1: o.l1 + r.l1, l2: o.l2 + r.l2, obs: o.obs + r.obs }), { l1: 0, l2: 0, obs: 0 });
        return <section className="card mb-4"><div className="ch"><span className="eyebrow">Annual overview, audits done</span><span className="mini">{rows.length} audits, {tot.l1} level 1, {tot.l2} level 2, {tot.obs} observations</span></div><div className="cb" style={{ padding: 0 }}>
          <table className="tbl"><thead><tr><th>Audit</th><th>Done</th><th>Level 1</th><th>Level 2</th><th>Obs.</th><th>Open</th><th>Closure</th></tr></thead><tbody>{rows.map(({ a, l1, l2, obs, open, onTime, centrik }) => <tr key={a.id}><td><Link href={`/comp/audits/${a.id}`}><b className="mono">{a.number}</b> {a.title}</Link>{centrik && <div className="mini">Centrik: {centrik.slice(0, 120)}</div>}</td><td className="mono mini">{a.done_on ?? "—"}</td><td className={l1 ? "late" : ""}>{l1 || ""}</td><td>{l2 || ""}</td><td>{obs || ""}</td><td className={open ? "late" : ""}>{open || ""}</td><td><span className={"pill " + (onTime === "late" ? "red" : onTime === "on time" ? "green" : "")}>{onTime === "—" ? "no finding" : onTime.toUpperCase()}</span></td></tr>)}</tbody></table></div></section>; })()}
      {events.length > 0 && <section className="card"><div className="ch"><span className="eyebrow">History</span></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>When (UTC)</th><th>Audit</th><th>What</th><th>Who</th></tr></thead><tbody>{events.map((e) => {
          const a = audits.find((y) => y.id === e.audit_id);
          return <tr key={e.id}><td className="mono mini">{e.at.slice(0, 16).replace("T", " ")}</td><td className="mono">{a?.number}</td>
            <td>{e.kind === "replanned" ? `Moved ${e.from_month ? monthLong(e.from_month) : ""} → ${e.to_month ? monthLong(e.to_month) : ""}` : e.kind === "planned" ? `Planned ${e.to_month ? monthLong(e.to_month) : ""}` : e.kind === "cancelled" ? "Cancelled" : e.kind === "status" ? `Status → ${STATUS_LABEL[e.status ?? ""] ?? e.status}` : e.kind}{e.reason && <div className="mini">{e.reason}</div>}</td><td>{name(e.by)}</td></tr>;
        })}</tbody></table></div></section>}
      <p className="mini mt-3"><span className="entdot" style={{ background: ENT_COLOR[p.entity] ?? "#888" }} />{p.entity}, the audits are conducted in Compliance › Audits (PRO-CM-02); a finding raised in an audit points to it.</p>
    </>
  );
}
