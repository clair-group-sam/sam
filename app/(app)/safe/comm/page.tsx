import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { CADENCE, STATUS, entitiesLabel, isJoint, kindName, kindShort, mayRun, type Committee } from "@/lib/committees";
import { planCommittee } from "./actions";

/** Safety › Committees: Safety Review Boards (or the ASF CODIR review) and Safety Action Groups — planned, held, minutes issued. */
export default async function Committees({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const { data } = await supabaseAdmin().from("committees").select("id,entity,entities,kind,number,title,topic,status,planned_on,starts_at,location,attendees,source,parent_id").overlaps("entities", scope).order("planned_on", { ascending: false }).limit(500);
  const all = (data ?? []) as Committee[];
  const rows = sp.k ? all.filter((c) => c.kind === sp.k) : all;
  const today = new Date().toISOString().slice(0, 10); const y = today.slice(0, 4);
  const edit = mayRun(s) && s.entity !== "ALL";
  const cad = (e: string) => {
    const held = all.filter((c) => c.entities.includes(e) && c.kind === "srb" && ["held", "closed"].includes(c.status) && (c.planned_on ?? "").startsWith(y)).length;
    const planned = all.filter((c) => c.entities.includes(e) && c.kind === "srb" && c.status === "planned" && (c.planned_on ?? "") >= today);
    const need = CADENCE[e]?.perYear ?? 2; const monthsLeft = 12 - Number(today.slice(5, 7));
    return { held, need, next: planned.sort((a, b) => (a.planned_on ?? "").localeCompare(b.planned_on ?? ""))[0], short: held + planned.filter((c) => (c.planned_on ?? "").startsWith(y)).length < need, monthsLeft };
  };
  const tab = (k: string, l: string) => <Link key={k} href={k ? `/safe/comm?k=${k}` : "/safe/comm"} className={"btn" + ((sp.k ?? "") === k ? " on" : "")}>{l}</Link>;
  const upcoming = rows.filter((c) => c.status === "planned" && (c.planned_on ?? "") >= today).sort((a, b) => (a.planned_on ?? "").localeCompare(b.planned_on ?? ""));
  const toClose = rows.filter((c) => c.status === "held" || (c.status === "planned" && (c.planned_on ?? "") < today));
  const past = rows.filter((c) => !upcoming.includes(c) && !toClose.includes(c));
  const Row = ({ c }: { c: Committee }) => (
    <tr>
      <td className="mono"><Link className="underline" href={`/safe/comm/${c.id}`}>{c.number}</Link>{(scope.length > 1 || isJoint(c)) && <div className="flex gap-1">{c.entities.map((e) => <span key={e} className={"ent " + e}>{e}</span>)}</div>}</td>
      <td><Link href={`/safe/comm/${c.id}`}><b>{c.title}</b></Link><div className="mini">{isJoint(c) ? `Joint meeting ${entitiesLabel(c)} · ` : ""}{kindName(c.entity, c.kind)}{c.location ? ` · ${c.location}` : ""}{c.source !== "sam" ? ` · from ${c.source === "centrik" ? "Centrik" : "SharePoint"}` : ""}</div></td>
      <td className="mono">{c.planned_on ?? "—"}</td>
      <td className="mini">{c.attendees.filter((a) => a.present).length ? `${c.attendees.filter((a) => a.present).length} present` : `${c.attendees.length} invited`}</td>
      <td><span className={"pill " + (c.status === "planned" && (c.planned_on ?? "") < today ? "amber" : STATUS[c.status]?.[1] ?? "")}>{c.status === "planned" && (c.planned_on ?? "") < today ? "Date passed — record it" : STATUS[c.status]?.[0]}</span></td>
    </tr>);
  const Table = ({ list, empty }: { list: Committee[]; empty: string }) => (
    <table className="tbl"><thead><tr><th style={{ width: 150 }}>Number</th><th>Meeting</th><th style={{ width: 110 }}>Date</th><th style={{ width: 110 }}>Attendance</th><th style={{ width: 190 }}>Status</th></tr></thead>
      <tbody>{list.map((c) => <Row key={c.id} c={c} />)}{!list.length && <tr><td colSpan={5} className="p-5 mini">{empty}</td></tr>}</tbody></table>);
  return (
    <>
      <PageHeader eyebrow="Safety · Safety assurance" title="Committees" sub="Safety Review Board — strategic, chaired by the AM, organised by the SM, with the nominated persons; Safety Action Groups — implementation on a topic, reporting to the SRB. Minutes record attendees, decisions and assigned actions." right={<>{tab("", "All")}{tab("srb", "Review boards")}{tab("sag", "Action groups")}</>} />
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(5, scope.length + 1)}, minmax(0, 1fr))` }}>
        {scope.filter((e) => e !== "TEC" || all.some((c) => c.entities.includes("TEC"))).map((e) => { const k = cad(e); return <Metric key={e} label={`${kindShort(e, "srb")} ${y} · ${e}`} value={`${k.held} / ${k.need}`} tone={k.short && k.monthsLeft < 3 ? "red" : k.short ? "amber" : "green"} hint={k.next ? `next ${k.next.planned_on}` : `${CADENCE[e]?.label ?? ""} (${CADENCE[e]?.ref ?? ""})`} />; })}
        <Metric label="Minutes to issue" value={toClose.length} tone={toClose.length ? "amber" : undefined} hint="held, or date passed" />
      </div>
      {toClose.length > 0 && <section className="card mb-5"><div className="ch"><span className="eyebrow">To record</span><span className="mini">attendance, notes, decisions, actions — then issue the minutes</span></div><Table list={toClose} empty="" /></section>}
      <section className="card mb-5"><div className="ch"><span className="eyebrow">Planned</span></div><Table list={upcoming} empty="Nothing planned." /></section>
      <section className="card mb-5"><div className="ch"><span className="eyebrow">Held</span><span className="mini">{past.length}</span></div><Table list={past} empty="No meeting recorded yet." /></section>
      {edit && <details className="card" open={!all.some((c) => c.entities.includes(s.entity))}><summary className="ch cursor-pointer"><span className="eyebrow">+ Plan a meeting</span><span className="mini">{ENT[s.entity]?.name ?? s.entity}</span></summary>
        <form action={planCommittee} className="cb grid grid-cols-6 gap-2">
          <input type="hidden" name="entity" value={s.entity} />
          <label><span className="mini">Kind</span><select name="kind" className="inp" defaultValue="srb"><option value="srb">{kindName(s.entity, "srb")}</option><option value="sag">Safety Action Group</option></select></label>
          <label><span className="mini">Date</span><input type="date" name="planned_on" className="inp" required /></label>
          <label><span className="mini">Start (UTC)</span><input type="time" name="time" className="inp" /></label>
          <label className="col-span-3"><span className="mini">Location / Teams</span><input name="location" className="inp" placeholder="Malta, Portomaso Tower · Teams" /></label>
          <label className="col-span-3"><span className="mini">SAG topic (recurring findings, FDM trend, event, function, RA briefing…)</span><input name="topic" className="inp" /></label>
          <label className="col-span-3"><span className="mini">Title (optional)</span><input name="title" className="inp" /></label>
          {s.entities.filter((e) => e !== s.entity).length > 0 && <div className="col-span-6 flex gap-3 items-center"><span className="mini">Joint meeting, also held for:</span>{s.entities.filter((e) => e !== s.entity).map((e) => <label key={e} className="mini"><input type="checkbox" name="also" value={e} /> {e}</label>)}<span className="mini">— one record, the same minutes and actions shown in each entity</span></div>}
          <div className="col-span-6 flex justify-between items-center"><span className="mini">The standing agenda of the MSM and the attendees (AM, nominated persons, CMM / SM and deputies) are prefilled — change them on the meeting page.</span><button className="btn primary">Plan</button></div>
        </form></details>}
    </>
  );
}
