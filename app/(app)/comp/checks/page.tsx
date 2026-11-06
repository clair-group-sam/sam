import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { CHECK_RESULT_LABEL, CHECK_RESULT_TONE, daysTo, nextDueOf, type CCheck, type CRun } from "@/lib/compliance-registers";
import { LEVEL_LABEL } from "@/lib/findings";
import { today } from "@/lib/authority";
import { archiveCheck, recordRun, saveCheck } from "./actions";

type Sp = { c?: string };
/* COMP-04 · Compliance checks: recurring controls distinct from audits (ENR-OPS-01 C1..C3, ENR-ATO-01 CC-01..16). Due dates computed; each run recorded with its sample and evidence. */
export default async function ComplianceChecks({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin(); const desk = s.role === "cmm" || s.roles.map(basePost).includes("CMM"); const t0 = today();
  let q = db.from("compliance_checks").select("*").eq("active", true).order("entity").order("code");
  if (scope) q = q.in("entity", scope);
  const { data } = await q;
  const checks = ((data ?? []) as CCheck[]).map((c) => ({ ...c, due: nextDueOf(c), days: daysTo(nextDueOf(c), t0) }));
  const open = checks.find((c) => c.id === sp.c) ?? null;
  const [{ data: ppl }, { data: runs }, { data: cls }] = await Promise.all([
    db.from("people").select("id,display_name").limit(500),
    open ? db.from("compliance_check_runs").select("*").eq("check_id", open.id).order("done_on", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    db.from("checklists").select("id,entity,code,title").eq("active", true).in("entity", scope ?? ENTS4).order("code"),
  ]);
  const people = (ppl ?? []) as { id: string; display_name: string }[]; const name = (id: string | null) => people.find((p) => p.id === id)?.display_name ?? "—";
  const { data: monthRuns } = await db.from("compliance_check_runs").select("check_id,result,finding_id").gte("done_on", t0.slice(0, 7) + "-01").in("check_id", checks.map((c) => c.id).concat(["00000000-0000-0000-0000-000000000000"]));
  const mr = (monthRuns ?? []) as { check_id: string; result: string; finding_id: string | null }[];
  const ents = scope ?? ENTS4;
  const posts = s.roles.map(basePost);
  const owns = (c: CCheck) => desk || (!!c.owner_person && c.owner_person === s.person?.id) || (!!c.owner_role && posts.includes(basePost(c.owner_role)));
  return (
    <>
      <PageHeader eyebrow="Compliance, Compliance checks" title="Compliance checks" sub="Recurring controls distinct from audits (flight packages, ARINC, aircraft library, student files…): a cadence, an owner, a result each time with what was sampled. Due dates reach the owner's Inbox 30 days ahead."
        right={desk ? <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Check</summary>
          <form action={saveCheck} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 460, zIndex: 5 }}>
            <div className="grid grid-cols-3 gap-2"><label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={ents[0]}>{ents.map((e) => <option key={e} value={e}>{e}</option>)}</select></label><label><span className="mini">Code</span><input name="code" className="inp mono" placeholder="CC-07" required /></label><label><span className="mini">Every (months)</span><input name="every_months" type="number" className="inp" defaultValue={6} min={1} /></label></div>
            <label><span className="mini">Title</span><input name="title" className="inp" required placeholder="Web Manuals / METEOR consistency" /></label>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Reference</span><input name="reference" className="inp mono" placeholder="ORA.GEN.115" /></label><label><span className="mini">Domain</span><input name="domain" className="inp" placeholder="OPS, ATO, CAMO" /></label></div>
            <div className="grid grid-cols-3 gap-2"><label><span className="mini">Owner, post</span><input name="owner_role" className="inp mono" defaultValue="CMM" /></label><label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue=""><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label><label><span className="mini">First due</span><input type="date" name="next_due" className="inp" /></label></div>
            <label><span className="mini">Short checklist (optional)</span><select name="checklist" className="inp" defaultValue=""><option value="">—</option>{((cls ?? []) as { id: string; entity: string; code: string; title: string }[]).map((c) => <option key={c.id} value={c.id}>{c.entity}, {c.code}, {c.title}</option>)}</select></label>
            <div className="flex justify-end"><button className="btn primary" type="submit">Create</button></div></form></details> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Active checks" value={checks.length} hint={`${checks.filter((c) => c.every_months <= 3).length} quarterly or more`} />
        <Metric label="Due ≤ 30 days" value={checks.filter((c) => c.days !== null && c.days <= 30).length} hint={`${checks.filter((c) => c.days !== null && c.days < 0).length} past due`} tone={checks.some((c) => c.days !== null && c.days < 0) ? "red" : checks.some((c) => c.days !== null && c.days <= 30) ? "amber" : "green"} />
        <Metric label="Done this month" value={mr.length} hint={`${mr.filter((r) => r.result !== "conforming").length} not fully conforming`} />
        <Metric label="Findings raised this month" value={mr.filter((r) => r.finding_id).length} />
      </div>
      <section className="card mb-4"><div className="cb" style={{ padding: 0 }}>{!checks.length ? <p className="p-4 mini">No check in your scope.</p> : (
        <table className="tbl"><thead><tr><th>Check</th><th>Reference</th><th>Every</th><th>Owner</th><th>Last</th><th>Next due</th><th></th></tr></thead><tbody>{checks.map((c) => (
          <tr key={c.id} className={open?.id === c.id ? "on" : ""}><td><Link href={`/comp/checks?c=${c.id}#check`}><b className="mono">{c.code}</b> {c.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[c.entity] ?? "#888" }} />{c.entity}{c.domain ? `, ${c.domain}` : ""}</div></td>
            <td className="mono mini">{c.reference ?? "—"}</td><td>{c.every_months} mo</td><td>{c.owner_person ? name(c.owner_person) : c.owner_role ?? "—"}</td><td className="mono mini">{c.last_done_on ?? "never"}</td>
            <td className={c.days !== null && c.days < 0 ? "late" : ""}>{c.due ?? "—"}{c.days !== null && <div className="mini">{c.days < 0 ? `${-c.days} d late` : c.days === 0 ? "today" : `in ${c.days} d`}</div>}</td>
            <td>{owns(c) && <Link className="btn sm" href={`/comp/checks?c=${c.id}#check`}>Record</Link>}</td></tr>))}</tbody></table>)}</div></section>

      {open && <div id="check" className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <section className="card"><div className="ch"><span><b className="mono">{open.code}</b> {open.title}</span><span className="mini">{ENT[open.entity]?.name}</span></div>
          <div className="cb">
            {owns(open) ? <form action={recordRun} className="grid gap-2"><input type="hidden" name="id" value={open.id} />
              <div className="flex gap-2" style={{ flexWrap: "wrap" }}>{Object.entries(CHECK_RESULT_LABEL).map(([k, l]) => <label key={k} className={"radio-pill " + CHECK_RESULT_TONE[k]}><input type="radio" name="result" value={k} required /> {l}</label>)}</div>
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Done on</span><input type="date" name="done_on" className="inp" defaultValue={t0} /></label><label><span className="mini">Sample</span><input name="sample" className="inp" placeholder="5 flight packages of October, 9H-SFJ library" /></label></div>
              <textarea name="comment" className="inp" rows={3} placeholder="What was seen; deviations; reference of the evidence…" />
              <input type="file" name="file" className="mini" />
              <details><summary className="mini">Raise a finding from this run (when not conforming)</summary><div className="grid gap-2 mt-2"><label className="mini"><input type="checkbox" name="raise_finding" value="1" /> Create the finding</label>
                <input name="title_f" className="inp" placeholder="Title (default: the check)" />
                <div className="grid grid-cols-3 gap-2"><input name="owner_role_f" className="inp mono" placeholder="Answers, post (NPFO…)" /><select name="owner_person_f" className="inp" defaultValue=""><option value="">or person</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select><input type="date" name="due_f" className="inp" /></div>
                <div className="grid grid-cols-2 gap-2"><select name="category_f" className="inp" defaultValue=""><option value="">Category</option>{["Flight Ops", "Ground Ops", "Engineering", "Aircraft", "AOC", "Manuals", "Training", "Other"].map((x) => <option key={x}>{x}</option>)}</select><select name="cause_f" className="inp" defaultValue=""><option value="">Cause</option>{["One-off", "General practice", "Manuals", "Other"].map((x) => <option key={x}>{x}</option>)}</select></div></div></details>
              <div className="flex justify-end"><button className="btn primary sm">Record the run</button></div></form> : <p className="mini">Owner: {open.owner_person ? name(open.owner_person) : open.owner_role}. Only the owner or the Compliance desk records a run.</p>}
            {desk && <details className="mt-3"><summary className="mini">Settings</summary>
              <form action={saveCheck} className="grid gap-2 mt-2"><input type="hidden" name="id" value={open.id} />
                <div className="grid grid-cols-3 gap-2"><input name="code" className="inp mono" defaultValue={open.code} /><input name="title" className="inp col-span-2" defaultValue={open.title} /></div>
                <div className="grid grid-cols-3 gap-2"><input name="reference" className="inp mono" defaultValue={open.reference ?? ""} placeholder="Reference" /><input name="domain" className="inp" defaultValue={open.domain ?? ""} placeholder="Domain" /><input name="every_months" type="number" className="inp" defaultValue={open.every_months} /></div>
                <div className="grid grid-cols-3 gap-2"><input name="owner_role" className="inp mono" defaultValue={open.owner_role ?? ""} placeholder="Owner post" /><select name="owner_person" className="inp" defaultValue={open.owner_person ?? ""}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select><input type="date" name="next_due" className="inp" defaultValue={open.next_due ?? ""} /></div>
                <select name="checklist" className="inp" defaultValue={open.checklist_id ?? ""}><option value="">no checklist</option>{((cls ?? []) as { id: string; entity: string; code: string; title: string }[]).filter((c) => c.entity === open.entity).map((c) => <option key={c.id} value={c.id}>{c.code}, {c.title}</option>)}</select>
                <textarea name="note" className="inp" rows={2} defaultValue={open.note ?? ""} placeholder="Note" />
                <div className="flex justify-between"><button className="btn primary sm">Save</button></div></form>
              <form action={archiveCheck} className="mt-2"><input type="hidden" name="id" value={open.id} /><button className="btn sm">Remove the check</button></form></details>}
          </div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Runs, {(runs ?? []).length}</span></div><div className="cb" style={{ padding: 0 }}>
          <table className="tbl"><tbody>{((runs ?? []) as CRun[]).map((r) => <tr key={r.id}><td className="mono mini">{r.done_on}</td><td><span className={"pill " + CHECK_RESULT_TONE[r.result]}>{CHECK_RESULT_LABEL[r.result]}</span></td><td>{r.sample && <div className="mini">Sample: {r.sample}</div>}{r.comment && <div className="mini">{r.comment}</div>}{r.evidence.map((e, i) => <a key={i} className="mini" href={`/api/files/${e.path}`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{e.name}</a>)}{r.finding_id && <Link className="mini" href={`/comp/find/${r.finding_id}`}> finding ›</Link>}</td><td className="mini">{name(r.done_by)}</td></tr>)}{!(runs ?? []).length && <tr><td className="mini">No run recorded yet.</td></tr>}</tbody></table></div></section>
      </div>}
      <p className="mini mt-3">{Object.keys(LEVEL_LABEL).length ? "A not-conforming run can raise a finding (level 2) or an observation; it then follows the usual finding workflow." : ""}</p>
    </>
  );
}
