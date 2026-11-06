import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR } from "@/lib/nav";
import { KIND_LABEL, monthLong, STATUS_LABEL, type Audit, type AuditEvent } from "@/lib/audit-programme";
import { breakdown, history, hintsFor, RESULT_LABEL, RESULT_TONE, RESULTS, textFor, type Check, type Checklist } from "@/lib/audit-run";
import { LEVEL_LABEL } from "@/lib/findings";
import { eligibility, type Auditor } from "@/lib/compliance-registers";
import { RuleText } from "@/components/RuleText";
import { ruleCodesIn } from "@/lib/regulation-items";
import { addCheck, raiseFinding, refreshHints, reopenAudit, reportAudit, setCheck, startAudit } from "../actions";

type Sp = { c?: string };
type A = Audit & { checklist_id: string | null; started_on: string | null; report_summary: string | null; report_at: string | null; closed_at: string | null; closed_by: string | null };
/* AUD-02 · one audit: start (checklist → checks), the checks by section, the open check with the official text, S.A.M.'s hints, result / comment / evidence, finding, report, close. */
// FB-053 · the list shows the precise reference (AMC1 …, (c)) and the question, and an unambiguous short result
const SHORT: Record<string, string> = { conforming: "OK", partial: "Partial", non_conforming: "Not conf.", not_applicable: "N/A", not_covered: "Not cov." };
export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Sp> }) {
  const { id } = await params; const sp = await searchParams;
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data: ad } = await db.from("audits").select("*").eq("id", id).maybeSingle();
  if (!ad) notFound();
  const a = ad as A;
  if (!s.group && !s.entities.includes(a.entity)) notFound();
  const desk = s.role === "cmm" || s.roles.map(basePost).includes("CMM");
  const me = s.person?.id ?? null;
  const team = desk || a.lead_auditor === me || (!!me && a.auditors.includes(me));
  const [{ data: cd }, { data: ppl }, { data: ev }, { data: cls }, { data: fnd }] = await Promise.all([
    db.from("audit_checks").select("*").eq("audit_id", a.id).order("ord").limit(5000),
    db.from("people").select("id,display_name").limit(500),
    db.from("audit_events").select("*").eq("audit_id", a.id).order("at", { ascending: false }).limit(50),
    db.from("checklists").select("*").eq("entity", a.entity).eq("active", true).order("code"),
    db.from("findings").select("id,number,title,status,level,check_id").eq("audit_id", a.id),
  ]);
  const checks = (cd ?? []) as Check[]; const people = (ppl ?? []) as { id: string; display_name: string }[];
  const name = (pid: string | null) => people.find((p) => p.id === pid)?.display_name ?? "—";
  const findings = (fnd ?? []) as { id: string; number: string; title: string; status: string; level: string; check_id: string | null }[];
  const b = breakdown(checks);
  const open = checks.find((c) => c.id === sp.c) ?? checks.find((c) => !c.result) ?? checks[0] ?? null;
  const text = open ? await textFor(db, open) : [];
  const hist = open && ruleCodesIn(open.code).length ? await history(db, a.entity, open.code, a.id) : { previous: [], findings: [] };
  const help = open && a.status !== "planned" ? await hintsFor(db, a.entity, open, text, hist.previous) : { hints: null, citations: [] };
  const sections = [...new Set(checks.map((c) => c.section ?? "Checks"))];
  const idx = open ? checks.indexOf(open) : -1;
  const prevC = idx > 0 ? checks[idx - 1] : null, nextC = idx >= 0 && idx < checks.length - 1 ? checks[idx + 1] : null;
  const checklists = (cls ?? []) as Checklist[];
  const { data: ar } = a.lead_auditor ? await db.from("auditors").select("*").eq("person_id", a.lead_auditor).maybeSingle() : { data: null };
  const elig = a.lead_auditor && a.kind !== "authority" ? eligibility(ar as Auditor | null, a.entity, a.domain) : { ok: true, why: [] as string[] };
  const live = ["in_progress", "report"].includes(a.status) && team;
  return (
    <>
      <PageHeader eyebrow={`Compliance · Audits · ${a.entity}`} title={`${a.number} — ${a.title}`}
        sub={`${ENT[a.entity]?.name ?? a.entity} · ${KIND_LABEL[a.kind]} · planned ${monthLong(a.planned_month)}${a.planned_on ? ` · ${a.planned_on}${a.planned_end ? ` → ${a.planned_end}` : ""}` : ""} · ${a.lead_auditor ? `lead auditor ${name(a.lead_auditor)}` : a.external_auditor ?? "no auditor named"}${a.auditors.length ? ` · with ${a.auditors.map(name).join(", ")}` : ""}${a.scope ? ` · ${a.scope}` : ""}`}
        tag={<span className={"pill " + (a.status === "closed" ? "green" : a.status === "planned" ? "" : "amber")}>{STATUS_LABEL[a.status]}</span>}
        right={<div className="flex gap-2"><Link className="btn" href="/comp/audits">All audits</Link>{a.status !== "planned" && <a className="btn" href={`/print/audit/${a.id}?auto=1`} target="_blank" rel="noreferrer">PDF report</a>}{a.programme_id && <Link className="btn" href={`/comp/prog/${a.programme_id}`}>Programme</Link>}
          {a.status === "planned" && team && <form action={startAudit} className="flex gap-2"><input type="hidden" name="id" value={a.id} />
            <select name="checklist" className="inp" defaultValue={a.checklist_id ?? ""}><option value="">no checklist (free audit)</option>{checklists.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select>{!elig.ok && desk && <input name="override" className="inp" placeholder="Override reason (lead not eligible)" style={{ width: 220 }} />}<button className="btn primary">Start the audit</button></form>}
          {a.status === "in_progress" && team && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn primary">Close the checks → report</summary>
            <form action={reportAudit} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 460, zIndex: 5 }}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="report" />
              <p className="mini">{b.done} / {b.total} checks have a result{b.done < b.total ? ` — ${b.total - b.done} missing` : ""}. The report freezes the results; findings keep their own life.</p>
              <label><span className="mini">Conclusion of the audit</span><textarea name="summary" className="inp" rows={5} defaultValue={a.report_summary ?? ""} placeholder="Overall picture, strong points, what the findings cover, follow-up expected…" /></label>
              <div className="flex justify-end"><button className="btn primary sm" disabled={b.done < b.total}>Issue the report</button></div></form></details>}
          {a.status === "report" && desk && <form action={reportAudit}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="closed" /><button className="btn primary">Close the audit</button></form>}
          {a.status === "closed" && desk && <form action={reopenAudit}><input type="hidden" name="id" value={a.id} /><button className="btn">Reopen</button></form>}</div>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Completion" value={`${b.pct} %`} hint={`${b.done} / ${b.total} checks`} tone={b.total && b.done === b.total ? "green" : undefined} />
        <Metric label="Conforming" value={b.conforming} hint={`${b.partial} partially`} tone={b.conforming ? "green" : undefined} />
        <Metric label="Not conforming" value={b.non_conforming} hint={`${findings.length} finding${findings.length === 1 ? "" : "s"} raised`} tone={b.non_conforming ? "red" : undefined} />
        <Metric label="N/A · not covered" value={`${b.not_applicable} · ${b.not_covered}`} />
      </div>
      {!elig.ok && <section className="card mb-4" style={{ borderColor: "var(--amber)" }}><div className="cb mini" style={{ color: "#8a5a00" }}>Lead auditor {name(a.lead_auditor)}: {elig.why.join(", ")} — <Link href="/comp/auditors">Internal auditors</Link>.</div></section>}
      {a.status === "planned" && <section className="card mb-4"><div className="cb mini">{team ? "Pick the checklist and start: its items become the checks of this audit, with the official text of the rules in the version loaded today." : "Not started yet."}{!checklists.length && desk ? <> No checklist for {a.entity} yet — create one from the programme (module › checklist).</> : null}</div></section>}
      {a.report_summary && <section className="card mb-4"><div className="ch"><span className="eyebrow">Report</span><span className="mini">{a.report_at ? `issued ${a.report_at.slice(0, 10)}` : ""}{a.closed_at ? ` · closed ${a.closed_at.slice(0, 10)} by ${name(a.closed_by)}` : ""}</span></div><div className="cb" style={{ whiteSpace: "pre-wrap" }}>{a.report_summary}</div></section>}

      {checks.length > 0 && <div className="grid gap-4" style={{ gridTemplateColumns: "340px 1fr" }}>
        <div>{sections.map((sec) => <section key={sec} className="card mb-3"><div className="ch"><span className="eyebrow">{sec}</span><span className="mini">{checks.filter((c) => (c.section ?? "Checks") === sec && c.result).length}/{checks.filter((c) => (c.section ?? "Checks") === sec).length}</span></div>
          <div className="cb" style={{ padding: 0 }}>{checks.filter((c) => (c.section ?? "Checks") === sec).map((c) => <Link key={c.id} href={`/comp/audits/${a.id}?c=${c.id}#check`} className={"achk" + (open?.id === c.id ? " on" : "")}><span className={"dot " + (RESULT_TONE[c.result ?? ""] || (c.result ? "grey" : "none"))} /><span className="chk-txt"><span className="mono">{c.ref && c.ref !== c.code ? c.ref : c.code}</span>{c.question && <span className="chk-q">{c.question.slice(0, 70)}{c.question.length > 70 ? "…" : ""}</span>}</span><span className="mini chk-res" style={{ marginLeft: "auto" }}>{c.finding_id ? "FND" : c.result ? SHORT[c.result] ?? RESULT_LABEL[c.result] : ""}</span></Link>)}</div></section>)}
          {live && <details className="card"><summary className="ch"><span className="eyebrow">+ Add a check</span></summary><form action={addCheck} className="cb grid gap-2"><input type="hidden" name="audit" value={a.id} /><input name="code" className="inp mono" placeholder="ORO.FC.230 or C1-06" required /><input name="question" className="inp" placeholder="What is checked (optional)" /><div className="flex justify-end"><button className="btn sm">Add</button></div></form></details>}
        </div>

        {open && <div id="check">
          <section className="card mb-3"><div className="ch"><span><b className="mono">{open.code}</b>{open.ref ? <span className="mono"> {open.ref}</span> : ""} {text.find((t) => t.kind === "ir")?.title ? `— ${text.find((t) => t.kind === "ir")!.title}` : ""}<div className="mini">{open.section}{open.version ? ` · ${open.version}` : ""} · check {idx + 1} / {checks.length}</div></span>
            <span className="flex gap-2">{prevC && <Link className="btn sm" href={`/comp/audits/${a.id}?c=${prevC.id}#check`}>‹ Previous</Link>}{nextC && <Link className="btn sm" href={`/comp/audits/${a.id}?c=${nextC.id}#check`}>Next ›</Link>}</span></div>
            {(open.question || open.guidance) && <div className="cb" style={{ borderBottom: "1px solid var(--line)" }}>{open.question && <p><b>{open.question}</b></p>}{open.guidance && <p className="mini">House guidance: {open.guidance}</p>}</div>}
            <div className="cb">
              {live ? <form action={setCheck} className="grid gap-2" key={open.id}><input type="hidden" name="id" value={open.id} />
                <div className="flex gap-2" style={{ flexWrap: "wrap" }}>{RESULTS.map((r) => <label key={r} className={"radio-pill " + (RESULT_TONE[r] || "grey")}><input type="radio" name="result" value={r} defaultChecked={open.result === r} /> {RESULT_LABEL[r]}</label>)}</div>
                <textarea name="comment" className="inp" rows={3} defaultValue={open.comment ?? ""} placeholder="What was seen, sampled, who was asked; reference of the evidence…" />
                <div className="flex items-center gap-3"><input type="file" name="file" className="mini" /><button className="btn primary sm" style={{ marginLeft: "auto" }}>Save</button></div>
              </form> : <div><span className={"pill " + (RESULT_TONE[open.result ?? ""] ?? "")}>{open.result ? RESULT_LABEL[open.result] : "no result"}</span>{open.comment && <p className="mt-2" style={{ whiteSpace: "pre-wrap" }}>{open.comment}</p>}</div>}
              {open.evidence.length > 0 && <div className="mini mt-2">Evidence: {open.evidence.map((e, i) => <a key={i} href={`/api/files/${e.path}`} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>{e.name}</a>)}</div>}
              {open.checked_at && <div className="mini mt-1">Result by {name(open.checked_by)} · {open.checked_at.slice(0, 16).replace("T", " ")} UTC</div>}
              {open.imported && <div className="mini mt-1">Imported from Centrik as read: {String((open.imported as { result?: string }).result ?? "")}{(open.imported as { comment?: string }).comment ? ` — ${(open.imported as { comment: string }).comment}` : ""}</div>}
              <div className="flex items-center gap-2 mt-3" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                {open.finding_id ? <Link className="btn sm" href={`/comp/find/${open.finding_id}`}>Finding {findings.find((f) => f.id === open.finding_id)?.number ?? ""} ›</Link>
                  : live && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn sm">Raise a finding</summary>
                    <form action={raiseFinding} className="card cb grid gap-2" style={{ position: "absolute", left: 0, top: 30, width: 520, zIndex: 5 }}><input type="hidden" name="check" value={open.id} />
                      <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={`${open.code} — `} required /></label>
                      <label><span className="mini">The finding as written by the auditor</span><textarea name="description" className="inp" rows={3} defaultValue={open.comment ?? ""} /></label>
                      <div className="grid grid-cols-3 gap-2"><label><span className="mini">Level</span><select name="level" className="inp" defaultValue="2">{Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                        <label><span className="mini">Category</span><select name="category" className="inp" defaultValue=""><option value="">—</option>{["Flight Ops", "Ground Ops", "Engineering", "Aircraft", "AOC", "Manuals", "Airport", "Training", "Other"].map((x) => <option key={x}>{x}</option>)}</select></label>
                        <label><span className="mini">Cause</span><select name="cause" className="inp" defaultValue=""><option value="">—</option>{["One-off", "General practice", "Manuals", "Other"].map((x) => <option key={x}>{x}</option>)}</select></label></div>
                      <div className="grid grid-cols-3 gap-2"><label><span className="mini">Answers — post</span><input name="owner_role" className="inp mono" placeholder="NPFO, NPCA…" /></label><label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue=""><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label><label><span className="mini">Answer due</span><input type="date" name="due" className="inp" /></label></div>
                      <div className="flex justify-end"><button className="btn primary sm">Create the finding</button></div></form></details>}
                <span className="mini" style={{ marginLeft: "auto" }}>Result given by the auditor; S.A.M. only shows the text and where to look.</span>
              </div>
            </div></section>

          <section className="card mb-3"><div className="ch"><span className="eyebrow">Where to look · S.A.M.</span>{live && <form action={refreshHints}><input type="hidden" name="check" value={open.id} /><button className="btn sm">Read again</button></form>}</div>
            <div className="cb grid gap-2">
              {help.citations.length > 0 && <div><div className="mini" style={{ fontWeight: 700 }}>Our manuals cite {open.code}</div>{help.citations.slice(0, 8).map((c, i) => <div key={i} className="mini"><b>{c.code}</b> {c.ref} {c.section_title ? `— ${c.section_title}` : ""} <span style={{ color: "var(--slate5)" }}>{c.snippet.slice(0, 160)}</span></div>)}</div>}
              {help.hints && <>
                {help.hints.chapters.length > 0 && <div><div className="mini" style={{ fontWeight: 700 }}>Chapters to open</div>{help.hints.chapters.map((c, i) => <div key={i} className="mini"><b>{c.manual}</b> {c.ref} — {c.why}</div>)}</div>}
                {help.hints.evidence.length > 0 && <div><div className="mini" style={{ fontWeight: 700 }}>Typical evidence</div><ul className="mini" style={{ margin: 0, paddingLeft: 18 }}>{help.hints.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                {help.hints.ask.length > 0 && <div><div className="mini" style={{ fontWeight: 700 }}>To ask or sample</div><ul className="mini" style={{ margin: 0, paddingLeft: 18 }}>{help.hints.ask.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                <div className="mini" style={{ color: "var(--slate5)" }}>Suggestions by S.A.M. ({help.hints.at.slice(0, 10)}) — a help to look, not an assessment.</div></>}
              {!help.hints && !help.citations.length && <div className="mini">{a.status === "planned" ? "Hints appear once the audit is started." : "No chapter of our manuals cites this rule and no suggestion is available yet."}</div>}
              {(hist.previous.length > 0 || hist.findings.length > 0) && <div><div className="mini" style={{ fontWeight: 700 }}>Last time on this rule</div>{hist.previous.map((p, i) => <div key={i} className="mini"><span className={"pill " + (RESULT_TONE[p.result] ?? "")}>{RESULT_LABEL[p.result] ?? p.result}</span> {p.audit?.number} {p.audit?.title}{p.comment ? ` — ${p.comment.slice(0, 160)}` : ""}</div>)}{hist.findings.map((f) => <div key={f.id} className="mini"><Link href={`/comp/find/${f.id}`}><b className="mono">{f.number}</b> {f.title}</Link> · {f.status}</div>)}</div>}
            </div></section>

          {text.length > 0 ? <RuleText items={text} version={open.version ?? ""} compact /> : <section className="card"><div className="cb mini">No official text loaded for {open.code}{open.regulation_id ? "" : " (no EAR linked to this item)"}. <Link href="/reg/ear">Regulation</Link></div></section>}
        </div>}
      </div>}

      {findings.length > 0 && <section className="card mt-4"><div className="ch"><span className="eyebrow">Findings of this audit · {findings.length}</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{findings.map((f) => <tr key={f.id}><td><Link href={`/comp/find/${f.id}`}><b className="mono">{f.number}</b> {f.title}</Link></td><td>{LEVEL_LABEL[f.level] ?? f.level}</td><td className="mini">{f.status}</td></tr>)}</tbody></table></div></section>}
      {(ev ?? []).length > 0 && <details className="card mt-4"><summary className="ch"><span className="eyebrow">History</span></summary><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{((ev ?? []) as AuditEvent[]).map((e) => <tr key={e.id}><td className="mono mini">{e.at.slice(0, 16).replace("T", " ")}</td><td>{e.kind === "status" ? `Status → ${STATUS_LABEL[e.status ?? ""] ?? e.status}` : e.kind === "replanned" ? `Moved ${e.from_month ? monthLong(e.from_month) : ""} → ${e.to_month ? monthLong(e.to_month) : ""}` : e.kind}{e.reason ? <div className="mini">{e.reason}</div> : null}</td><td className="mini">{name(e.by)}</td></tr>)}</tbody></table></div></details>}
      <p className="mini mt-3"><span className="entdot" style={{ background: ENT_COLOR[a.entity] ?? "#888" }} />{a.entity} · PRO-CM-02</p>
    </>
  );
}
