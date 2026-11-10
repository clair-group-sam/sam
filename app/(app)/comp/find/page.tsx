import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT_COLOR } from "@/lib/nav";
import { CMM_TURN, guessType, TYPE_LABEL, LEVEL_LABEL, NP_TURN, OPEN_STATUSES, progress, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, type Change, type Finding } from "@/lib/findings";
import type { Action } from "@/lib/actions-shared";

type Sp = { tab?: string; src?: string; view?: string };
/** Compliance › Findings: every audit / authority finding, who holds it, what S.A.M. waits for. */
export default async function Findings({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  let q = db.from("findings").select("*").order("due", { ascending: true, nullsFirst: false }).limit(1000);
  if (!(s.group && s.entity === "ALL")) q = q.in("entity", scope);
  const { data } = await q;
  const every = (data ?? []) as Finding[];
  // two registers (Guillaume 10/11): findings raised by the authority · findings we raise ourselves (internal audits, checks, subcontractors)
  const src = sp.src === "authority" ? "authority" : "internal";
  const all = every.filter((f) => (f.source === "authority") === (src === "authority"));
  const nAuth = every.filter((f) => f.source === "authority").length, nInt = every.length - nAuth;
  // FND-04 · the work done on each finding, visible without opening it
  const ids = all.map((f) => f.id);
  const [{ data: chs }, { data: acs }] = ids.length ? await Promise.all([db.from("finding_changes").select("*").in("finding_id", ids).neq("status", "removed").limit(5000), db.from("safety_actions").select("*").in("finding_id", ids).neq("status", "cancelled").limit(5000)]) : [{ data: [] }, { data: [] }];
  const chBy = new Map<string, Change[]>(), acBy = new Map<string, Action[]>();
  for (const c of (chs ?? []) as Change[]) chBy.set(c.finding_id, [...(chBy.get(c.finding_id) ?? []), c]);
  for (const a of (acs ?? []) as (Action & { finding_id: string })[]) acBy.set(a.finding_id, [...(acBy.get(a.finding_id) ?? []), a]);
  // 10/11 · findings grouped by the audit they come from (Guillaume); the flat list stays one click away
  const view = sp.view === "list" ? "list" : "audit";
  const aids = [...new Set(all.map((f) => f.audit_id).filter(Boolean))] as string[];
  const { data: aus } = aids.length ? await db.from("audits").select("id,number,title,kind,authority,external_auditor,done_on,planned_month,planned_on").in("id", aids) : { data: [] };
  const auditOf = new Map(((aus ?? []) as { id: string; number: string; title: string; kind: string; authority: string | null; external_auditor: string | null; done_on: string | null; planned_month: string; planned_on: string | null }[]).map((a) => [a.id, a]));
  const prog = (f: Finding) => progress(f, chBy.get(f.id) ?? [], acBy.get(f.id) ?? []);
  const compliance = s.role === "cmm";
  const posts = s.roles.map(basePost);
  const mine = (f: Finding) => (f.owner_person && f.owner_person === s.person?.id) || (f.owner_role && posts.includes(basePost(f.owner_role)));
  const open = all.filter((f) => OPEN_STATUSES.includes(f.status));
  const t0 = new Date().toISOString().slice(0, 10);
  const tab = sp.tab ?? (compliance ? "open" : "mine");
  const rows = tab === "mine" ? open.filter(mine) : tab === "review" ? open.filter((f) => CMM_TURN.includes(f.status)) : tab === "closed" ? all.filter((f) => !OPEN_STATUSES.includes(f.status)) : tab === "all" ? all : open;
  const tabs: [string, string, number][] = [["mine", "Mine", open.filter(mine).length], ["open", "Open", open.length], ["review", "To review", open.filter((f) => CMM_TURN.includes(f.status)).length], ["closed", "Closed", all.length - open.length], ["all", "All", all.length]];
  const Table = (list: Finding[]) => (
    <table className="tbl">
      <thead><tr><th>Finding</th><th>Type</th><th>Requirement</th><th>Level</th><th>Owner</th><th>Due</th><th>Status</th><th>Work done</th></tr></thead>
      <tbody>
{list.map((f) => (
                  <tr key={f.id} className="rowlink">
                    <td><Link className="stretch" href={`/comp/find/${f.id}`}><b className="mono">{f.number}</b> {f.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[f.entity] ?? "var(--field)" }} />{f.entity}, {SOURCE_LABEL[f.source] ?? f.source}{f.authority ? `, ${f.authority}` : ""}{f.audit_ref ? `, ${f.audit_ref}` : ""}</div></td>
                    <td className="mini">{TYPE_LABEL[f.finding_type ?? guessType(f)]?.split(" (")[0]}{!f.finding_type && <span title="proposed by S.A.M."> ·?</span>}</td>
                    <td className="mono mini" style={{ maxWidth: 180 }}>{f.requirement ?? "—"}</td>
                    <td>{LEVEL_LABEL[f.level] ?? f.level}</td>
                    <td>{f.owner_role ?? "person"}</td>
                    <td className={f.due && f.due < t0 && OPEN_STATUSES.includes(f.status) ? "late" : ""}>{f.due ?? "—"}</td>
                    <td><span className={"pill " + (STATUS_TONE[f.status] ?? "")}>{STATUS_LABEL[f.status] ?? f.status}</span>{f.current_round > 1 && <div className="mini">round {f.current_round}</div>}</td>
                    {(() => { const p = prog(f); return <td style={{ minWidth: 190 }}><div className="flex items-center gap-2"><span className="wbar" title={`${p.pct} %`}><i style={{ width: `${p.pct}%` }} className={p.tone || undefined} /></span><span className={"mini " + (p.tone === "red" ? "late" : "")} style={p.tone === "green" ? { color: "var(--green)" } : undefined}>{p.label}</span></div>{p.detail.length > 0 && <div className="mini">{p.detail.join(" · ")}</div>}</td>; })()}
                  </tr>
                ))}
      </tbody>
    </table>);
  const gmap = new Map<string, Finding[]>();
  for (const f of rows) { const k = f.audit_id ?? "none"; gmap.set(k, [...(gmap.get(k) ?? []), f]); }
  const groups = [...gmap.entries()].map(([key, list]) => { const audit = key === "none" ? null : auditOf.get(key) ?? null; const op = list.filter((f) => OPEN_STATUSES.includes(f.status));
    return { key, audit, list, open: op.length, closed: list.length - op.length, late: op.filter((f) => f.due && f.due < t0).length, sort: audit ? (audit.done_on ?? audit.planned_month) : "0000" }; })
    .sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || b.sort.localeCompare(a.sort));
  return (
    <>
      <PageHeader eyebrow="Compliance, Findings" title="Findings" sub="Authority and internal audit findings: the nominated person analyses and plans, S.A.M. pre-reads, Compliance decides, the plan is followed to closure." right={compliance ? <Link className="btn primary" href="/comp/find/new">+ Raise a finding</Link> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open" value={open.length} hint={`${open.filter((f) => f.level === "1").length} level 1`} />
        <Metric label="Waiting for an answer" value={open.filter((f) => NP_TURN.includes(f.status)).length} tone={open.some((f) => NP_TURN.includes(f.status) && f.due && f.due < t0) ? "red" : undefined} hint={`${open.filter((f) => NP_TURN.includes(f.status) && f.due && f.due < t0).length} past due`} />
        <Metric label="To review (Compliance)" value={open.filter((f) => CMM_TURN.includes(f.status)).length} />
        <Metric label="Plan in progress" value={open.filter((f) => f.status === "accepted").length} hint={`${open.filter((f) => f.status === "accepted" && prog(f).label.startsWith("Work done")).length} with the work done`} />
      </div>
      <div className="seg mb-3" style={{ display: "inline-flex" }}>
        <Link href="/comp/find?src=internal" className={src === "internal" ? "on" : ""}>Internal findings <span className="mini">{nInt}</span></Link>
        <Link href="/comp/find?src=authority" className={src === "authority" ? "on" : ""}>Authority findings <span className="mini">{nAuth}</span></Link>
      </div>
      <div className="flex items-center justify-between mb-3" style={{ flexWrap: "wrap", gap: 8 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>{tabs.map(([k, l, n]) => <Link key={k} href={`/comp/find?src=${src}&tab=${k}&view=${view}`} className={"tab" + (tab === k ? " on" : "")}>{l} <span className="mini">{n}</span></Link>)}</div>
        <div className="seg" style={{ display: "inline-flex" }}><Link href={`/comp/find?src=${src}&tab=${tab}&view=audit`} className={view === "audit" ? "on" : ""}>By audit</Link><Link href={`/comp/find?src=${src}&tab=${tab}&view=list`} className={view === "list" ? "on" : ""}>List</Link></div>
      </div>
      {!rows.length ? <section className="card"><div className="cb"><p className="mini">Nothing here.</p></div></section> : view === "list" ? <section className="card"><div className="cb" style={{ padding: 0 }}>{Table(rows)}</div></section> : groups.map((g) => (
        <section key={g.key} className="card mb-3">
          <div className="ch" style={{ flexWrap: "wrap", gap: 8 }}>
            <span>{g.audit ? <Link href={`/comp/audits/${g.audit.id}`}><b className="mono">{g.audit.number}</b> <b>{g.audit.title}</b></Link> : <b>Not linked to an audit</b>}
              {g.audit && <span className="mini"> · {g.audit.authority ?? g.audit.external_auditor ?? ""}{g.audit.done_on ? `, ${g.audit.done_on}` : g.audit.planned_on ? `, ${g.audit.planned_on}` : ""}</span>}</span>
            <span className="flex items-center gap-2"><span className="fstack" title={`${g.open} open, ${g.closed} closed`}><i className="o" style={{ flex: g.open }} /><i className="c" style={{ flex: g.closed }} /></span><span className="mini"><b>{g.open}</b> open, {g.closed} closed{g.late ? <>, <span className="late">{g.late} past due</span></> : null}</span></span>
          </div>
          <div className="cb" style={{ padding: 0 }}>{Table(g.list)}</div>
        </section>))}
      {(() => { // heatmap of open findings: category × cause (Centrik model), only when the fields are used
        type FX = Finding & { category?: string | null; cause?: string | null; repeat?: boolean | null };
        const fx = open as FX[]; const cats = [...new Set(fx.map((f) => f.category).filter(Boolean))] as string[]; const causes = [...new Set(fx.map((f) => f.cause).filter(Boolean))] as string[];
        if (!cats.length || !causes.length) return null;
        const n = (c: string, k: string) => fx.filter((f) => f.category === c && f.cause === k).length; const max = Math.max(1, ...cats.flatMap((c) => causes.map((k) => n(c, k))));
        return <section className="card mt-4"><div className="ch"><span className="eyebrow">Open findings, category × cause</span><span className="mini">{fx.filter((f) => f.repeat).length} repeat</span></div><div className="cb" style={{ overflow: "auto" }}>
          <table className="matrix"><thead><tr><th></th>{causes.map((k) => <th key={k}>{k}</th>)}<th>Total</th></tr></thead><tbody>{cats.map((c) => <tr key={c}><td style={{ textAlign: "left" }}><b>{c}</b></td>{causes.map((k) => { const v = n(c, k); return <td key={k} style={{ background: v ? `rgba(226,6,18,${0.12 + 0.6 * v / max})` : undefined, color: v / max > 0.5 ? "var(--white)" : undefined }}>{v || ""}</td>; })}<td><b>{fx.filter((f) => f.category === c).length}</b></td></tr>)}</tbody></table>
        </div></section>; })()}
    </>
  );
}
