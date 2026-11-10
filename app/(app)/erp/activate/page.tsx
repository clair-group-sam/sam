import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { closeActivation, logEvent, mayActivate, startActivation, tickAction } from "../actions";
import { INFO, SCENARIOS, after, appliesTo } from "@/lib/erp";
import { ErpStartBar } from "@/components/ErpStartBar";

type Act = { id: string; entity: string; plan_id: string | null; exercise: boolean; level: string; scenario: string; info: Record<string, string> | null; is_incident: string | null; teams_chat_url: string | null; title: string; started_at: string; started_by: string | null; status: string; closed_at: string | null; summary: string | null };
type Ev = { id: number; at: string; person_id: string | null; kind: string; text: string; ref: string | null };
type Cl = { id: string; code: string | null; title: string; phase: string; owner_role: string | null; applies: string; items: string };
type Ms = { id: string; label: string; minutes: number; owner_role: string | null; applies: string; source: string | null };
type Pl = { id: string; title: string; code: string | null; cell_safety: string | null; cell_security: string | null; deputy_rule: string | null; location: string | null };
type Ct = { id: string; crisis_role: string; kind: string; post: string | null; name: string | null; organisation: string | null; phone: string | null; email: string | null; available: string | null };
const hm = (d: string) => new Date(d).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const day = (d: string) => d.slice(0, 10).split("-").reverse().join("/");

/* ERP · Activation mode: one screen for the crisis cell. Start, then log every decision and call, tick the checklists (each tick is timed), close with a summary. */
export default async function Activation() {
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  let aq = db.from("erp_activations").select("*").order("started_at", { ascending: false }).limit(20);
  if (scope) aq = aq.in("entity", scope);
  const { data: ad } = await aq; const acts = (ad ?? []) as Act[];
  const open = acts.find((a) => a.status === "open") ?? null;
  const can = await mayActivate(s);
  const ents = (scope ?? ENTS4).filter((e) => s.group || s.entities.includes(e));
  const ent = open?.entity ?? ents[0];
  const [{ data: pd }, { data: cd }, { data: kd }, { data: ed }, { data: ppl }, { data: md }, { data: npd }, { data: acd }] = await Promise.all([
    db.from("erp_plans").select("id,title,code,cell_safety,cell_security,deputy_rule,location").eq("entity", ent).eq("active", true).order("code"),
    db.from("erp_checklists").select("id,code,title,phase,owner_role,applies,items").eq("entity", ent).eq("active", true).order("ord").order("title"),
    db.from("erp_contacts").select("id,crisis_role,kind,post,name,organisation,phone,email,available").eq("entity", ent).eq("active", true).order("ord"),
    open ? db.from("erp_events").select("*").eq("activation_id", open.id).order("at", { ascending: false }) : Promise.resolve({ data: [] }),
    db.from("people").select("id,display_name"),
    db.from("erp_milestones").select("id,label,minutes,owner_role,applies,source").eq("entity", ent).eq("active", true).order("minutes").order("ord"),
    db.from("np_posts").select("code,holder_name,deputy_name").eq("entity", ent),
    db.from("aircraft").select("registration").eq("entity", ent).order("registration"),
  ]);
  const plans = (pd ?? []) as Pl[];
  const scen = open?.scenario ?? "safety";
  const lists = ((cd ?? []) as Cl[]).filter((c) => !open || appliesTo(c.applies, scen));
  const miles = ((md ?? []) as Ms[]).filter((m) => !open || appliesTo(m.applies, scen));
  const holders = new Map(((npd ?? []) as { code: string; holder_name: string | null; deputy_name: string | null }[]).map((x) => [x.code.toUpperCase(), x]));
  const contacts = ((kd ?? []) as Ct[]).map((c) => { const h = c.post ? holders.get(c.post.toUpperCase()) : undefined; return h?.holder_name ? { ...c, name: h.holder_name } : c; });
  const events = (ed ?? []) as Ev[];
  const regs = ((acd ?? []) as { registration: string }[]).map((a) => a.registration);
  const plan = plans.find((p) => p.id === open?.plan_id) ?? plans[0];
  const P = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const ticked = new Map(events.filter((e) => e.kind === "check" && e.ref).map((e) => [e.ref!, e]));
  const now = Date.now();
  return (
    <>
      <PageHeader right={<Link className="btn" href={`/print/erp/${ent}`} target="_blank">Print the ERP binder</Link>} eyebrow="ERP, Activation mode" title={open ? (open.exercise ? "Exercise in progress" : open.level === "activation" ? "ERP activated" : "Alert raised") : "Activation mode"}
        sub={open ? `${ENT[open.entity]?.name ?? open.entity}, since ${day(open.started_at)} ${hm(open.started_at)}: ${open.title}` : "Raise an alert or activate the emergency response plan. The response unit of the plan gets an Inbox item and a Teams card at once; the response times start, every action is logged and timed."} />
      {open ? (
        <div className="erp-live grid gap-4" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
          <div className="grid gap-4" style={{ alignContent: "start" }}>
            <section className={"card erp-banner" + (open.exercise ? " ex" : "")}><div className="cb">
              <b>{open.exercise ? "EXERCISE, NOT A REAL EVENT" : open.level === "activation" ? "ERP ACTIVATED" : "ALERT"}</b>
              <span>{open.title}</span>
              <span className="mini">{SCENARIOS.find(([k]) => k === open.scenario)?.[1]}{plan ? `. Unit: ${(open.scenario === "security" || open.scenario === "cyber" ? plan.cell_security : plan.cell_safety) ?? "AM, SM, CMM"}` : ""}{plan?.location ? `. ${plan.location}` : ""}</span>
              {open.teams_chat_url && <a className="mini underline" href={open.teams_chat_url} target="_blank" rel="noreferrer">Open the crisis chat in Teams</a>}
              {open.is_incident && <Link className="mini underline" href={`/is/inc?open=${open.is_incident}#edit`}>Part-IS event opened</Link>}
            </div></section>
            {can && <section className="card"><div className="ch"><span className="eyebrow">Log</span><span className="mini">every entry is timed and kept</span></div><div className="cb">
              <form action={logEvent} className="grid gap-2" style={{ gridTemplateColumns: "130px minmax(0,1fr) auto" }}><input type="hidden" name="id" value={open.id} />
                <select name="kind" className="inp" aria-label="Kind"><option value="log">Fact</option><option value="decision">Decision</option><option value="contact">Call, contact</option></select>
                <input name="text" className="inp" placeholder="What happened, what was decided, who was called" aria-label="Log entry" required />
                <button className="btn primary" type="submit">Log</button></form></div></section>}
            <section className="card"><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
              {events.map((e) => <tr key={e.id}><td className="due" style={{ width: 70 }}>{hm(e.at)}</td><td><span className={"pill " + (e.kind === "decision" ? "amber" : e.kind === "status" ? "red" : e.kind === "check" ? "green" : "")}>{e.kind}</span></td><td>{e.text}<div className="mini">{P.get(e.person_id ?? "") ?? ""}</div></td></tr>)}
            </tbody></table></div></section>
            {can && <section className="card"><div className="ch"><span className="eyebrow">Close</span></div><div className="cb">
              <form action={closeActivation} className="grid gap-2"><input type="hidden" name="id" value={open.id} />
                <textarea name="summary" className="inp" rows={3} required placeholder="Situation at closing, what remains, lessons for the debrief" aria-label="Closing summary" />
                <div className="flex justify-end"><button className="btn erp" type="submit">Close the {open.exercise ? "exercise" : "activation"}</button></div></form>
              {open.exercise && <p className="mini mt-2">Closing an exercise also records it in Exercises, with the summary as lessons learned.</p>}</div></section>}
          </div>
          <div className="grid gap-4" style={{ alignContent: "start" }}>
            {miles.length > 0 && <section className="card"><div className="ch"><span className="eyebrow">Response times</span><span className="mini">from {hm(open.started_at)}</span></div>
              <div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{miles.map((m) => { const due = Date.parse(open.started_at) + m.minutes * 60_000; const t = ticked.get(`m:${m.id}`); const late = !t && now > due; return (
                <tr key={m.id}><td className="due" style={{ width: 92 }}>{t ? <span className="pill green">{hm(t.at)}</span> : <span className={"pill " + (late ? "red" : "")}>{m.minutes ? hm(new Date(due).toISOString()) : "at once"}</span>}</td>
                  <td>{t ? <s>{m.label}</s> : <b>{m.label}</b>}<div className="mini">{[m.owner_role, after(m.minutes), m.source].filter(Boolean).join(", ")}</div></td>
                  <td style={{ width: 40 }}>{!t && can && <form action={tickAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="ref" value={`m:${m.id}`} /><input type="hidden" name="text" value={m.label} /><button className="chk" type="submit" aria-label={`Done: ${m.label}`} /></form>}</td></tr>); })}</tbody></table></div></section>}
            {open.info && <section className="card"><div className="ch"><span className="eyebrow">Primary information sheet</span></div><div className="cb"><dl className="erp-info">{INFO.filter(([k]) => open.info?.[k]).map(([k, l]) => <div key={k}><dt>{l}</dt><dd>{open.info![k]}</dd></div>)}</dl></div></section>}
            {lists.length ? lists.map((c) => { const lines = c.items.split("\n").map((x) => x.trim()).filter(Boolean); const n = lines.filter((_, i) => ticked.has(`${c.id}:${i}`)).length; return (
              <section key={c.id} className="card"><div className="ch"><span><b>{c.title}</b> <span className="mini">{[c.code, c.phase, c.owner_role].filter(Boolean).join(", ")}</span></span><span className={"pill " + (n === lines.length ? "green" : "")}>{n} / {lines.length}</span></div>
                <div className="cb grid gap-1">{lines.map((l, i) => { const t = ticked.get(`${c.id}:${i}`); return t
                  ? <div key={i} className="erp-done"><span className="pill green">{hm(t.at)}</span> <s>{l}</s> <span className="mini">{P.get(t.person_id ?? "") ?? ""}</span></div>
                  : <form key={i} action={tickAction} className="erp-todo"><input type="hidden" name="id" value={open.id} /><input type="hidden" name="ref" value={`${c.id}:${i}`} /><input type="hidden" name="text" value={l} /><button className="chk" type="submit" aria-label={`Mark done: ${l}`} disabled={!can} /> {l}</form>; })}</div></section>); })
              : <section className="card"><div className="cb mini">No activation checklist for {ENT[ent]?.name ?? ent}. <Link className="underline" href="/erp/check">Write them in Activation checklists</Link>.</div></section>}
            <section className="card"><div className="ch"><span className="eyebrow">Crisis directory</span><Link className="mini" href="/erp/contacts">Open</Link></div><div className="cb" style={{ padding: 0 }}>
              {contacts.length ? <table className="tbl"><tbody>{contacts.map((c) => <tr key={c.id}><td><b>{c.crisis_role}</b><div className="mini">{[c.name, c.organisation].filter(Boolean).join(", ")}</div></td><td className="mono">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a> : ""}<div className="mini">{c.available ?? ""}</div></td></tr>)}</tbody></table> : <p className="p-4 mini">No crisis contact recorded.</p>}
            </div></section>
          </div>
        </div>
      ) : can ? (
        <section className="card mb-4" style={{ maxWidth: 760 }}><div className="cb">
          <form action={startActivation} className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className="eyebrow">Entity</span><select name="entity" className="inp" defaultValue={ent}>{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select></label>
              <label className="block"><span className="eyebrow">Level</span><select name="level" className="inp" defaultValue="alert"><option value="alert">Alert (assess)</option><option value="activation">Activation (crisis cell)</option></select></label>
              <label className="block"><span className="eyebrow">Plan</span><select name="plan" className="inp" defaultValue=""><option value="">The entity's plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code}, ` : ""}{p.title}</option>)}</select></label>
            </div>
            <label className="block"><span className="eyebrow">Scenario</span><select name="scenario" className="inp" defaultValue="safety">{SCENARIOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="block"><span className="eyebrow">What happened</span><input name="title" className="inp" required maxLength={200} placeholder="9H-AST overdue on arrival LFMN, no contact since 14:05 UTC" /></label>
            <details className="erp-sheet"><summary>Primary information sheet <span className="mini">(fill what you know, the rest can be logged later)</span></summary>
              <datalist id="erp-regs">{regs.map((r) => <option key={r} value={r} />)}</datalist>
              <div className="grid grid-cols-3 gap-3 mt-3">{INFO.map(([k, l, ph]) => <label key={k} className="block"><span className="eyebrow">{l}</span><input name={`i_${k}`} className="inp" placeholder={ph} list={k === "reg" ? "erp-regs" : undefined} /></label>)}</div>
            </details>
            <ErpStartBar defaultExercise={process.env.VERCEL_ENV !== "production"} unit={contacts.filter((c) => c.kind === "internal").length} />
          </form></div></section>
      ) : <section className="card"><div className="cb">Only the AM, SM, CMM and nominated persons can raise an alert. In an emergency, call the crisis director: <Link className="underline" href="/erp/contacts">Crisis directory</Link>.</div></section>}
      {acts.filter((a) => a.status === "closed").length > 0 && <section className="card mt-4"><div className="ch"><span className="eyebrow">Past activations and exercises</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
        {acts.filter((a) => a.status === "closed").map((a) => <tr key={a.id}><td className="due">{day(a.started_at)}</td><td><b>{a.title}</b><div className="mini">{a.summary}</div></td><td><span className={"pill " + (a.exercise ? "" : "red")}>{a.exercise ? "exercise" : a.level}</span></td></tr>)}
      </tbody></table></div></section>}
    </>
  );
}
