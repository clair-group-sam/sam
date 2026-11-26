import { fr } from "@/lib/dates";
import { fr as frd } from "@/lib/dates";
import Link from "next/link";
import { DueChip } from "@/components/DueChip";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { APPL_LABEL, APPL_TONE, DOMAIN_LABEL, FAMILIES, loadTopics, OPEN_STATUSES, STATUS_LABEL, TASK_LABEL, type Entry, type Source } from "@/lib/watch";
import { createEntry, launchRound, saveTopic } from "./actions";

export const maxDuration = 60;

type Sp = { tab?: string; view?: string };
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
  // 10/11 · entries as a board by stage (Guillaume: « une liste infinie de liens »): what to analyse, what is in work, what waits to be closed
  const view = sp.view === "list" || tab === "closed" || tab === "all" ? (sp.view === "board" ? "board" : "list") : "board";
  const byDue = (a: Entry, b: Entry) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  const live = (e: Entry) => e.status === "open" || e.status === "in_progress";
  const cols = [
    { key: "an", label: "To analyse", sub: "does it concern us? S.A.M. finds where our manuals cite it", tone: "amber", list: rows.filter((e) => live(e) && e.applicability === "to_analyse").sort(byDue) },
    { key: "wk", label: "Applicable, in work", sub: "study or apply, owner and date", tone: "red", list: rows.filter((e) => live(e) && e.applicability === "applicable").sort(byDue) },
    { key: "dn", label: "Done, to close", sub: "Compliance checks the conclusion", tone: "green", list: rows.filter((e) => e.status === "done").sort(byDue) },
    { key: "in", label: "For information", sub: "recorded, nothing to do", tone: "", list: rows.filter((e) => live(e) && ["for_information", "not_applicable"].includes(e.applicability)).sort(byDue) },
    ...(tab === "closed" || tab === "all" ? [{ key: "cl", label: "Closed", sub: "the record", tone: "", list: rows.filter((e) => !OPEN_STATUSES.includes(e.status)).sort((a, b) => (b.due ?? "").localeCompare(a.due ?? "")) }] : []),
  ];
  const { data: ppl } = await db.from("people").select("id,display_name").limit(500);
  const name = (id: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === id)?.display_name ?? "—";
  const ents = scope ?? ENTS4;
  return (
    <>
      <PageHeader eyebrow="Regulation, Regulatory watch" title="Regulatory watch" sub="One stream per entity and family (regulatory, safety, manufacturer), from each MSM. The round on time is the proof; what we found and what we did is the record." right={desk ? <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Watch stream</summary>
        <form action={saveTopic} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 420, zIndex: 5 }}>
          <label><span className="mini">Title</span><input name="title" className="inp" required placeholder="Compliance watch. Astontec" /></label>
          <div className="grid grid-cols-2 gap-2"><label><span className="mini">Domain</span><select name="domain" className="inp" defaultValue="compliance">{Object.entries(DOMAIN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label><span className="mini">Every (days)</span><input name="every_days" type="number" className="inp" defaultValue={30} /></label></div>
          <div className="mini">Entities {ENTS4.map((e) => <label key={e} style={{ marginRight: 8 }}><input type="checkbox" name="entities" value={e} defaultChecked={scope?.includes(e)} /> {e}</label>)}</div>
          <div className="grid grid-cols-2 gap-2"><label><span className="mini">Owner, post</span><input name="owner_role" className="inp mono" defaultValue="CMM" /></label><label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue=""><option value="">—</option>{((ppl ?? []) as { id: string; display_name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label></div>
          <div className="flex justify-end"><button className="btn primary" type="submit">Create</button></div></form></details> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Watch streams" value={topics.length} tone={late.length ? "amber" : "green"} hint={late.length ? `${late.length} to check now` : "all checked on time"} />
        <Metric label="Open entries" value={open.length} hint={`${open.filter((e) => e.due && e.due < t0).length} past due`} tone={open.some((e) => e.due && e.due < t0) ? "red" : undefined} />
        <Metric label="To analyse" value={open.filter((e) => e.applicability === "to_analyse").length} />
        <Metric label="Applicable, in work" value={open.filter((e) => e.applicability === "applicable").length} />
      </div>

      <section className="card mb-5">
        <div className="ch"><span className="eyebrow">Watch rounds, as set by the MSMs</span>
          {desk && <form action={launchRound} className="flex gap-1">{FAMILIES.map(([k, l]) => <button key={k} className="btn" name="family" value={k} type="submit" title={`Read the public ${l.toLowerCase()} sources now`}>Launch {l}</button>)}<button className="btn primary" type="submit" title="Read the public sources of the three families">Launch all</button></form>}</div>
        <div className="cb mini" style={{ paddingBottom: 0 }}>S.A.M. never runs a round on its own: the Compliance department is reminded 3 days before each stream is due. Launching reads the public pages (each address once for all entities) and keeps what is new since the previous round; pages S.A.M. cannot read, or behind a login, stay to open.</div>
        <div className="grid grid-cols-3 gap-3 p-3">{FAMILIES.map(([k, l, sub]) => { const fam = topics.filter((t) => t.domain === k); return (
          <div key={k} className="wfam">
            <div className="flex items-center justify-between"><b>{l}</b><span className="mini">{sub}</span></div>
            {fam.map((t) => { const done = (x: Source) => !!x.last_checked_on && !!t.last_checked_on && x.last_checked_on >= t.last_checked_on && t.overdue < 0;
              const news = t.sources.reduce((n, x) => n + (x.last_result === "new" ? (x.last_new?.length ?? 0) : 0), 0);
              const toOpen = t.sources.filter((x) => (x.access === "open" || x.access === "login") && !done(x));
              const auto = t.sources.filter((x) => x.access === "read");
              return (
              <Link key={t.id} href={`/reg/watch/topic/${t.id}`} className={"wtopic" + (t.overdue >= 0 ? " late" : "")}>
                <div className="flex items-center justify-between"><span><span className="entdot" style={{ background: ENT_COLOR[t.entities[0]] ?? "var(--field)" }} /><b>{t.title.split(" — ")[0]}</b></span><span className={"pill " + (t.overdue >= 0 ? (t.overdue > 14 ? "red" : "amber") : "green")}>{t.overdue >= 0 ? (t.overdue === 9999 ? "never checked" : t.overdue === 0 ? "due today" : `${t.overdue} d late`) : `due in ${-t.overdue} d`}</span></div>
                <div className="mini">{auto.length} read by S.A.M.{news ? <b className="wnew">, {news} new to review</b> : ""}{toOpen.length ? `, ${toOpen.length} to open (${toOpen.filter((x) => x.access === "login").length} signed in)` : ""}</div>
                <div className="mini">{t.last_checked_on ? `last round ${frd(t.last_checked_on)}${t.last_checked_by ? `, ${name(t.last_checked_by)}` : ""}` : "no round recorded yet"}</div>
              </Link>); })}
            {!fam.length && <p className="mini">No stream in your scope.</p>}
          </div>); })}</div>
      </section>

      <div className="flex items-center justify-between mb-2" style={{ gap: 8, flexWrap: "wrap" }}><div className="tabs">{tabs.map(([k, l, n]) => <Link key={k} href={`/reg/watch?tab=${k}&view=${view}`} className={"tab" + (tab === k ? " on" : "")}>{l} <span className="mini">{n}</span></Link>)}</div>
        <div className="seg" style={{ display: "inline-flex", marginLeft: "auto" }}><Link href={`/reg/watch?tab=${tab}&view=board`} className={view === "board" ? "on" : ""}>Board</Link><Link href={`/reg/watch?tab=${tab}&view=list`} className={view === "list" ? "on" : ""}>List</Link></div>
        {desk && <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Entry</summary>
          <form action={createEntry} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 520, zIndex: 5 }}>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={ents[0]}>{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select></label><label><span className="mini">Watch stream</span><select name="topic" className="inp" defaultValue=""><option value="">—</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>
            <label><span className="mini">Title</span><input name="title" className="inp" required placeholder="ED Decision 2026/006/R. AMC/GM Part-FCL Amd 15…" /></label>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Reference (S.A.M. searches it in the manuals)</span><input name="reference" className="inp mono" placeholder="ORO.FC.230, AD 2026-0125R1" /></label><label><span className="mini">Link</span><input name="url" className="inp" /></label></div>
            <div className="grid grid-cols-3 gap-2"><label><span className="mini">Published</span><input type="date" name="published_on" className="inp" /></label><label><span className="mini">Applicable from</span><input type="date" name="applicable_on" className="inp" /></label><label><span className="mini">Return before</span><input type="date" name="due" className="inp" /></label></div>
            <div className="grid grid-cols-2 gap-2"><label><span className="mini">Tasked to, post</span><input name="owner_role" className="inp mono" placeholder="CMM, NPFO, NPCA…" /></label><label><span className="mini">Task</span><select name="task" className="inp" defaultValue=""><option value="">—</option>{Object.entries(TASK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
            <div className="flex justify-end"><button className="btn primary" type="submit">Raise</button></div></form></details>}
      </div>
      {view === "board" && rows.length > 0 ? (
        <div className="wboard">{cols.map((c) => (
          <div key={c.key} className={"wcol " + c.tone}>
            <div className="wcolh"><b>{c.label}</b><span className="wcount">{c.list.length}</span></div>
            <div className="mini wcolsub">{c.sub}</div>
            {c.list.slice(0, 10).map((e) => { const lateE = !!e.due && e.due < t0 && OPEN_STATUSES.includes(e.status); return (
              <Link key={e.id} href={`/reg/watch/${e.id}`} className={"wcard" + (lateE ? " late" : "")}>
                <div className="wct">{e.title}</div>
                <div className="wcm"><span className="entdot" style={{ background: ENT_COLOR[e.entity] ?? "var(--field)" }} />{e.entity}{e.reference ? <span className="mono"> · {e.reference.slice(0, 28)}</span> : null}</div>
                <div className="wcm"><span>{e.owner_person ? name(e.owner_person) : e.owner_role ?? "no owner"}</span>{e.due && <DueChip due={e.due} done={!OPEN_STATUSES.includes(e.status)} t0={t0} />}</div>
              </Link>); })}
            {c.list.length > 10 && <Link href={`/reg/watch?tab=${tab}&view=list`} className="mini wmore">+ {c.list.length - 10} more, see the list</Link>}
            {!c.list.length && <p className="mini wmore">Nothing.</p>}
          </div>))}</div>
      ) : <section className="card"><div className="cb" style={{ padding: 0 }}>
        {!rows.length ? <p className="p-4 mini">Nothing here.</p> : (
          <table className="tbl"><thead><tr><th>Entry</th><th>Reference</th><th>Applicability</th><th>Tasked to</th><th>Return before</th><th>Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="rowlink">
                <td><Link className="stretch" href={`/reg/watch/${e.id}`}><b className="mono">{e.number}</b> {e.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[e.entity] ?? "var(--field)" }} />{e.entity}{e.source_kind ? `, ${e.source_kind.toUpperCase()}` : ""}{e.domain ? `, ${e.domain}` : ""}{e.published_on ? `, published ${frd(e.published_on)}` : ""}</div></td>
                <td className="mono">{e.reference ?? "—"}</td>
                <td><span className={"pill " + (APPL_TONE[e.applicability] ?? "")}>{APPL_LABEL[e.applicability] ?? e.applicability}</span>{e.task && <div className="mini">{TASK_LABEL[e.task]}</div>}</td>
                <td>{e.owner_person ? name(e.owner_person) : e.owner_role ?? "—"}</td>
                <td className={e.due && e.due < t0 && OPEN_STATUSES.includes(e.status) ? "late" : ""}>{fr(e.due)}</td>
                <td><span className={"pill " + (e.status === "closed" ? "green" : e.status === "done" ? "amber" : "")}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
              </tr>))}</tbody></table>)}
      </div></section>}
    </>
  );
}
