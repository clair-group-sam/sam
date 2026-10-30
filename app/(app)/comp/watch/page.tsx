import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { APPL_LABEL, APPL_TONE, DOMAIN_LABEL, loadTopics, OPEN_STATUSES, STATUS_LABEL, TASK_LABEL, type Entry } from "@/lib/watch";
import { createEntry, saveTopic } from "./actions";

type Sp = { tab?: string };
/* REG-01 · Compliance › Regulatory watch. Top: the watch streams (topics) and whether they were checked on time — the proof.
 * Below: the entries — what concerns us, who handles it, what was done. */
export default async function RegulatoryWatch({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin();
  const desk = s.role === "cmm";
  const topics = await loadTopics(db, scope);
  let q = db.from("watch_entries").select("*").order("due", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(1500);
  if (scope) q = q.in("entity", scope);
  const { data } = await q;
  const all = (data ?? []) as Entry[];
  const posts = s.roles.map(basePost);
  const mine = (e: Entry) => (e.owner_person && e.owner_person === s.person?.id) || (e.owner_role && posts.includes(basePost(e.owner_role)));
  const open = all.filter((e) => OPEN_STATUSES.includes(e.status));
  const t0 = new Date().toISOString().slice(0, 10);
  const tab = sp.tab ?? (desk ? "open" : "mine");
  const rows = tab === "mine" ? open.filter(mine) : tab === "analyse" ? open.filter((e) => e.applicability === "to_analyse") : tab === "closed" ? all.filter((e) => !OPEN_STATUSES.includes(e.status)) : tab === "all" ? all : open;
  const tabs: [string, string, number][] = [["mine", "Mine", open.filter(mine).length], ["open", "Open", open.length], ["analyse", "To analyse", open.filter((e) => e.applicability === "to_analyse").length], ["closed", "Closed", all.length - open.length], ["all", "All", all.length]];
  const late = topics.filter((t) => t.overdue >= 0);
  const { data: ppl } = await db.from("people").select("id,display_name").limit(500);
  const name = (id: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === id)?.display_name ?? "—";
  const ents = scope ?? ENTS4;
  return (
    <>
      <PageHeader eyebrow="Compliance · Regulatory watch" title="Regulatory watch" sub="Each watch stream has an owner, a cadence and its sources. Opening the sources on time is the proof; what we found and what we did is the record." right={desk ? <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Watch stream</summary>
        <form action={saveTopic} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 420, zIndex: 5 }}>
          <label><span className="mini">Title</span><input name="title" className="inp" required placeholder="Compliance watch — Astontec" /></label>
          <div className="grid grid-cols-2 gap-2"><label><span className="mini">Domain</span><select name="domain" className="inp" defaultValue="compliance">{Object.entries(DOMAIN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label><span className="mini">Every (days)</span><input name="every_days" type="number" className="inp" defaultValue={30} /></label></div>
          <div className="mini">Entities {ENTS4.map((e) => <label key={e} style={{ marginRight: 8 }}><input type="checkbox" name="entities" value={e} defaultChecked={scope?.includes(e)} /> {e}</label>)}</div>
          <div className="grid grid-cols-2 gap-2"><label><span className="mini">Owner — post</span><input name="owner_role" className="inp mono" defaultValue="CMM" /></label><label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue=""><option value="">—</option>{((ppl ?? []) as { id: string; display_name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label></div>
          <div className="flex justify-end"><button className="btn primary" type="submit">Create</button></div></form></details> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Watch streams" value={topics.length} tone={late.length ? "amber" : "green"} hint={late.length ? `${late.length} to check now` : "all checked on time"} />
        <Metric label="Open entries" value={open.length} hint={`${open.filter((e) => e.due && e.due < t0).length} past due`} tone={open.some((e) => e.due && e.due < t0) ? "red" : undefined} />
        <Metric label="To analyse" value={open.filter((e) => e.applicability === "to_analyse").length} />
        <Metric label="Applicable, in work" value={open.filter((e) => e.applicability === "applicable").length} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {topics.map((t) => (
          <Link key={t.id} href={`/comp/watch/topic/${t.id}`} className={"card wtopic" + (t.overdue >= 0 ? " late" : "")}>
            <div className="ch"><span className="eyebrow">{DOMAIN_LABEL[t.domain] ?? t.domain}</span><span className={"pill " + (t.overdue >= 0 ? (t.overdue > 14 ? "red" : "amber") : "green")}>{t.overdue >= 0 ? (t.overdue === 9999 ? "never checked" : t.overdue === 0 ? "due today" : `${t.overdue} d late`) : `due in ${-t.overdue} d`}</span></div>
            <div className="cb"><b>{t.title}</b><div className="mini mt-1">{t.entities.map((e) => <span key={e}><span className="entdot" style={{ background: ENT_COLOR[e] ?? "#888" }} />{e} </span>)}· {t.sources.length} source{t.sources.length === 1 ? "" : "s"} · every {t.every_days} d · {t.owner_person ? name(t.owner_person) : t.owner_role ?? "—"}</div>
              <div className="mini">{t.last_checked_on ? `last check ${t.last_checked_on}${t.last_checked_by ? ` · ${name(t.last_checked_by)}` : ""}` : "no check recorded yet"}</div></div>
          </Link>
        ))}
        {!topics.length && <section className="card"><div className="cb mini">No watch stream in your scope yet.</div></section>}
      </div>

      <div className="flex items-center justify-between mb-2"><div className="tabs">{tabs.map(([k, l, n]) => <Link key={k} href={`/comp/watch?tab=${k}`} className={"tab" + (tab === k ? " on" : "")}>{l} <span className="mini">{n}</span></Link>)}</div>
        {desk && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Entry</summary>
          <form action={createEntry} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 520, zIndex: 5 }}>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={ents[0]}>{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select></label><label><span className="mini">Watch stream</span><select name="topic" className="inp" defaultValue=""><option value="">—</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>
            <label><span className="mini">Title</span><input name="title" className="inp" required placeholder="ED Decision 2026/006/R — AMC/GM Part-FCL Amd 15…" /></label>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Reference (S.A.M. searches it in the manuals)</span><input name="reference" className="inp mono" placeholder="ORO.FC.230 · AD 2026-0125R1" /></label><label><span className="mini">Link</span><input name="url" className="inp" /></label></div>
            <div className="grid grid-cols-3 gap-2"><label><span className="mini">Published</span><input type="date" name="published_on" className="inp" /></label><label><span className="mini">Applicable from</span><input type="date" name="applicable_on" className="inp" /></label><label><span className="mini">Return before</span><input type="date" name="due" className="inp" /></label></div>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Tasked to — post</span><input name="owner_role" className="inp mono" placeholder="CMM, NPFO, NPCA…" /></label><label><span className="mini">Task</span><select name="task" className="inp" defaultValue=""><option value="">—</option>{Object.entries(TASK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
            <div className="flex justify-end"><button className="btn primary" type="submit">Raise</button></div></form></details>}
      </div>
      <section className="card"><div className="cb" style={{ padding: 0 }}>
        {!rows.length ? <p className="p-4 mini">Nothing here.</p> : (
          <table className="tbl"><thead><tr><th>Entry</th><th>Reference</th><th>Applicability</th><th>Tasked to</th><th>Return before</th><th>Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <td><Link href={`/comp/watch/${e.id}`}><b className="mono">{e.number}</b> {e.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[e.entity] ?? "#888" }} />{e.entity}{e.source_kind ? ` · ${e.source_kind.toUpperCase()}` : ""}{e.domain ? ` · ${e.domain}` : ""}{e.published_on ? ` · published ${e.published_on}` : ""}</div></td>
                <td className="mono">{e.reference ?? "—"}</td>
                <td><span className={"pill " + (APPL_TONE[e.applicability] ?? "")}>{APPL_LABEL[e.applicability] ?? e.applicability}</span>{e.task && <div className="mini">{TASK_LABEL[e.task]}</div>}</td>
                <td>{e.owner_person ? name(e.owner_person) : e.owner_role ?? "—"}</td>
                <td className={e.due && e.due < t0 && OPEN_STATUSES.includes(e.status) ? "late" : ""}>{e.due ?? "—"}</td>
                <td><span className={"pill " + (e.status === "closed" ? "green" : e.status === "done" ? "amber" : "")}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
              </tr>))}</tbody></table>)}
      </div></section>
    </>
  );
}
