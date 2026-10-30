import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT_COLOR } from "@/lib/nav";
import { CMM_TURN, LEVEL_LABEL, NP_TURN, OPEN_STATUSES, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, type Finding } from "@/lib/findings";

type Sp = { tab?: string };
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
  const all = (data ?? []) as Finding[];
  const compliance = s.role === "cmm";
  const posts = s.roles.map(basePost);
  const mine = (f: Finding) => (f.owner_person && f.owner_person === s.person?.id) || (f.owner_role && posts.includes(basePost(f.owner_role)));
  const open = all.filter((f) => OPEN_STATUSES.includes(f.status));
  const t0 = new Date().toISOString().slice(0, 10);
  const tab = sp.tab ?? (compliance ? "open" : "mine");
  const rows = tab === "mine" ? open.filter(mine) : tab === "review" ? open.filter((f) => CMM_TURN.includes(f.status)) : tab === "closed" ? all.filter((f) => !OPEN_STATUSES.includes(f.status)) : tab === "all" ? all : open;
  const tabs: [string, string, number][] = [["mine", "Mine", open.filter(mine).length], ["open", "Open", open.length], ["review", "To review", open.filter((f) => CMM_TURN.includes(f.status)).length], ["closed", "Closed", all.length - open.length], ["all", "All", all.length]];
  return (
    <>
      <PageHeader eyebrow="Compliance · Findings" title="Findings" sub="Authority and internal audit findings: the nominated person analyses and plans, S.A.M. pre-reads, Compliance decides, the plan is followed to closure." right={compliance ? <Link className="btn primary" href="/comp/find/new">+ Raise a finding</Link> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open" value={open.length} hint={`${open.filter((f) => f.level === "1").length} level 1`} />
        <Metric label="Waiting for an answer" value={open.filter((f) => NP_TURN.includes(f.status)).length} tone={open.some((f) => NP_TURN.includes(f.status) && f.due && f.due < t0) ? "red" : undefined} hint={`${open.filter((f) => NP_TURN.includes(f.status) && f.due && f.due < t0).length} past due`} />
        <Metric label="To review (Compliance)" value={open.filter((f) => CMM_TURN.includes(f.status)).length} />
        <Metric label="Plan in progress" value={open.filter((f) => f.status === "accepted").length} />
      </div>
      <div className="tabs mb-3">{tabs.map(([k, l, n]) => <Link key={k} href={`/comp/find?tab=${k}`} className={"tab" + (tab === k ? " on" : "")}>{l} <span className="mini">{n}</span></Link>)}</div>
      <section className="card">
        <div className="cb" style={{ padding: 0 }}>
          {!rows.length ? <p className="p-4 mini">Nothing here.</p> : (
            <table className="tbl">
              <thead><tr><th>Finding</th><th>Requirement</th><th>Level</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td><Link href={`/comp/find/${f.id}`}><b className="mono">{f.number}</b> {f.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[f.entity] ?? "#888" }} />{f.entity} · {SOURCE_LABEL[f.source] ?? f.source}{f.authority ? ` · ${f.authority}` : ""}{f.audit_ref ? ` · ${f.audit_ref}` : ""}</div></td>
                    <td className="mono">{f.requirement ?? "—"}</td>
                    <td>{LEVEL_LABEL[f.level] ?? f.level}</td>
                    <td>{f.owner_role ?? "person"}</td>
                    <td className={f.due && f.due < t0 && OPEN_STATUSES.includes(f.status) ? "late" : ""}>{f.due ?? "—"}</td>
                    <td><span className={"pill " + (STATUS_TONE[f.status] ?? "")}>{STATUS_LABEL[f.status] ?? f.status}</span>{f.current_round > 1 && <div className="mini">round {f.current_round}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
