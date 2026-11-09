import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { closeActivation, logEvent, mayActivate, startActivation, tickAction } from "../actions";

type Act = { id: string; entity: string; plan_id: string | null; exercise: boolean; level: string; title: string; started_at: string; started_by: string | null; status: string; closed_at: string | null; summary: string | null };
type Ev = { id: number; at: string; person_id: string | null; kind: string; text: string; ref: string | null };
type Cl = { id: string; title: string; phase: string; owner_role: string | null; items: string };
type Ct = { id: string; crisis_role: string; name: string | null; organisation: string | null; phone: string | null; email: string | null; available: string | null };
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
  const [{ data: pd }, { data: cd }, { data: kd }, { data: ed }, { data: ppl }] = await Promise.all([
    db.from("erp_plans").select("id,title,code").eq("entity", ent).eq("active", true).order("code"),
    db.from("erp_checklists").select("id,title,phase,owner_role,items").eq("entity", ent).eq("active", true).order("ord").order("title"),
    db.from("erp_contacts").select("id,crisis_role,name,organisation,phone,email,available").eq("entity", ent).eq("active", true).order("ord"),
    open ? db.from("erp_events").select("*").eq("activation_id", open.id).order("at", { ascending: false }) : Promise.resolve({ data: [] }),
    db.from("people").select("id,display_name"),
  ]);
  const plans = (pd ?? []) as { id: string; title: string; code: string | null }[];
  const lists = (cd ?? []) as Cl[]; const contacts = (kd ?? []) as Ct[]; const events = (ed ?? []) as Ev[];
  const P = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const ticked = new Map(events.filter((e) => e.kind === "check" && e.ref).map((e) => [e.ref!, e]));
  return (
    <>
      <PageHeader eyebrow="ERP, Activation mode" title={open ? (open.exercise ? "Exercise in progress" : open.level === "activation" ? "ERP activated" : "Alert raised") : "Activation mode"}
        sub={open ? `${ENT[open.entity]?.name ?? open.entity}, since ${day(open.started_at)} ${hm(open.started_at)}: ${open.title}` : "Raise an alert or activate the emergency response plan. The crisis cell (AM, SM, CMM) gets an Inbox item and a Teams card at once; everything done is logged and timed."} />
      {open ? (
        <div className="erp-live grid gap-4" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
          <div className="grid gap-4" style={{ alignContent: "start" }}>
            <section className={"card erp-banner" + (open.exercise ? " ex" : "")}><div className="cb">
              <b>{open.exercise ? "EXERCISE, NOT A REAL EVENT" : open.level === "activation" ? "ERP ACTIVATED" : "ALERT"}</b>
              <span>{open.title}</span>
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
            {lists.length ? lists.map((c) => { const lines = c.items.split("\n").map((x) => x.trim()).filter(Boolean); const n = lines.filter((_, i) => ticked.has(`${c.id}:${i}`)).length; return (
              <section key={c.id} className="card"><div className="ch"><span><b>{c.title}</b> <span className="mini">{c.phase}{c.owner_role ? `, ${c.owner_role}` : ""}</span></span><span className={"pill " + (n === lines.length ? "green" : "")}>{n} / {lines.length}</span></div>
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
              <label className="block"><span className="eyebrow">Plan</span><select name="plan" className="inp" defaultValue=""><option value="">Choose later</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code}, ` : ""}{p.title}</option>)}</select></label>
            </div>
            <label className="block"><span className="eyebrow">What happened</span><input name="title" className="inp" required maxLength={200} placeholder="9H-AST overdue on arrival LFMN, no contact since 14:05 UTC" /></label>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="flex gap-2 items-center"><input type="checkbox" name="exercise" /> This is an exercise</label>
              <button className="btn erp" type="submit">Start</button>
            </div>
          </form></div></section>
      ) : <section className="card"><div className="cb">Only the AM, SM, CMM and nominated persons can raise an alert. In an emergency, call the crisis director: <Link className="underline" href="/erp/contacts">Crisis directory</Link>.</div></section>}
      {acts.filter((a) => a.status === "closed").length > 0 && <section className="card mt-4"><div className="ch"><span className="eyebrow">Past activations and exercises</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
        {acts.filter((a) => a.status === "closed").map((a) => <tr key={a.id}><td className="due">{day(a.started_at)}</td><td><b>{a.title}</b><div className="mini">{a.summary}</div></td><td><span className={"pill " + (a.exercise ? "" : "red")}>{a.exercise ? "exercise" : a.level}</span></td></tr>)}
      </tbody></table></div></section>}
    </>
  );
}
