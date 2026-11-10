import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT_COLOR, ENTS4 } from "@/lib/nav";
import { AUDITOR_DOMAINS, AUDITOR_STATUS, auditorRoster, daysTo, type Auditor, type AuditorDoc, type AuditorItem } from "@/lib/compliance-registers";
import { today } from "@/lib/authority";
import { removeDoc, saveAuditor, saveItem, setStatus, uploadDoc } from "./actions";
import { Icon } from "@/lib/icons";

type Sp = { a?: string };
/* COMP-05 · Internal auditors (ENR-CM-09 / PRO-CM-04): who may audit what, the qualification path, the approval and its validity, the certificates. */
export default async function Auditors({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin(); const desk = s.role === "cmm" || s.roles.map(basePost).includes("CMM"); const am = s.role === "am" || s.roles.map(basePost).includes("AM"); const t0 = today();
  const [{ data: ad }, { data: ppl }, { data: aud }] = await Promise.all([
    db.from("auditors").select("*").order("created_at"),
    db.from("people").select("id,display_name,roles").limit(800),
    db.from("audits").select("id,number,entity,kind,status,planned_month,done_on,lead_auditor,auditors,external_auditor").neq("status", "cancelled").limit(5000),
  ]);
  const [{ data: its }, { data: dcs }] = await Promise.all([db.from("auditor_items").select("auditor_id,done").limit(5000), db.from("auditor_docs").select("auditor_id").limit(5000)]);
  const people = (ppl ?? []) as { id: string; display_name: string; roles: string[] }[]; const name = (id: string | null) => people.find((p) => p.id === id)?.display_name ?? "—";
  const all = ((ad ?? []) as Auditor[]).filter((a) => !scope || a.entities.some((e) => scope.includes(e)) || !a.entities.length);
  // 10/11 · everyone named in an audit of the scope shows here; a red line until the file is complete (Guillaume)
  type AuRow = { id: string; number: string; entity: string; kind: string; status: string; planned_month: string; done_on: string | null; lead_auditor: string | null; auditors: string[]; external_auditor: string | null };
  const scopedAudits = ((aud ?? []) as AuRow[]).filter((x) => !scope || scope.includes(x.entity));
  const roster = auditorRoster(all, people, scopedAudits, (its ?? []) as { auditor_id: string; done: boolean }[], (dcs ?? []) as { auditor_id: string }[], t0);
  const incomplete = roster.filter((r) => r.missing.length);
  const open = all.find((a) => a.id === sp.a) ?? null;
  const [{ data: items }, { data: docs }] = open ? await Promise.all([db.from("auditor_items").select("*").eq("auditor_id", open.id).order("ord"), db.from("auditor_docs").select("*").eq("auditor_id", open.id).order("at")]) : [{ data: [] }, { data: [] }];
  const expiring = (a: Auditor) => { const d = daysTo(a.valid_until, t0); return d !== null && d <= 90; };
  const tone = (a: Auditor) => a.status === "approved" ? (expiring(a) ? "amber" : "green") : a.status === "in_qualification" ? "" : "red";
  const ents = scope ?? ENTS4;
  return (
    <>
      <PageHeader eyebrow="Compliance, Internal auditors" title="Internal auditors" sub="Approved auditors per entity, qualification path (PRO-CM-04), independence from the audited departments, approval by the Accountable Manager and its validity, certificates. The audit programme warns when a lead auditor is not approved for the entity or the domain."
        right={desk ? <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Auditor</summary>
          <form action={saveAuditor} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 460, zIndex: 5 }}>
            <label><span className="mini">Person (staff)</span><select name="person" className="inp" defaultValue=""><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
            <label><span className="mini">or external auditor, name</span><input name="name" className="inp" placeholder="L. Rudelle" /></label>
            <div className="mini">Entities {ENTS4.map((e) => <label key={e} style={{ marginRight: 8 }}><input type="checkbox" name="entities" value={e} defaultChecked={ents.includes(e)} /> {e}</label>)}</div>
            <div className="mini">Domains {AUDITOR_DOMAINS.map((d) => <label key={d} style={{ marginRight: 8, display: "inline-block" }}><input type="checkbox" name="domains" value={d} /> {d}</label>)}</div>
            <label><span className="mini">Cannot audit (own departments), one per line</span><textarea name="exclusions" className="inp" rows={2} placeholder="Training, FSTD" /></label>
            <div className="grid grid-cols-2 gap-2"><label className="mini"><input type="checkbox" name="lead" value="1" /> May lead audits</label><input name="external" className="inp" placeholder="External company (if not staff)" /></div>
            <div className="flex justify-end"><button className="btn primary">Add to the register</button></div></form></details> : undefined} />
      {incomplete.length > 0 && <section className="card mb-4" style={{ borderColor: "var(--state-red)" }}><div className="cb" style={{ color: "var(--red-ink)" }}>
        <b>{incomplete.length} auditor file{incomplete.length > 1 ? "s" : ""} not complete</b>, {incomplete.filter((r) => !r.auditor).length ? `${incomplete.filter((r) => !r.auditor).length} named in audits with no file at all, ` : ""}an audit led by one of them cannot count as qualified (PRO-CM-04).
        <div className="mini mt-1">{incomplete.map((r) => `${r.name}: ${r.missing.join(", ")}`).join(" · ")}</div></div></section>}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Approved" value={all.filter((a) => a.status === "approved" && !expiring(a)).length} tone="green" hint="valid approval" />
        <Metric label="Attention" value={all.filter((a) => a.status === "approved" && expiring(a)).length} hint="approval ends ≤ 90 days" tone={all.some((a) => a.status === "approved" && expiring(a)) ? "amber" : undefined} />
        <Metric label="In qualification" value={all.filter((a) => a.status === "in_qualification").length} hint="observer / co-auditor path" />
        <Metric label="Lead auditors" value={all.filter((a) => a.lead && a.status === "approved").length} />
      </div>
      <section className="card mb-4"><div className="cb" style={{ padding: 0 }}>{!roster.length ? <p className="p-4 mini">No auditor in the register and none named in an audit yet.</p> : (
        <table className="tbl"><thead><tr><th>Auditor</th><th>Entities</th><th>Domains, cannot audit</th><th>Approval</th><th>Audits</th><th>File</th></tr></thead><tbody>{roster.map((r) => { const a = r.auditor; const last = r.audits.map((x) => x.done_on ?? "").sort().pop(); const ents = [...new Set(r.audits.map((x) => x.entity))];
          return <tr key={r.key} style={r.missing.length ? { background: "var(--terra-s)" } : undefined}>
            <td>{a ? <Link href={`/comp/auditors?a=${a.id}#auditor`}><b>{r.name}</b></Link> : <b>{r.name}</b>}{a?.lead && <span className="pill" style={{ marginLeft: 6 }}>Lead</span>}{(a?.external ?? r.company) && <div className="mini">{a?.external ?? r.company}</div>}{!a?.person_id && a && <div className="mini">external, not in People</div>}</td>
            <td>{(a ? a.entities : ents).map((e) => <span key={e}><span className="entdot" style={{ background: ENT_COLOR[e] ?? "var(--field)" }} />{e} </span>)}</td>
            <td className="mini">{a ? (a.domains.join(", ") || "—") : "—"}{a && a.exclusions.length > 0 && <div style={{ color: "var(--amber-ink)" }}>Not: {a.exclusions.join(", ")}</div>}</td>
            <td className="mini">{a?.approved_on ? `${a.approved_on} → ${a.valid_until ?? "—"}` : "—"}{a?.approved_by && <div>by {name(a.approved_by)}</div>}</td>
            <td className="mini">{r.audits.length}{last ? `, last ${last}` : ""}{r.audits.length > 0 && <div className="mono">{r.audits.slice(0, 3).map((x) => x.number).join(", ")}{r.audits.length > 3 ? "…" : ""}</div>}</td>
            <td>{r.missing.length ? <><span className="pill red">{a ? "File incomplete" : "No file"}</span><div className="mini" style={{ color: "var(--red-ink)" }}>{r.missing.join(", ")}</div>
              {!a && desk && <form action={saveAuditor} className="mt-1">{r.key.startsWith("p:") ? <input type="hidden" name="person" value={r.key.slice(2)} /> : <><input type="hidden" name="name" value={r.name} /><input type="hidden" name="external" value={r.company ?? ""} /></>}{ents.map((e) => <input key={e} type="hidden" name="entities" value={e} />)}<input type="hidden" name="lead" value="1" /><button className="btn sm primary">Create the file</button></form>}</>
              : <span className={"pill " + tone(a!)}>{AUDITOR_STATUS[a!.status]}{a!.status === "approved" && expiring(a!) ? `, ends ${a!.valid_until}` : ""}</span>}</td></tr>; })}</tbody></table>)}</div></section>

      {open && <div id="auditor" className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <section className="card"><div className="ch"><span><b>{open.name ?? name(open.person_id)}</b>, <span className={"pill " + tone(open)}>{AUDITOR_STATUS[open.status]}</span></span>
          <span className="flex gap-2">{(desk || am) && open.status !== "approved" && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn primary sm">Approve</summary><form action={setStatus} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 30, width: 360, zIndex: 5 }}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="status" value="approved" />
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Approved on</span><input type="date" name="approved_on" className="inp" defaultValue={t0} /></label><label><span className="mini">Valid until</span><input type="date" name="valid_until" className="inp" /></label></div>
            <input name="note" className="inp" placeholder="AM letter reference / note" /><label className="mini"><input type="checkbox" name="force" value="1" /> Approve even if qualification items remain</label>
            <div className="flex justify-end"><button className="btn primary sm">Record the approval</button></div></form></details>}
            {(desk || am) && open.status === "approved" && <form action={setStatus} className="flex gap-1"><input type="hidden" name="id" value={open.id} /><input type="hidden" name="status" value="suspended" /><input name="note" className="inp" placeholder="Why" style={{ width: 160 }} required /><button className="btn sm">Suspend</button></form>}</span></div>
          <div className="cb">
            <div className="mini mb-2">PRO-CM-04 qualification path</div>
            <table className="tbl"><tbody>{((items ?? []) as AuditorItem[]).map((it) => <tr key={it.id}><td style={{ width: 24 }}>{it.done ? <span className="pill green"><Icon name="check" size={12} /></span> : <span className="pill">open</span>}</td><td>{it.label}{(it.evidence || it.on_date) && <div className="mini">{it.evidence}{it.on_date ? `, ${it.on_date}` : ""}{it.valid_until ? ` → ${it.valid_until}` : ""}</div>}</td>
              {desk && <td style={{ width: 60 }}><details className="inlineedit" style={{ position: "relative" }}><summary className="btn sm">Edit</summary><form action={saveItem} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 30, width: 360, zIndex: 5 }}><input type="hidden" name="id" value={it.id} /><input type="hidden" name="auditor" value={open.id} />
                <label className="mini"><input type="checkbox" name="done" value="1" defaultChecked={it.done} /> Done</label><input name="evidence" className="inp" defaultValue={it.evidence ?? ""} placeholder="Course, reference, who" /><div className="grid grid-cols-2 gap-2"><input type="date" name="on_date" className="inp" defaultValue={it.on_date ?? ""} /><input type="date" name="valid_until" className="inp" defaultValue={it.valid_until ?? ""} /></div><div className="flex justify-end"><button className="btn primary sm">Save</button></div></form></details></td>}</tr>)}</tbody></table>
            {desk && <details className="mt-3"><summary className="mini">Scope and settings</summary><form action={saveAuditor} className="grid gap-2 mt-2"><input type="hidden" name="id" value={open.id} />
              <div className="mini">Entities {ENTS4.map((e) => <label key={e} style={{ marginRight: 8 }}><input type="checkbox" name="entities" value={e} defaultChecked={open.entities.includes(e)} /> {e}</label>)}</div>
              <div className="mini">Domains {AUDITOR_DOMAINS.map((d) => <label key={d} style={{ marginRight: 8, display: "inline-block" }}><input type="checkbox" name="domains" value={d} defaultChecked={open.domains.includes(d)} /> {d}</label>)}</div>
              <textarea name="exclusions" className="inp" rows={2} defaultValue={open.exclusions.join("\n")} placeholder="Cannot audit (own departments)" />
              <div className="grid grid-cols-2 gap-2"><label className="mini"><input type="checkbox" name="lead" value="1" defaultChecked={open.lead} /> May lead audits</label><input name="external" className="inp" defaultValue={open.external ?? ""} placeholder="External company" /></div>
              <input name="aliases" className="inp" defaultValue={(open.aliases ?? []).join(", ")} placeholder="Also written in audits as… (initials, short name), comma separated" />{!open.person_id && <input name="name" className="inp" defaultValue={open.name ?? ""} placeholder="Name" />}
              <textarea name="note" className="inp" rows={2} defaultValue={open.note ?? ""} placeholder="Note" /><div className="flex justify-end"><button className="btn primary sm">Save</button></div></form></details>}
            {open.note && !desk && <p className="mini mt-2" style={{ whiteSpace: "pre-wrap" }}>{open.note}</p>}
          </div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Certificates and evidence, {(docs ?? []).length}</span></div><div className="cb">
          <table className="tbl"><tbody>{((docs ?? []) as AuditorDoc[]).map((d) => { const dd = daysTo(d.valid_until, t0); return <tr key={d.id}><td>{d.path ? <a href={`/api/files/${d.path}`} target="_blank" rel="noreferrer"><b>{d.name}</b></a> : <b>{d.name}</b>}<div className="mini">{d.kind ?? ""}{d.issued_on ? `, issued ${d.issued_on}` : ""}</div></td><td className={dd !== null && dd < 0 ? "late" : ""}>{d.valid_until ?? "—"}{dd !== null && dd <= 90 && <div className="mini">{dd < 0 ? "expired" : `${dd} d`}</div>}</td>{desk && <td><form action={removeDoc}><input type="hidden" name="id" value={d.id} /><button className="btn sm">Remove</button></form></td>}</tr>; })}{!(docs ?? []).length && <tr><td className="mini">No document yet.</td></tr>}</tbody></table>
          {desk && <form action={uploadDoc} className="grid gap-2 mt-3" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><input type="hidden" name="auditor" value={open.id} />
            <div className="grid grid-cols-3 gap-2"><input name="name" className="inp col-span-2" placeholder="Auditor training certificate. Sofema" /><select name="kind" className="inp" defaultValue="training"><option value="training">Training</option><option value="approval">AM approval</option><option value="independence">Independence declaration</option><option value="other">Other</option></select></div>
            <div className="grid grid-cols-3 gap-2"><input type="date" name="issued_on" className="inp" /><input type="date" name="valid_until" className="inp" /><input type="file" name="file" className="mini" /></div>
            <div className="flex justify-end"><button className="btn sm">Add</button></div></form>}
          <p className="mini mt-3">Reminders at D-90 and D-30 come through the Inbox for the approval and the certificates with a validity date.</p>
        </div></section>
      </div>}
    </>
  );
}
