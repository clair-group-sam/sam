import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DUE_KIND, loadDeadlines, type Due } from "@/lib/deadlines";
import DeadlineTimeline from "@/components/DeadlineTimeline";
import { today } from "@/lib/authority";

/** The dated commitments of some entities around today: 3 weeks back (and anything still late, whatever its age), 45 days ahead. */
export async function dueWindow(db: SupabaseClient, ents: string[]) {
  const t0 = today(); const day = (n: number) => { const x = new Date(t0); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const win = { t0, from: day(-21), to: day(45) };
  const dues = (await loadDeadlines(db, ents, { from: day(-400), to: win.to })).filter((d) => d.date >= win.from || d.state === "late");
  return { win, dues };
}

/** "Deadlines, the next 45 days": the band of CODIR / SRB, also on top of the Inbox. One lane per entity. */
export default function DueBand({ dues, win, lanes }: { dues: Due[]; win: { t0: string; from: string; to: string }; lanes: string[] }) {
  const late = dues.filter((d) => d.state === "late").length, soon = dues.filter((d) => d.state === "soon").length;
  return (
    <section className="card mb-4">
      <div className="ch"><span className="eyebrow">Deadlines, the next 45 days</span><span className="mini">{late} past, {soon} within 15 days. <Link className="underline" href="/dash/due">Open the calendar</Link></span></div>
      <div className="cb">{dues.length ? <DeadlineTimeline today={win.t0} from={win.from} to={win.to} lanes={lanes} items={dues.map((d) => ({ key: d.key, lane: d.entity, date: d.date < win.from ? win.from : d.date, days: d.days, state: d.state, ref: d.ref, title: d.title, todo: d.todo, who: d.who, ball: d.ball, kind: DUE_KIND[d.kind].label, href: d.href }))} /> : <p className="mini">Nothing dated in the next 45 days.</p>}</div>
    </section>
  );
}
