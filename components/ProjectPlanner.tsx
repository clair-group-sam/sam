"use client";
import { useState } from "react";
import { proposePlan, createFromPlan } from "@/app/(app)/proj/boards/plan/actions";
import type { Plan, PlanResult } from "@/lib/project-plan";
import { Icon } from "@/lib/icons";
import { Metric } from "@/components/Page";
import SamBusy from "@/components/SamBusy";

const LINK: Record<string, string> = { manual: "Manual revision", authority_file: "CAA application", certificate: "Certificate", moc: "MOC / risk assessment" };

/** Plan with S.A.M.: brief → research → proposal to tick and adjust → project. Nothing exists in S.A.M. until "Create the project". */
export default function ProjectPlanner({ entity: ent0, entities }: { entity: string; entities: [string, string][] }) {
  const [entity, setEntity] = useState(ent0);
  const [title, setTitle] = useState(""); const [goal, setGoal] = useState(""); const [context, setContext] = useState("");
  const [target, setTarget] = useState(""); const [owner, setOwner] = useState("CMM"); const [mine, setMine] = useState(false); const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState<"" | "plan" | "rework" | "create">(""); const [err, setErr] = useState("");
  const [res, setRes] = useState<PlanResult | null>(null); const [plan, setPlan] = useState<Plan | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set()); const [feedback, setFeedback] = useState(""); const [answers, setAnswers] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<Record<string, { v: "ok" | "no" | "change"; text: string }>>({});
  const brief = { entity, title, goal, context, target, web };

  const given = plan ? plan.questions.filter((q) => (answers[q] ?? "").trim()) : [];
  const changed = plan ? plan.assumptions.filter((a) => verdict[a] && verdict[a].v !== "ok") : [];
  async function run(again: boolean) {
    if (busy) return; setBusy(again ? "rework" : "plan"); setErr("");
    const ok = plan ? plan.assumptions.filter((a) => verdict[a]?.v === "ok") : [];
    const fb = again ? [
      given.length ? `Answers of the owner: ${given.map((q) => `${q} → ${answers[q].trim()}`).join(" | ")}. Take them as settled: remove these questions and adapt the tasks.` : "",
      ok.length ? `Assumptions confirmed by the owner (now facts, do not list them as assumptions any more): ${ok.join(" | ")}` : "",
      changed.length ? `Assumptions the owner rejects or corrects (rebuild the tasks that relied on them): ${changed.map((a) => `"${a}" is ${verdict[a].v === "no" ? "NOT true" : "to change"}${verdict[a].text.trim() ? `; what is true: ${verdict[a].text.trim()}` : ""}`).join(" | ")}` : "",
      feedback.trim()].filter(Boolean).join("\n") : undefined;
    const r = await proposePlan({ ...brief, previous: again ? plan : null, feedback: fb }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "The research took too long. Ask again." }));
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setRes(r.r); setPlan(r.r.plan); setKeep(new Set(r.r.plan.tasks.map((t) => t.key))); setFeedback("");
    setAnswers((a) => Object.fromEntries(r.r.plan.questions.filter((q) => a[q]).map((q) => [q, a[q]])));
    setVerdict((v) => Object.fromEntries(r.r.plan.assumptions.filter((x) => v[x]?.v === "ok").map((x) => [x, v[x]])));
  }
  async function create() {
    if (busy || !plan) return; setBusy("create"); setErr("");
    const r = await createFromPlan({ ...brief, plan, keep: [...keep], answers, verdicts: Object.fromEntries(Object.entries(verdict).map(([a, x]) => [a, x.v === "ok" ? "confirmed" : `${x.v === "no" ? "rejected" : "changed"}${x.text.trim() ? `: ${x.text.trim()}` : ""}`])), owner_role: owner, owner_me: mine, sources: res?.sources, model: res?.model }).catch(() => null);
    if (r && !r.ok) { setErr(r.error); setBusy(""); } // on success the action redirects to the project
  }
  const toggle = (k: string) => setKeep((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const edit = (k: string, patch: { owner_role?: string; days?: number | null }) => setPlan((p) => p && { ...p, tasks: p.tasks.map((t) => (t.key === k ? { ...t, ...patch } : t)) });
  const titleOf = (k: string) => plan?.tasks.find((t) => t.key === k)?.title ?? k;
  // critical path of what is kept: the longest chain of dependent tasks, in days (computed here, not taken from the model)
  const kept = plan ? plan.tasks.filter((t) => keep.has(t.key)) : [];
  const crit = (() => {
    const by = new Map(kept.map((t) => [t.key, t])); const memo = new Map<string, { d: number; prev: string | null }>();
    const ef = (k: string, seen: Set<string>): { d: number; prev: string | null } => {
      const m = memo.get(k); if (m) return m; const t = by.get(k)!; let best = 0, prev: string | null = null;
      if (!seen.has(k)) { seen.add(k); for (const d of t.deps ?? []) if (by.has(d)) { const x = ef(d, seen).d; if (x >= best) { best = x; prev = d; } } }
      const r = { d: best + (t.days ?? 0), prev }; memo.set(k, r); return r;
    };
    let end: string | null = null, total = 0; for (const t of kept) { const x = ef(t.key, new Set()).d; if (x > total) { total = x; end = t.key; } }
    const chain: string[] = []; for (let k = end; k; k = memo.get(k)?.prev ?? null) chain.unshift(k);
    return { total, chain };
  })();
  const rules = kept.flatMap((t) => t.rules ?? []); const rulesOk = rules.filter((r) => r.found).length;
  const unknowns = kept.filter((t) => t.unknown);
  const finish = crit.total ? new Date(Date.now() + crit.total * 86_400_000).toISOString().slice(0, 10) : "";
  const fr = (d: string) => d.split("-").reverse().join("/");
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
            <button className="btn primary ml-auto" type="submit" disabled={!!busy || title.trim().length < 4 || goal.trim().length < 20}>{busy === "plan" ? <><SamBusy entity={entity} />Researching…</> : plan ? "Start the research again" : "Research and propose a plan"}</button>
          </div>
          {(busy === "plan" || busy === "rework") && <div className="samwait" role="status"><SamBusy entity={entity} size={64} /><span><b>{busy === "rework" ? "S.A.M. is reworking the plan." : "S.A.M. is researching."}</b><span className="mini block">Its own records first (posts, manuals, application types, templates, lessons learned), then official sources on the web. One to two minutes; you can keep this page open and wait.</span></span></div>}
          {err && <p className="mini red">{err}</p>}
        </form>
      </section>

      {plan && res && (
        <>
          <section className="card">
            <div className="ch"><span className="eyebrow"><Icon name="bulb" size={14} /> The plan in short</span><span className="mini">{res.model}</span></div>
            <div className="cb grid gap-4">
              <p style={{ maxWidth: "76ch", fontSize: 15 }}>{plan.summary}</p>
              <div className="grid grid-cols-4 gap-3">
                <Metric label="Shortest duration" value={crit.total ? `${crit.total} days` : "—"} tone={target && finish && finish > target ? "red" : "info"} hint={finish ? `earliest end ${fr(finish)}${target ? (finish > target ? `, after your target ${fr(target)}` : `, within your target ${fr(target)}`) : ""}` : "no duration given"} />
                <Metric label="Tasks kept" value={`${kept.length} / ${plan.tasks.length}`} hint={`${plan.phases.length} phases`} />
                <Metric label="Rules cited" value={rules.length ? `${rulesOk} / ${rules.length}` : "0"} tone={rules.length && rulesOk < rules.length ? "amber" : rules.length ? "green" : "none"} hint={rules.length ? (rulesOk < rules.length ? "some are not in the EARs loaded: check them" : "all found in the EARs loaded in S.A.M.") : "no EASA rule cited"} />
                <Metric label="To find out outside" value={unknowns.length} tone={unknowns.length ? "amber" : "none"} hint={unknowns.length ? "already in the plan as tasks" : "nothing left to ask outside"} />
              </div>
              {crit.chain.length > 1 && <div><div className="eyebrow mb-1">What sets the duration</div><ol className="planpath">{crit.chain.map((k) => { const t = plan.tasks.find((x) => x.key === k)!; return <li key={k}><span>{t.title}</span><span className="mini mono">{t.owner_role ?? ""}{t.days ? `, ${t.days} d` : ""}</span></li>; })}</ol></div>}
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <div className="eyebrow mb-1">Your decisions {plan.questions.length ? `(${given.length} / ${plan.questions.length} answered)` : ""}</div>
                  {plan.questions.length ? <div className="grid gap-2">{plan.questions.map((q) => <label key={q} className="block"><span className="text-[13px]">{q}</span><input className="inp" value={answers[q] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))} maxLength={300} placeholder="Your answer, or leave empty" /></label>)}</div>
                    : <p className="mini">Nothing to decide before starting.</p>}
                </div>
                <div>
                  <div className="eyebrow mb-1">What S.A.M. assumed {plan.assumptions.length ? `(${Object.keys(verdict).filter((a) => plan.assumptions.includes(a)).length} / ${plan.assumptions.length} reviewed)` : ""}</div>
                  {plan.assumptions.length ? <div className="grid gap-2">{plan.assumptions.map((a) => { const cur = verdict[a]; const set = (v: "ok" | "no" | "change") => setVerdict((m) => { const n = { ...m }; if (cur?.v === v) delete n[a]; else n[a] = { v, text: cur?.text ?? "" }; return n; }); return (
                    <div key={a} className="assume">
                      <span className="text-[13px]">{a}</span>
                      <div className="seg" role="group" aria-label="Your verdict on this assumption">
                        <button type="button" className={cur?.v === "ok" ? "on" : ""} aria-pressed={cur?.v === "ok"} onClick={() => set("ok")}>Confirm</button>
                        <button type="button" className={cur?.v === "no" ? "on" : ""} aria-pressed={cur?.v === "no"} onClick={() => set("no")}>Reject</button>
                        <button type="button" className={cur?.v === "change" ? "on" : ""} aria-pressed={cur?.v === "change"} onClick={() => set("change")}>Change</button>
                      </div>
                      {cur && cur.v !== "ok" && <input className="inp" value={cur.text} onChange={(e) => setVerdict((m) => ({ ...m, [a]: { v: cur.v, text: e.target.value } }))} maxLength={300} placeholder={cur.v === "no" ? "What is true instead (optional)" : "What it should be"} />}
                    </div>); })}</div> : <p className="mini">Nothing assumed.</p>}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button className="btn primary" type="button" onClick={() => run(true)} disabled={!!busy || (!given.length && !changed.length)}>{busy === "rework" ? <><SamBusy entity={entity} />Reworking…</> : "Rework the plan with my answers"}</button>
                <span className="mini">{given.length || changed.length ? `${given.length} answer${given.length === 1 ? "" : "s"}, ${changed.length} assumption${changed.length === 1 ? "" : "s"} rejected or changed: the tasks will be rebuilt on them.` : "Answer a decision, or reject or change an assumption, and S.A.M. rebuilds the tasks. Confirmed assumptions are kept as facts."}</span>
              </div>
              {(plan.risks.length > 0 || unknowns.length > 0) && <div className="grid grid-cols-2 gap-5">
                <div>{plan.risks.length > 0 && <><div className="eyebrow mb-1">What could make it slip</div><ul className="pl-5 list-disc text-[13px] grid gap-1">{plan.risks.map((q, i) => <li key={i}>{q}</li>)}</ul></>}</div>
                <div>{unknowns.length > 0 && <><div className="eyebrow mb-1">To find out outside the company</div><ul className="pl-5 list-disc text-[13px] grid gap-1">{unknowns.map((t) => <li key={t.key}>{t.title} <span className="mini mono">{t.owner_role ?? ""}</span></li>)}</ul></>}</div>
              </div>}
              {res.webNote && <p className="mini red">{res.webNote}</p>}
              <details><summary className="mini underline cursor-pointer">How S.A.M. got there: {res.context}{res.searches ? `, ${res.searches} web search${res.searches === 1 ? "" : "es"}, ${res.sources.length} pages read` : ", no web search"}</summary>
                <div className="mt-3"><div className="eyebrow mb-1">Pages read on the web</div>{res.sources.length ? <ul className="pl-5 list-disc text-[13px] grid gap-1" style={{ maxHeight: 220, overflowY: "auto" }}>{res.sources.map((x) => <li key={x.url}><a className="underline" href={x.url} target="_blank" rel="noreferrer">{x.title}</a></li>)}</ul> : <p className="mini">None.</p>}</div>
                <p className="mini mt-2">S.A.M. can be wrong. A rule marked "in the EAR" was found in the Easy Access Rules loaded in S.A.M.; "to check" means it was not: read it before relying on the task.</p>
              </details>
            </div>
          </section>

          {plan.phases.map((ph) => { const list = plan.tasks.filter((t) => t.phase === ph.key); if (!list.length) return null; return (
            <section key={ph.key} className="card">
              <div className="ch"><span className="eyebrow">{ph.label}</span><span className="mini">{list.filter((t) => keep.has(t.key)).length} / {list.length} kept</span></div>
              <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th style={{ width: 36 }}></th><th>Task</th><th style={{ width: 118 }}>Post</th><th style={{ width: 88 }}>Days</th><th style={{ width: "24%" }}>After</th></tr></thead><tbody>
                {list.map((t) => { const on = keep.has(t.key); return (
                  <tr key={t.key} style={on ? undefined : { opacity: 0.45 }}>
                    <td><input type="checkbox" checked={on} onChange={() => toggle(t.key)} aria-label={`Keep: ${t.title}`} /></td>
                    <td><b>{t.title}</b>{t.detail && <div className="mini">{t.detail}</div>}
                      <div className="mini mt-1 flex gap-2 flex-wrap items-center">
                        {t.unknown && <span className="pill amber">to find out</span>}
                        {t.link_kind && <span className="pill">{LINK[t.link_kind]}{t.link_ref ? ` ${t.link_ref}` : ""}</span>}
                        {t.basis && <span>{t.basis}</span>}
                        {(t.rules ?? []).map((r) => <span key={r.code} className={"pill " + (r.found ? "green" : "amber")}>{r.code} {r.found ? "in the EAR" : "to check"}</span>)}
                        {(t.flags ?? []).map((f) => <span key={f} className="pill amber">{f}</span>)}
                      </div></td>
                    <td><input className="inp mono plancell" value={t.owner_role ?? ""} onChange={(e) => edit(t.key, { owner_role: e.target.value.toUpperCase() })} aria-label="Post" /></td>
                    <td><input className="inp mono plancell" inputMode="numeric" maxLength={3} value={t.days ?? ""} onChange={(e) => { const n = e.target.value.replace(/\D/g, ""); edit(t.key, { days: n ? Number(n) : null }); }} aria-label="Days" /></td>
                    <td className="mini">{(t.deps ?? []).map((d) => <div key={d} style={keep.has(d) ? undefined : { textDecoration: "line-through" }}>{titleOf(d)}</div>)}</td>
                  </tr>); })}
              </tbody></table></div>
            </section>); })}

          <section className="card">
            <div className="ch"><span className="eyebrow">Adjust or create</span><span className="mini">{keep.size} of {plan.tasks.length} tasks kept</span></div>
            <div className="cb grid gap-3">
              <div className="flex gap-2 items-end">
                <label className="grow"><span className="mini">Ask S.A.M. to change the plan</span><input className="inp" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} placeholder="e.g. the aircraft stays on the Maltese register; add the crew training; the CAMO part is subcontracted" /></label>
                <button className="btn" type="button" onClick={() => run(true)} disabled={!!busy || feedback.trim().length < 6}>{busy === "rework" ? <><SamBusy entity={entity} />Reworking…</> : "Rework the plan"}</button>
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
