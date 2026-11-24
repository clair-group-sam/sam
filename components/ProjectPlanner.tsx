"use client";
import { useState } from "react";
import { proposePlan, createFromPlan } from "@/app/(app)/proj/boards/plan/actions";
import type { Plan, PlanResult } from "@/lib/project-plan";
import { Icon } from "@/lib/icons";
import { ENT_COLOR } from "@/lib/nav";
import SamBusy from "@/components/SamBusy";

const LINK: Record<string, string> = { manual: "Manual revision", authority_file: "CAA application", certificate: "Certificate", moc: "MOC / risk assessment" };

/** Plan with S.A.M.: brief → research → proposal to tick and adjust → project. Nothing exists in S.A.M. until "Create the project". */
export default function ProjectPlanner({ entity: ent0, entities }: { entity: string; entities: [string, string][] }) {
  const [entity, setEntity] = useState(ent0);
  const [title, setTitle] = useState(""); const [goal, setGoal] = useState(""); const [context, setContext] = useState("");
  const [target, setTarget] = useState(""); const [owner, setOwner] = useState("CMM"); const [mine, setMine] = useState(false); const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState<"" | "plan" | "create">(""); const [err, setErr] = useState("");
  const [res, setRes] = useState<PlanResult | null>(null); const [plan, setPlan] = useState<Plan | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set()); const [feedback, setFeedback] = useState("");
  const brief = { entity, title, goal, context, target, web };

  async function run(again: boolean) {
    if (busy) return; setBusy("plan"); setErr("");
    const r = await proposePlan({ ...brief, previous: again ? plan : null, feedback: again ? feedback : undefined }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "The research took too long. Ask again." }));
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setRes(r.r); setPlan(r.r.plan); setKeep(new Set(r.r.plan.tasks.map((t) => t.key))); setFeedback("");
  }
  async function create() {
    if (busy || !plan) return; setBusy("create"); setErr("");
    const r = await createFromPlan({ ...brief, plan, keep: [...keep], owner_role: owner, owner_me: mine, sources: res?.sources, model: res?.model }).catch(() => null);
    if (r && !r.ok) { setErr(r.error); setBusy(""); } // on success the action redirects to the project
  }
  const toggle = (k: string) => setKeep((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const edit = (k: string, patch: { owner_role?: string; days?: number | null }) => setPlan((p) => p && { ...p, tasks: p.tasks.map((t) => (t.key === k ? { ...t, ...patch } : t)) });
  const titleOf = (k: string) => plan?.tasks.find((t) => t.key === k)?.title ?? k;
  const days = plan ? plan.tasks.filter((t) => keep.has(t.key)).reduce((a, t) => a + (t.days ?? 0), 0) : 0;

  return (
    <div className="grid gap-4">
      <section className="card">
        <div className="ch"><span className="eyebrow">The project</span><span className="mini">nothing is created until you say so</span></div>
        <form className="cb grid gap-3" onSubmit={(e) => { e.preventDefault(); run(false); }}>
          <div className="grid grid-cols-4 gap-3">
            <label className="col-span-2"><span className="mini">Title</span><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="Open a second base in Nice" /></label>
            {entities.length > 1 ? <label><span className="mini">Entity</span><select className="inp" value={entity} onChange={(e) => setEntity(e.target.value)}>{entities.map(([k, l]) => <option key={k} value={k}>{l} ({k})</option>)}</select></label> : <span />}
            <label><span className="mini">Target date</span><input type="date" className="inp" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          </div>
          <label><span className="mini">What it must achieve</span><textarea className="inp" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={3000} required placeholder="What will be true when the project is finished: the approval obtained, the aircraft, base or activity in service, who is concerned." /></label>
          <label><span className="mini">What you already know (optional)</span><textarea className="inp" rows={2} value={context} onChange={(e) => setContext(e.target.value)} maxLength={3000} placeholder="Constraints, what is decided, what the authority already said, suppliers, what is out of scope." /></label>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="mini flex items-center gap-2"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Search official sources on the web (EASA, the authority, the manufacturer)</label>
            <button className="btn primary ml-auto" type="submit" disabled={!!busy || title.trim().length < 4 || goal.trim().length < 20}>{busy === "plan" && !feedback ? <><SamBusy entity={entity} />Researching…</> : plan ? "Start the research again" : "Research and propose a plan"}</button>
          </div>
          {busy === "plan" && <div className="samwait" role="status"><span style={{ color: ENT_COLOR[entity] }}><SamBusy entity={entity} size={30} /></span><span><b>S.A.M. is researching.</b><span className="mini block">Its own records first (posts, manuals, application types, templates, lessons learned), then official sources on the web. One to two minutes; you can keep this page open and wait.</span></span></div>}
          {err && <p className="mini red">{err}</p>}
        </form>
      </section>

      {plan && res && (
        <>
          <section className="card">
            <div className="ch"><span className="eyebrow"><Icon name="bulb" size={14} /> What S.A.M. found</span><span className="mini">{res.context}{res.searches ? `, ${res.searches} web search${res.searches === 1 ? "" : "es"}` : ", no web search"}, {res.model}</span></div>
            <div className="cb grid gap-3">
              <p style={{ maxWidth: "80ch" }}>{plan.summary}</p>
              {res.webNote && <p className="mini red">{res.webNote}</p>}
              <div className="grid grid-cols-2 gap-4">
                {plan.questions.length > 0 && <div><div className="eyebrow mb-1">To settle before relying on the plan</div><ul className="pl-5 list-disc text-[13px] grid gap-1">{plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
                {plan.assumptions.length > 0 && <div><div className="eyebrow mb-1">What S.A.M. assumed</div><ul className="pl-5 list-disc text-[13px] grid gap-1">{plan.assumptions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
              </div>
              {res.sources.length > 0 && <details><summary className="mini underline cursor-pointer">Pages read on the web ({res.sources.length})</summary><ul className="pl-5 list-disc text-[13px] mt-2 grid gap-1">{res.sources.map((x) => <li key={x.url}><a className="underline" href={x.url} target="_blank" rel="noreferrer">{x.title}</a> <span className="mini">{(() => { try { return new URL(x.url).hostname; } catch { return ""; } })()}</span></li>)}</ul></details>}
              <p className="mini">S.A.M. can be wrong. A rule marked "in the EAR" was found in the Easy Access Rules loaded in S.A.M.; "to check" means it was not: read it before relying on the task.</p>
            </div>
          </section>

          {plan.phases.map((ph) => { const list = plan.tasks.filter((t) => t.phase === ph.key); if (!list.length) return null; return (
            <section key={ph.key} className="card">
              <div className="ch"><span className="eyebrow">{ph.label}</span><span className="mini">{list.filter((t) => keep.has(t.key)).length} / {list.length} kept</span></div>
              <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th style={{ width: 36 }}></th><th>Task</th><th style={{ width: 96 }}>Post</th><th style={{ width: 76 }}>Days</th><th style={{ width: "24%" }}>After</th></tr></thead><tbody>
                {list.map((t) => { const on = keep.has(t.key); return (
                  <tr key={t.key} style={on ? undefined : { opacity: 0.45 }}>
                    <td><input type="checkbox" checked={on} onChange={() => toggle(t.key)} aria-label={`Keep: ${t.title}`} /></td>
                    <td><b>{t.title}</b>{t.detail && <div className="mini">{t.detail}</div>}
                      <div className="mini mt-1 flex gap-2 flex-wrap items-center">
                        {t.link_kind && <span className="pill">{LINK[t.link_kind]}{t.link_ref ? ` ${t.link_ref}` : ""}</span>}
                        {t.basis && <span>{t.basis}</span>}
                        {(t.rules ?? []).map((r) => <span key={r.code} className={"pill " + (r.found ? "green" : "amber")}>{r.code} {r.found ? "in the EAR" : "to check"}</span>)}
                        {(t.flags ?? []).map((f) => <span key={f} className="pill amber">{f}</span>)}
                      </div></td>
                    <td><input className="inp mono" value={t.owner_role ?? ""} onChange={(e) => edit(t.key, { owner_role: e.target.value.toUpperCase() })} aria-label="Post" /></td>
                    <td><input className="inp mono" type="number" min={0} value={t.days ?? ""} onChange={(e) => edit(t.key, { days: e.target.value ? Number(e.target.value) : null })} aria-label="Days" /></td>
                    <td className="mini">{(t.deps ?? []).map((d) => <div key={d} style={keep.has(d) ? undefined : { textDecoration: "line-through" }}>{titleOf(d)}</div>)}</td>
                  </tr>); })}
              </tbody></table></div>
            </section>); })}

          <section className="card">
            <div className="ch"><span className="eyebrow">Adjust or create</span><span className="mini">{keep.size} of {plan.tasks.length} tasks kept, {days} days of work in total</span></div>
            <div className="cb grid gap-3">
              <div className="flex gap-2 items-end">
                <label className="grow"><span className="mini">Ask S.A.M. to change the plan</span><input className="inp" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} placeholder="e.g. the aircraft stays on the Maltese register; add the crew training; the CAMO part is subcontracted" /></label>
                <button className="btn" type="button" onClick={() => run(true)} disabled={!!busy || feedback.trim().length < 6}>{busy === "plan" && feedback ? <><SamBusy entity={entity} />Reworking…</> : "Rework the plan"}</button>
              </div>
              <div className="flex gap-3 items-end flex-wrap">
                <label><span className="mini">Owner post</span><input className="inp mono" style={{ width: 110 }} value={owner} onChange={(e) => setOwner(e.target.value.toUpperCase())} /></label>
                <label className="mini flex items-center gap-2 mb-2"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> I am the owner (by name)</label>
                <button className="btn primary ml-auto" type="button" onClick={create} disabled={!!busy || !keep.size}>{busy === "create" ? "Creating…" : `Create the project with ${keep.size} task${keep.size === 1 ? "" : "s"}`}</button>
              </div>
              <p className="mini">Tasks reach their posts' Inbox once the project exists. Everything stays editable in the project; the research (sources, questions, what was dropped) is kept in the audit log.</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
