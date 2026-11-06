import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { CoffeeBox, SameSources } from "@/components/CoffeeBox";
import { hasGraph } from "@/lib/msgraph-user";
import { BrewButton } from "@/components/BrewButton";
import { todaysRecap, dayLabel, hhmm, type Line } from "@/lib/coffee";
import { TIERS, type RankItem, type Tier } from "@/lib/coffee-rank";
import CoffeeLineActions from "@/components/CoffeeLineActions";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addRule, unmark } from "./actions";
import { brewCoffee } from "./actions";
import { Icon } from "@/lib/icons";

export const maxDuration = 60;

function Block({ title, hint, lines, empty, dueCol = true }: { title: string; hint?: string; lines: Line[]; empty?: string; dueCol?: boolean }) {
  if (!lines.length && !empty) return null;
  return (
    <section className="card mb-4">
      <div className="ch"><span className="eyebrow">{title}</span><span className="mini">{hint ?? lines.length}</span></div>
      {lines.length ? (
        <table className="tbl"><tbody>{lines.map((l, i) => (
          <tr key={i}>
            <td style={{ width: 70 }}><span className={"ent " + l.entity}>{l.entity}</span></td>
            <td style={{ width: 160 }}><span className={"kind " + l.cls}>{l.label}</span></td>
            {dueCol && <td style={{ width: 110 }} className="mono">{l.due ?? "—"}</td>}
            <td>
              {l.ctx && <div className="ctx">{l.ctx}</div>}
              {l.link ? <Link href={l.link} className="underline"><b>{l.title}</b></Link> : <b>{l.title}</b>}
              {l.note && <div className="mini">{l.note}</div>}
            </td>
          </tr>))}</tbody></table>
      ) : <div className="cb mini">{empty}</div>}
    </section>
  );
}

/** the same source shown once, with a count (×3) */
const uniq = (src: RankItem["sources"]) => { const m = new Map<string, RankItem["sources"][number] & { n: number }>(); for (const x of src) { const k = x.kind + "|" + x.label; const c = m.get(k); if (c) c.n++; else m.set(k, { ...x, n: 1 }); } return [...m.values()].map((x) => ({ ...x, label: x.n > 1 ? `${x.label} ×${x.n}` : x.label })); };
const SRC: Record<string, string> = { sam: "k-docs", mail: "k-comp", teams: "k-auth", agenda: "k-proj" };
function TierBlock({ tier, items }: { tier: Tier; items: RankItem[] }) {
  if (!items.length) return null;
  const rows = (
    <table className="tbl"><tbody>{items.map((it) => (
      <tr key={it.id}>
        <td style={{ width: 70 }}>{it.entity && <span className={"ent " + it.entity}>{it.entity}</span>}</td>
        <td>{it.badge && <span className={"kind " + (it.badge === "for-you" ? "k-comp" : "k-cert")} style={{ marginRight: 6 }}>{it.badge === "for-you" ? "Waits for you" : "You are waiting"}</span>}{it.badge && " "}<b>{it.title}</b><div className="mini">{it.why}</div>{it.id.startsWith("g:") && it.topic && <div className="mini" style={{ color: "#6b7a8c" }}>{it.topic}</div>}</td>
        <td style={{ width: 260 }}><span className="mini"><b>→ {it.action}</b></span></td>
        <td style={{ width: 300 }} className="text-right">{uniq(it.sources).map((x, n) => x.link
          ? (x.link.startsWith("/") ? <Link key={n} href={x.link} className={"kind " + (SRC[x.kind] ?? "")} style={{ marginLeft: 4 }}>{x.label}</Link> : <a key={n} href={x.link} target="_blank" rel="noreferrer" className={"kind " + (SRC[x.kind] ?? "")} style={{ marginLeft: 4 }}>{x.label}</a>)
          : <span key={n} className={"kind " + (SRC[x.kind] ?? "")} style={{ marginLeft: 4 }}>{x.label}</span>)}<CoffeeLineActions it={it} /></td>
      </tr>))}</tbody></table>);
  if (tier === 4) return <details className="card mb-4"><summary className="ch cursor-pointer"><span className="eyebrow">{tier}, {TIERS[tier].title}</span><span className="mini">{items.length}, {TIERS[tier].hint}</span></summary>{rows}</details>;
  return <section className={"card mb-4" + (tier === 1 ? " cf-hot" : "")}><div className="ch"><span className="eyebrow">{tier}, {TIERS[tier].title}</span><span className="mini">{items.length}, {TIERS[tier].hint}</span></div>{rows}</section>;
}

/** Lot 3 · what the recap remembers for the person: always important / never important (senders, domains, chats, words). */
async function Rules({ personId }: { personId: string }) {
  const { data } = await supabaseAdmin().from("coffee_prefs").select("important,muted").eq("person_id", personId).maybeSingle();
  const p = (data as { important: string[]; muted: string[] } | null) ?? { important: [], muted: [] };
  const show = (v: string) => v.replace(/^(mail|teams|sam|agenda|wait):/, "");
  const Chip = ({ v }: { v: string }) => <form action={unmark} style={{ display: "inline" }}><input type="hidden" name="value" value={v} /><button className="pill" title="Forget this rule" style={{ margin: "2px 4px 2px 0" }}>{show(v)} <Icon name="x" size={11} /></button></form>;
  return (
    <details className="card mb-4"><summary className="ch cursor-pointer"><span className="eyebrow">Your ranking rules</span><span className="mini">{p.important.length} important, {p.muted.length} not important, learnt from the buttons, or added here</span></summary>
      <div className="cb grid gap-2">
        <div><span className="mini"><b>Always at least “Today”</b> </span>{p.important.map((v) => <Chip key={v} v={v} />)}{!p.important.length && <span className="mini">—</span>}</div>
        <div><span className="mini"><b>Always “Can wait”</b> </span>{p.muted.map((v) => <Chip key={v} v={v} />)}{!p.muted.length && <span className="mini">—</span>}</div>
        <form action={addRule} className="flex gap-2"><input name="value" className="inp" placeholder="an address, a domain (@easa.europa.eu) or a word (ECCAIRS, 9H-SFJ…)" style={{ marginTop: 0 }} />
          <select name="list" className="inp" style={{ width: 170, marginTop: 0 }} defaultValue="important"><option value="important">Important</option><option value="muted">Not important</option></select><button className="btn">Add</button></form>
        <span className="mini">Applied at the next “Brew again”. A domain or word rule never mutes a regulatory clock, an overdue or a due-today item, only marking that very line does.</span>
      </div></details>);
}

/** Home › Morning coffee (UX-02) — Lot 1 (03/11): one list ranked by importance, first three things on top; details by source below. */
export default async function MorningCoffee() {
  const s = await getSession();
  if (!s) redirect("/login");
  const r = s.person ? await todaysRecap(s.person.id) : null;
  if (!r) return (<><PageHeader eyebrow="Home, Morning coffee" title="Morning coffee" sub="Nothing prepared yet today." /><CoffeeBox recap={null} connected={s.person ? await hasGraph(s.person.id) : false} /></>);
  const err = r.errors ?? {};
  const Err = ({ k }: { k: string }) => err[k] ? <div className="cb mini red">Could not read it this time: {err[k]}</div> : null;
  const actions = r.mail?.groups.reduce((n, g) => n + g.items.filter((m) => m.action).length, 0) ?? 0;
  const urgent = r.overdue.length + r.today.length + r.mor.length;
  const c = r.counts ?? { overdue: r.overdue.length, today: r.today.length, week: r.week.length }; // FB-002 · same unit as the Inbox: tasks
  return (
    <>
      <PageHeader eyebrow="Home, Morning coffee" title={`Your morning, ${s.name.split(" ")[0]}`}
        sub={`Prepared at ${hhmm(r.at)}, since ${dayLabel(r.since)}, nothing was sent, marked read or moved, deleted tonight.`}
        right={<form action={brewCoffee} className="flex gap-2"><SameSources recap={r} /><Link href="/home/tasks" className="btn">Inbox</Link><BrewButton label="Brew again" primary={false} /></form>} />

      <section className={"card coffee-syn mb-4" + (urgent ? " hot" : "")}>
        <div className="cb"><span className="cf-cup" aria-hidden><Icon name="coffee" size={24} /></span>{r.ranked?.top.length
          ? <div><div className="eyebrow mb-1">First three things today</div><ol style={{ margin: 0, paddingLeft: 18, listStyle: "decimal" }}>{r.ranked.top.map((t, i) => <li key={i}><b>{t}</b></li>)}</ol></div>
          : <p>{r.synthesis}</p>}</div>
      </section>

      {r.ranked && r.ranked.items.length > 0 && <>
        {([1, 2, 3, 4] as Tier[]).map((t) => <TierBlock key={t} tier={t} items={r.ranked!.items.filter((x) => x.tier === t)} />)}
        {r.ranked.by === "rules" && <p className="mini mb-4">Ranked by the rules only, the assistant could not be reached this time.</p>}
        <Rules personId={s.person!.id} />
      </>}

      <details className="mb-4" open={!r.ranked}><summary className="eyebrow cursor-pointer mb-3">Details by source</summary>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className={"metric" + (c.overdue ? " red" : "")}><div className="eyebrow">Overdue tasks</div><div className="val">{c.overdue}</div><div className="mini">{c.today} due today, {c.week} this week</div></div>
        <div className="metric"><div className="eyebrow">Meetings today</div><div className="val">{r.agenda ? r.agenda.items.filter((i) => !i.allDay).length : "—"}</div>{r.agenda && <div className="mini">{r.agenda.free.length ? `free ${r.agenda.free.slice(0, 2).map((f) => f.from + "–" + f.to).join(", ")}` : "no free slot"}</div>}</div>
        <div className={"metric" + (actions ? " amber" : "")}><div className="eyebrow">Unread mail</div><div className="val">{r.mail ? r.mail.total : "—"}</div>{r.mail && <div className="mini">{actions} to act on</div>}</div>
        <div className="metric"><div className="eyebrow">Teams</div><div className="val">{r.teams ? r.teams.chats.length + r.teams.mentions.length : "—"}</div>{r.teams && <div className="mini">{r.teams.chats.length} chats, {r.teams.mentions.length} mentions</div>}</div>
      </div>

      {(r.agenda || err.calendar) && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Today&apos;s agenda</span><span className="mini">{r.agenda?.free.length ? "free: " + r.agenda.free.map((f) => `${f.from}–${f.to}`).join(", ") : ""}</span></div>
          <Err k="calendar" />
          {r.agenda && (r.agenda.items.length ? (
            <table className="tbl"><tbody>{r.agenda.items.map((i, n) => (
              <tr key={n} className={i.busy ? "" : "cf-free"}>
                <td className="mono" style={{ width: 120 }}>{i.allDay ? "all day" : `${i.start.slice(11)}–${i.end.slice(11)}`}</td>
                <td>{i.link ? <a href={i.link} target="_blank" rel="noreferrer" className="underline"><b>{i.subject}</b></a> : <b>{i.subject}</b>}{i.location && <div className="mini">{i.location}</div>}</td>
                <td style={{ width: 260 }} className="text-right">{i.sam && <Link href={i.sam.link} className="kind k-docs">{i.sam.label}</Link>} {i.join && <a href={i.join} target="_blank" rel="noreferrer" className="btn">Join</a>}</td>
              </tr>))}</tbody></table>
          ) : <div className="cb mini">No meeting today.</div>)}
        </section>
      )}

      {(r.mail || err.mail) && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Unread mail since {dayLabel(r.since)}</span><span className="mini">{r.mail ? `${r.mail.total}, Private / Personal left out` : ""}</span></div>
          <Err k="mail" />
          {r.mail && (r.mail.total ? r.mail.groups.map((g) => (
            <div key={g.name} className="cf-mailgrp">
              <div className="cf-grp">{g.name} <span className="mini">{g.items.length}</span></div>
              <table className="tbl"><tbody>{g.items.map((m, n) => (
                <tr key={n}>
                  <td style={{ width: 90 }}>{m.action && <span className="kind k-comp">Action</span>}</td>
                  <td style={{ width: 220 }}><b>{m.from}</b><div className="mini mono">{m.count && m.count > 1 ? `${m.count} messages, last ${hhmm(m.at)}` : hhmm(m.at)}</div></td>
                  <td>{m.link ? <a href={m.link} target="_blank" rel="noreferrer" className="underline">{m.subject}</a> : m.subject}<div className="mini">{m.summary}</div></td>
                </tr>))}</tbody></table>
            </div>
          )) : <div className="cb mini">No unread mail.</div>)}
        </section>
      )}

      {(r.teams || err.teams) && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Teams</span><span className="mini">unread chats, channel messages naming you</span></div>
          <Err k="teams" />
          {r.teams && (r.teams.chats.length + r.teams.mentions.length ? (
            <table className="tbl"><tbody>
              {r.teams.mentions.map((m, n) => (<tr key={"m" + n}><td style={{ width: 110 }}><span className="kind k-auth">@mention</span></td><td style={{ width: 200 }}><b>{m.name}</b><div className="mini mono">{m.at ? dayLabel(m.at) : ""}</div></td><td>{m.link ? <a href={m.link} target="_blank" rel="noreferrer" className="underline">{m.preview}</a> : m.preview}</td></tr>))}
              {r.teams.chats.map((m, n) => (<tr key={"c" + n}><td style={{ width: 110 }}><span className="kind">Chat</span></td><td style={{ width: 200 }}><b>{m.name}</b><div className="mini mono">{dayLabel(m.at)}</div></td><td>{m.link ? <a href={m.link} target="_blank" rel="noreferrer" className="underline">{m.preview || "open"}</a> : m.preview}</td></tr>))}
            </tbody></table>
          ) : <div className="cb mini">Nothing unread in Teams.</div>)}
        </section>
      )}

      <Block title="Regulatory clocks, MOR 72 h" lines={r.mor} dueCol={false} />
      <Block title="Overdue" hint={c.overdue !== r.overdue.length ? `${c.overdue} tasks, ${r.overdue.length} lines` : undefined} lines={r.overdue} />
      <Block title="Due today" hint={c.today !== r.today.length ? `${c.today} tasks, ${r.today.length} lines` : undefined} lines={r.today} empty={r.overdue.length ? undefined : "Nothing due today."} />
      <Block title="Next 7 days" hint={c.week !== r.week.length ? `${c.week} tasks, ${r.week.length} lines` : undefined} lines={r.week} />
      <Block title="Read & acknowledge" lines={r.readings} />
      <Block title="Validities ending within 90 days" lines={r.validities} />
      <Block title={`What moved since ${dayLabel(r.since)}`} lines={r.moved} dueCol={false} empty="Nothing moved overnight in your scope." />

      </details>
    </>
  );
}
