import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { APPL_LABEL, DOMAIN_LABEL, KIND_LABEL, OPEN_STATUSES, STATUS_LABEL, TASK_LABEL, type Check, type Entry, type Source, type Topic } from "@/lib/watch";
import { addDays } from "@/lib/authority";
import { archiveTopic, checkSource, createEntry, removeSource, saveSource, saveTopic } from "../../actions";

/* REG-01 · one watch stream: its sources as a checklist (nothing new / raise an entry / not reachable), the log of checks, its entries. */
export default async function WatchTopic({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data: td } = await db.from("watch_topics").select("*").eq("id", id).maybeSingle();
  if (!td) notFound();
  const t = td as Topic;
  const desk = s.role === "cmm";
  const owner = (!!t.owner_person && t.owner_person === s.person?.id) || (!!t.owner_role && s.roles.map(basePost).includes(basePost(t.owner_role)) && t.entities.some((e) => s.entities.includes(e)));
  const may = desk || owner;
  const [{ data: sd }, { data: cd }, { data: ed }, { data: ppl }] = await Promise.all([
    db.from("watch_sources").select("*").eq("topic_id", t.id).eq("active", true).order("name"),
    db.from("watch_checks").select("*").eq("topic_id", t.id).order("checked_on", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    db.from("watch_entries").select("*").eq("topic_id", t.id).order("created_at", { ascending: false }).limit(300),
    db.from("people").select("id,display_name").limit(500),
  ]);
  const sources = (sd ?? []) as Source[], checks = (cd ?? []) as Check[], entries = (ed ?? []) as Entry[];
  const name = (pid: string | null) => ((ppl ?? []) as { id: string; display_name: string }[]).find((p) => p.id === pid)?.display_name ?? "—";
  const t0 = new Date().toISOString().slice(0, 10);
  const nextDue = t.last_checked_on ? addDays(t.last_checked_on, t.every_days) : null;
  const fresh = (x: Source) => !!x.last_checked_on && (!t.last_checked_on || x.last_checked_on >= t.last_checked_on) && x.last_checked_on >= addDays(t0, -Math.min(t.every_days, 30));
  const open = entries.filter((e) => OPEN_STATUSES.includes(e.status));
  return (
    <>
      <PageHeader eyebrow={`Compliance · Regulatory watch · ${DOMAIN_LABEL[t.domain] ?? t.domain}`} title={t.title} sub={`${t.entities.map((e) => ENT[e]?.name ?? e).join(" · ")} · every ${t.every_days} days · owner ${t.owner_person ? name(t.owner_person) : t.owner_role ?? "—"}`}
        right={<Link className="btn" href="/comp/watch">← All streams</Link>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Last check" value={t.last_checked_on ?? "never"} hint={t.last_checked_by ? `by ${name(t.last_checked_by)}` : ""} />
        <Metric label="Next due" value={nextDue ?? "now"} tone={!nextDue || nextDue <= t0 ? "amber" : "green"} />
        <Metric label="Sources" value={sources.length} hint={`${sources.filter(fresh).length} looked at this round`} />
        <Metric label="Open entries" value={open.length} />
      </div>
      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="grid gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">Sources — this round</span><span className="mini">open each one, then tick</span></div>
            <div className="cb" style={{ padding: 0 }}>
              <table className="tbl"><tbody>{sources.map((x) => (
                <tr key={x.id} className={fresh(x) ? "fresh" : ""}>
                  <td>{x.url ? <a href={x.url} target="_blank" rel="noreferrer"><b>{x.name}</b> ↗</a> : <b>{x.name}</b>}<div className="mini">{KIND_LABEL[x.kind] ?? x.kind}{x.domain ? ` · ${x.domain}` : ""}{x.last_checked_on ? ` · last ${x.last_checked_on} (${x.last_result === "entries" ? "entries raised" : x.last_result === "not_reachable" ? "not reachable" : "nothing new"})` : " · never checked"}</div>{x.note && <div className="mini">{x.note}</div>}
                    {desk && <details className="mini"><summary>edit</summary><form action={saveSource} className="grid grid-cols-3 gap-1 mt-1"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="topic" value={t.id} /><input name="name" className="inp" defaultValue={x.name} /><select name="kind" className="inp" defaultValue={x.kind}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input name="domain" className="inp" defaultValue={x.domain ?? ""} placeholder="OPS / CAMO / ATO" /><input name="url" className="inp col-span-2" defaultValue={x.url ?? ""} /><input name="note" className="inp" defaultValue={x.note ?? ""} placeholder="note" /><div className="col-span-3 flex gap-1 justify-end"><button className="btn" type="submit">Save</button></div></form><form action={removeSource} className="flex justify-end"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="topic" value={t.id} /><button className="btn mini" type="submit">Remove</button></form></details>}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>{fresh(x) ? <span className="pill green">✓ {x.last_checked_on}</span> : may ? (
                    <form action={checkSource} className="flex gap-1 justify-end"><input type="hidden" name="topic" value={t.id} /><input type="hidden" name="source" value={x.id} />
                      <button className="btn" name="result" value="nothing_new" title="Nothing new since the last check">Nothing new</button>
                      <button className="btn mini" name="result" value="not_reachable" title="Portal down / login failed">Not reachable</button></form>) : <span className="mini">—</span>}
                    {!fresh(x) && may && <details className="mini" style={{ textAlign: "left" }}><summary className="btn primary" style={{ display: "inline-block", marginTop: 4 }}>Raise an entry</summary>
                      <form action={createEntry} className="grid gap-1 mt-1" style={{ width: 360 }}><input type="hidden" name="topic" value={t.id} /><input type="hidden" name="source" value={x.id} /><input type="hidden" name="stay" value="1" />
                        <select name="entity" className="inp" defaultValue={t.entities[0]}>{t.entities.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select>
                        <input name="title" className="inp" required placeholder="What was published" /><input name="reference" className="inp mono" placeholder="Reference (searched in the manuals)" /><input name="url" className="inp" placeholder="Link" />
                        <div className="grid grid-cols-2 gap-1"><input type="date" name="published_on" className="inp" /><input type="date" name="due" className="inp" title="Return before" /></div>
                        <div className="grid grid-cols-2 gap-1"><input name="owner_role" className="inp mono" placeholder={`Tasked to (post) · default ${t.owner_role ?? "CMM"}`} /><select name="task" className="inp" defaultValue="study">{Object.entries(TASK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                        <div className="flex justify-end"><button className="btn primary" type="submit">Raise the entry</button></div></form></details>}
                  </td>
                </tr>))}</tbody></table>
              {may && sources.length > 0 && !sources.every(fresh) && <form action={checkSource} className="p-3 flex items-center justify-between mini" style={{ borderTop: "1px solid var(--line)" }}><input type="hidden" name="topic" value={t.id} /><span>Everything opened, nothing new anywhere?</span><button className="btn" name="result" value="nothing_new" type="submit">Record the round as done</button></form>}
              {desk && <details className="p-3 mini" style={{ borderTop: "1px solid var(--line)" }}><summary>+ Source</summary><form action={saveSource} className="grid grid-cols-3 gap-1 mt-1"><input type="hidden" name="topic" value={t.id} /><input name="name" className="inp" required placeholder="Name" /><select name="kind" className="inp" defaultValue="misc">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input name="domain" className="inp" placeholder="OPS / CAMO / ATO" /><input name="url" className="inp col-span-3" placeholder="https://…" /><div className="col-span-3 flex justify-end"><button className="btn" type="submit">Add</button></div></form></details>}
            </div>
          </section>
          <section className="card">
            <div className="ch"><span className="eyebrow">Checks — the record</span><span className="mini">{checks.length} check{checks.length === 1 ? "" : "s"}</span></div>
            <div className="cb mini" style={{ maxHeight: 320, overflow: "auto" }}>{checks.length ? checks.map((c) => <div key={c.id}>{c.checked_on} · {c.source_id ? sources.find((x) => x.id === c.source_id)?.name ?? "source" : "whole stream"} · {c.result === "entries" ? "entries raised" : c.result === "not_reachable" ? "not reachable" : "nothing new"} · {name(c.checked_by)}{c.note ? ` — ${c.note}` : ""}</div>) : "No check recorded yet."}</div>
          </section>
        </div>
        <div className="grid gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">Entries of this stream</span><span className="mini">{open.length} open · {entries.length - open.length} closed</span></div>
            <div className="cb" style={{ padding: 0 }}>{entries.length ? <table className="tbl"><tbody>{entries.slice(0, 80).map((e) => <tr key={e.id}><td><Link href={`/comp/watch/${e.id}`}><b className="mono">{e.number}</b> {e.title}</Link><div className="mini"><span className="entdot" style={{ background: ENT_COLOR[e.entity] ?? "#888" }} />{e.entity} · {APPL_LABEL[e.applicability]}{e.due ? ` · return before ${e.due}` : ""}</div></td><td style={{ textAlign: "right" }}><span className={"pill " + (e.status === "closed" ? "green" : OPEN_STATUSES.includes(e.status) ? "amber" : "")}>{STATUS_LABEL[e.status]}</span></td></tr>)}</tbody></table> : <p className="p-4 mini">No entry yet.</p>}</div>
          </section>
          {desk && <details className="card"><summary className="ch" style={{ cursor: "pointer" }}><span className="eyebrow">Stream settings</span></summary>
            <div className="cb"><form action={saveTopic} className="grid gap-2"><input type="hidden" name="id" value={t.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={t.title} /></label>
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Domain</span><select name="domain" className="inp" defaultValue={t.domain}>{Object.entries(DOMAIN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label><span className="mini">Every (days)</span><input name="every_days" type="number" className="inp" defaultValue={t.every_days} /></label></div>
              <div className="mini">Entities {ENTS4.map((e) => <label key={e} style={{ marginRight: 8 }}><input type="checkbox" name="entities" value={e} defaultChecked={t.entities.includes(e)} /> {e}</label>)}</div>
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Owner — post</span><input name="owner_role" className="inp mono" defaultValue={t.owner_role ?? ""} /></label><label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue={t.owner_person ?? ""}><option value="">—</option>{((ppl ?? []) as { id: string; display_name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label></div>
              <div className="flex justify-end gap-2"><button className="btn" type="submit">Save</button></div></form>
              <form action={archiveTopic} className="flex justify-end mt-2"><input type="hidden" name="id" value={t.id} /><button className="btn mini" type="submit">Archive this stream</button></form></div></details>}
        </div>
      </div>
    </>
  );
}
