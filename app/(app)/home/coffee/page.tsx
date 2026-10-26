import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { CoffeeBox, SameSources } from "@/components/CoffeeBox";
import { hasGraph } from "@/lib/msgraph-user";
import { BrewButton } from "@/components/BrewButton";
import { todaysRecap, dayLabel, hhmm, type Line } from "@/lib/coffee";
import { brewCoffee } from "./actions";

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

/** Home › Morning coffee (UX-02, phase 1: S.A.M. only). */
export default async function MorningCoffee() {
  const s = await getSession();
  if (!s) redirect("/login");
  const r = s.person ? await todaysRecap(s.person.id) : null;
  if (!r) return (<><PageHeader eyebrow="Home · Morning coffee" title="Morning coffee" sub="Nothing prepared yet today." /><CoffeeBox recap={null} connected={s.person ? await hasGraph(s.person.id) : false} /></>);
  const err = r.errors ?? {};
  const Err = ({ k }: { k: string }) => err[k] ? <div className="cb mini red">Could not read it this time: {err[k]}</div> : null;
  const actions = r.mail?.groups.reduce((n, g) => n + g.items.filter((m) => m.action).length, 0) ?? 0;
  const urgent = r.overdue.length + r.today.length + r.mor.length;
  const c = r.counts ?? { overdue: r.overdue.length, today: r.today.length, week: r.week.length }; // FB-002 · same unit as the Inbox: tasks
  return (
    <>
      <PageHeader eyebrow="Home · Morning coffee" title={`Your morning, ${s.name.split(" ")[0]}`}
        sub={`Prepared at ${hhmm(r.at)} · since ${dayLabel(r.since)} · nothing was sent, marked read or moved · deleted tonight.`}
        right={<form action={brewCoffee} className="flex gap-2"><SameSources recap={r} /><Link href="/home/tasks" className="btn">Inbox</Link><BrewButton label="Brew again" primary={false} /></form>} />

      <section className={"card coffee-syn mb-4" + (urgent ? " hot" : "")}>
        <div className="cb"><span className="cf-cup" aria-hidden>☕</span><p>{r.synthesis}</p></div>
      </section>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className={"metric" + (c.overdue ? " red" : "")}><div className="eyebrow">Overdue tasks</div><div className="val">{c.overdue}</div><div className="mini">{c.today} due today · {c.week} this week</div></div>
        <div className="metric"><div className="eyebrow">Meetings today</div><div className="val">{r.agenda ? r.agenda.items.filter((i) => !i.allDay).length : "—"}</div>{r.agenda && <div className="mini">{r.agenda.free.length ? `free ${r.agenda.free.slice(0, 2).map((f) => f.from + "–" + f.to).join(", ")}` : "no free slot"}</div>}</div>
        <div className={"metric" + (actions ? " amber" : "")}><div className="eyebrow">Unread mail</div><div className="val">{r.mail ? r.mail.total : "—"}</div>{r.mail && <div className="mini">{actions} to act on</div>}</div>
        <div className="metric"><div className="eyebrow">Teams</div><div className="val">{r.teams ? r.teams.chats.length + r.teams.mentions.length : "—"}</div>{r.teams && <div className="mini">{r.teams.chats.length} chats · {r.teams.mentions.length} mentions</div>}</div>
      </div>

      {(r.agenda || err.calendar) && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Today&apos;s agenda</span><span className="mini">{r.agenda?.free.length ? "free: " + r.agenda.free.map((f) => `${f.from}–${f.to}`).join(" · ") : ""}</span></div>
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
          <div className="ch"><span className="eyebrow">Unread mail since {dayLabel(r.since)}</span><span className="mini">{r.mail ? `${r.mail.total} · Private / Personal left out` : ""}</span></div>
          <Err k="mail" />
          {r.mail && (r.mail.total ? r.mail.groups.map((g) => (
            <div key={g.name} className="cf-mailgrp">
              <div className="cf-grp">{g.name} <span className="mini">{g.items.length}</span></div>
              <table className="tbl"><tbody>{g.items.map((m, n) => (
                <tr key={n}>
                  <td style={{ width: 90 }}>{m.action && <span className="kind k-comp">Action</span>}</td>
                  <td style={{ width: 200 }}><b>{m.from}</b><div className="mini mono">{hhmm(m.at)}</div></td>
                  <td>{m.link ? <a href={m.link} target="_blank" rel="noreferrer" className="underline">{m.subject}</a> : m.subject}<div className="mini">{m.summary}</div></td>
                </tr>))}</tbody></table>
            </div>
          )) : <div className="cb mini">No unread mail.</div>)}
        </section>
      )}

      {(r.teams || err.teams) && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Teams</span><span className="mini">unread chats · channel messages naming you</span></div>
          <Err k="teams" />
          {r.teams && (r.teams.chats.length + r.teams.mentions.length ? (
            <table className="tbl"><tbody>
              {r.teams.mentions.map((m, n) => (<tr key={"m" + n}><td style={{ width: 110 }}><span className="kind k-auth">@mention</span></td><td style={{ width: 200 }}><b>{m.name}</b><div className="mini mono">{m.at ? dayLabel(m.at) : ""}</div></td><td>{m.link ? <a href={m.link} target="_blank" rel="noreferrer" className="underline">{m.preview}</a> : m.preview}</td></tr>))}
              {r.teams.chats.map((m, n) => (<tr key={"c" + n}><td style={{ width: 110 }}><span className="kind">Chat</span></td><td style={{ width: 200 }}><b>{m.name}</b><div className="mini mono">{dayLabel(m.at)}</div></td><td>{m.link ? <a href={m.link} target="_blank" rel="noreferrer" className="underline">{m.preview || "open"}</a> : m.preview}</td></tr>))}
            </tbody></table>
          ) : <div className="cb mini">Nothing unread in Teams.</div>)}
        </section>
      )}

      <Block title="Regulatory clocks · MOR 72 h" lines={r.mor} dueCol={false} />
      <Block title="Overdue" hint={c.overdue !== r.overdue.length ? `${c.overdue} tasks · ${r.overdue.length} lines` : undefined} lines={r.overdue} />
      <Block title="Due today" hint={c.today !== r.today.length ? `${c.today} tasks · ${r.today.length} lines` : undefined} lines={r.today} empty={r.overdue.length ? undefined : "Nothing due today."} />
      <Block title="Next 7 days" hint={c.week !== r.week.length ? `${c.week} tasks · ${r.week.length} lines` : undefined} lines={r.week} />
      <Block title="Read & acknowledge" lines={r.readings} />
      <Block title="Validities ending within 90 days" lines={r.validities} />
      <Block title={`What moved since ${dayLabel(r.since)}`} lines={r.moved} dueCol={false} empty="Nothing moved overnight in your scope." />

    </>
  );
}
