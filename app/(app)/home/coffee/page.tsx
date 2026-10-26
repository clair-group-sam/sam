import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { CoffeeBox } from "@/components/CoffeeBox";
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
  if (!r) return (<><PageHeader eyebrow="Home · Morning coffee" title="Morning coffee" sub="Nothing prepared yet today." /><CoffeeBox recap={null} /></>);
  const urgent = r.overdue.length + r.today.length + r.mor.length;
  return (
    <>
      <PageHeader eyebrow="Home · Morning coffee" title={`Your morning, ${s.name.split(" ")[0]}`}
        sub={`Prepared at ${hhmm(r.at)} · what changed since ${dayLabel(r.since)} · nothing was sent, read or moved.`}
        right={<form action={brewCoffee} className="flex gap-2"><Link href="/home/tasks" className="btn">Inbox</Link><BrewButton label="Brew again" primary={false} /></form>} />

      <section className={"card coffee-syn mb-4" + (urgent ? " hot" : "")}>
        <div className="cb"><span className="cf-cup" aria-hidden>☕</span><p>{r.synthesis}</p></div>
      </section>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className={"metric" + (r.overdue.length ? " red" : "")}><div className="eyebrow">Overdue</div><div className="val">{r.overdue.length}</div></div>
        <div className={"metric" + (r.today.length ? " amber" : "")}><div className="eyebrow">Due today</div><div className="val">{r.today.length}</div></div>
        <div className="metric"><div className="eyebrow">Next 7 days</div><div className="val">{r.week.length}</div>{r.later > 0 && <div className="mini">+{r.later} later or undated</div>}</div>
        <div className="metric"><div className="eyebrow">Moved overnight</div><div className="val">{r.moved.length}</div></div>
      </div>

      <Block title="Regulatory clocks · MOR 72 h" lines={r.mor} dueCol={false} />
      <Block title="Overdue" lines={r.overdue} />
      <Block title="Due today" lines={r.today} empty={r.overdue.length ? undefined : "Nothing due today."} />
      <Block title="Next 7 days" lines={r.week} />
      <Block title="Read & acknowledge" lines={r.readings} />
      <Block title="Validities ending within 90 days" lines={r.validities} />
      <Block title={`What moved since ${dayLabel(r.since)}`} lines={r.moved} dueCol={false} empty="Nothing moved overnight in your scope." />

      <section className="card coffee-soon">
        <div className="ch"><span className="eyebrow">Coming next</span><span className="mini">waiting for IT</span></div>
        <div className="cb mini">Today&apos;s Outlook agenda, unread mail since yesterday 18:00 (Authorities / Internal / Notifications, one line each) and Teams chats and @mentions will appear here once the delegated Microsoft rights (Calendars.Read, Mail.Read, Chat.Read) are granted to S.A.M.</div>
      </section>
    </>
  );
}
