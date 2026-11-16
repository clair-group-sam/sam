import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { today, fr } from "@/lib/authority";
import { DUE_KIND, dueCounts, loadDeadlines, type DueKind } from "@/lib/deadlines";
import DeadlineTimeline from "@/components/DeadlineTimeline";

/* DUE-01 · Dashboards › Deadlines: every dated commitment of the scope on one calendar, then as a list sorted by date.
 * Lanes by entity (Group view) or by kind (one entity); filters by kind, by turn and by window. */
type Sp = { kind?: string; turn?: string; win?: string; by?: string };
const WIN: Record<string, [number, number, string]> = { "30": [-30, 30, "30 days"], "90": [-60, 90, "3 months"], "180": [-120, 180, "6 months"], "365": [-120, 365, "12 months"] };
const addDays = (d: string, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export default async function Deadlines({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  if (!["cmm", "am", "np"].includes(s.role)) redirect("/home/tasks");
  const sp = await searchParams; const t0 = today();
  const ents = s.entity === "ALL" ? ENTS4.filter((e) => s.group || s.entities.includes(e)) : [s.entity];
  const win = WIN[sp.win ?? "90"] ?? WIN["90"]; const from = addDays(t0, win[0]), to = addDays(t0, win[1]);
  const kinds = (sp.kind ?? "").split(",").filter((k): k is DueKind => k in DUE_KIND);
  const all = await loadDeadlines(supabaseAdmin(), ents, { from: addDays(t0, -400), to });
  const inKind = kinds.length ? all.filter((d) => kinds.includes(d.kind)) : all;
  const turned = sp.turn === "us" ? inKind.filter((d) => d.ball !== "authority") : sp.turn === "authority" ? inKind.filter((d) => d.ball === "authority") : inKind;
  // everything past stays visible (pinned at the left edge of the window), whatever its age: a late item never drops off the calendar
  const shown = turned.filter((d) => d.date >= from || d.state === "late");
  const c = dueCounts(turned);
  const byKind = ents.length === 1 && sp.by !== "entity";
  const lanes = byKind ? (Object.keys(DUE_KIND) as DueKind[]).filter((k) => shown.some((d) => d.kind === k)) : ents;
  const link = (p: Partial<Sp>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...p })) if (v) u.set(k, v); const q = u.toString(); return `/dash/due${q ? `?${q}` : ""}`; };
  const counts = new Map<string, number>(); for (const d of all.filter((x) => x.date >= from || x.state === "late")) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  return (
    <>
      <PageHeader eyebrow="Dashboards, Deadlines" title="Deadlines" sub={`Every dated commitment S.A.M. holds for ${ents.length > 1 ? "the entities of your scope" : ENT[ents[0]]?.name ?? ents[0]}: CAA applications, findings, safety actions, MOR follow-ups, audits, checks, regulatory watch, certificates, boards. Hover a dot to read it, click to open it.`} right={<Link className="btn" href="/dash/codir">CODIR / SRB</Link>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Past their date" value={c.late} tone={c.late ? "red" : "green"} hint={c.late ? `${c.lateOurs} on our side, ${c.late - c.lateOurs} waiting on the authority` : "nothing late"} />
        <Metric label="Within 15 days" value={c.soon} tone={c.soon ? "amber" : undefined} hint={`up to ${fr(addDays(t0, 14))}`} />
        <Metric label="Next deadline" value={c.next ? fr(c.next.date) : "—"} hint={c.next ? `${c.next.ref} ${c.next.title}`.slice(0, 70) : "none in the window"} />
        <Metric label="In the window" value={shown.length} hint={`${fr(from)} to ${fr(to)}`} />
      </div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="chips"><Link href={link({ kind: "" })} className={"ent" + (!kinds.length ? " on" : "")}>All</Link>{(Object.keys(DUE_KIND) as DueKind[]).filter((k) => counts.get(k)).map((k) => <Link key={k} href={link({ kind: kinds.length === 1 && kinds[0] === k ? "" : k })} className={"ent" + (kinds.includes(k) ? " on" : "")}>{DUE_KIND[k].plural} {counts.get(k)}</Link>)}</div>
        <div className="chips">{[["", "Any turn"], ["us", "Ours"], ["authority", "The authority's"]].map(([k, l]) => <Link key={k} href={link({ turn: k })} className={"ent" + ((sp.turn ?? "") === k ? " on" : "")}>{l}</Link>)}</div>
        <div className="chips ml-auto">{Object.entries(WIN).map(([k, v]) => <Link key={k} href={link({ win: k })} className={"ent" + ((sp.win ?? "90") === k ? " on" : "")}>{v[2]}</Link>)}</div>
      </div>
      <section className="card mb-4"><div className="ch"><span className="eyebrow">Calendar</span>{ents.length === 1 && <Link className="mini underline" href={link({ by: byKind ? "entity" : "" })}>{byKind ? "One lane" : "One lane per kind"}</Link>}</div>
        <div className="cb">{shown.length ? <DeadlineTimeline today={t0} from={from} to={to} lanes={lanes} laneLabels={byKind ? Object.fromEntries((Object.keys(DUE_KIND) as DueKind[]).map((k) => [k, DUE_KIND[k].plural.replace(" & validities", "")])) : undefined}
          items={shown.map((d) => ({ key: d.key, lane: byKind ? d.kind : d.entity, date: d.date < from ? from : d.date, days: d.days, state: d.state, ref: d.ref, title: d.title, todo: d.todo, who: d.who, ball: d.ball, kind: DUE_KIND[d.kind].label, href: d.href }))} /> : <p className="mini">Nothing dated in this window.</p>}</div></section>
      <section className="card"><div className="ch"><span className="eyebrow">By date</span><span className="mini">{shown.length} item{shown.length === 1 ? "" : "s"}</span></div>
        <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>Date</th>{ents.length > 1 && <th>Entity</th>}<th>Kind</th><th>Reference</th><th>What</th><th>To do</th><th>Who</th><th>Turn</th></tr></thead><tbody>
          {shown.map((d) => <tr key={d.key}><td className="mono" style={{ whiteSpace: "nowrap" }}>{fr(d.date)}<div className={"mini" + (d.state === "late" ? " red" : "")}>{d.days < 0 ? `${-d.days} d past` : d.days === 0 ? "today" : `in ${d.days} d`}</div></td>{ents.length > 1 && <td><span className={"ent " + d.entity}>{d.entity}</span></td>}<td className="mini">{DUE_KIND[d.kind].label}</td><td className="mono"><Link className="underline" href={d.href}>{d.ref || "open"}</Link></td><td style={{ maxWidth: 340 }}>{d.title}</td><td className="mini" style={{ maxWidth: 280 }}>{d.todo}</td><td className="mono">{d.who ?? "—"}</td><td><span className={"pill " + (d.state === "late" ? (d.ball === "authority" ? "amber" : "red") : d.state === "soon" ? "amber" : "")}>{d.ball === "authority" ? "Authority" : "Ours"}</span></td></tr>)}
        </tbody></table></div></section>
    </>
  );
}
