import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT_COLOR, ENTS4 } from "@/lib/nav";
import { citedTexts, type RegVersion, type Regulation } from "@/lib/regulation";
type RegRow = Regulation & { items_version: string | null; items_count: number | null; items_loaded_at: string | null; items_note: string | null };
import { archiveRegulation, checkNow, recordByHand, saveRegulation } from "./actions";
import { RegItemsLoad } from "@/components/RegItemsLoad";

type Sp = { cited?: string };
/* REG-02 · Regulation › Easy Access Rules. The texts we work with, always in the version EASA publishes today (checked every evening);
 * a new version replaces the previous one here and raises an entry "to analyse" in the regulatory watch. */
export default async function EasyAccessRules({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? (s.group ? ENTS4 : s.entities) : [s.entity];
  const db = supabaseAdmin();
  const desk = s.role === "cmm";
  const { data } = await db.from("regulations").select("*").eq("active", true).order("sort").order("short");
  const regs = ((data ?? []) as RegRow[]).filter((r) => r.entities.some((e) => scope.includes(e)));
  const ids = regs.map((r) => r.id);
  const { data: vd } = ids.length ? await db.from("regulation_versions").select("*").in("regulation_id", ids).order("seen_on", { ascending: false }) : { data: [] };
  const versions = (vd ?? []) as RegVersion[];
  const { data: wd } = ids.length && desk ? await db.from("watch_entries").select("id,number,entity,status,regulation_id,applicability").in("regulation_id", ids).in("status", ["open", "in_progress", "done"]) : { data: [] };
  const openEntries = (wd ?? []) as { id: string; number: string; entity: string; status: string; regulation_id: string }[];
  const cited = desk && sp.cited ? await citedTexts(db, scope) : null;
  const last = regs.map((r) => r.checked_at).filter(Boolean).sort().pop() ?? null;
  const unreachable = regs.filter((r) => r.check_result === "unreachable");
  return (
    <>
      <PageHeader eyebrow="Regulation · Easy Access Rules" title="Easy Access Rules" sub="The rules we work with, always in the version EASA publishes today. S.A.M. checks the EASA pages every evening; a new version replaces the previous one here and is raised in the regulatory watch to analyse."
        right={desk ? <div className="flex gap-2"><form action={checkNow}><button className="btn">Check EASA now</button></form><Link className="btn" href={sp.cited ? "/reg/ear" : "/reg/ear?cited=1#cited"}>{sp.cited ? "Hide" : "Texts cited in our manuals"}</Link></div> : undefined} />
      {desk && <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Texts" value={regs.length} hint={`${regs.filter((r) => r.kind === "ear").length} Easy Access Rules`} />
        <Metric label="Last check" value={last ? last.slice(0, 10) : "—"} hint={last ? `${last.slice(11, 16)} UTC` : "never"} />
        <Metric label="New versions to analyse" value={openEntries.length} tone={openEntries.length ? "amber" : "green"} hint="open watch entries" />
        <Metric label="Pages not read" value={unreachable.length} tone={unreachable.length ? "red" : "green"} hint={unreachable.length ? "record the version by hand" : "all read"} />
      </div>}
      <div className="grid grid-cols-2 gap-4 mb-5">
        {regs.map((r) => {
          const vs = versions.filter((v) => v.regulation_id === r.id);
          const ent = openEntries.filter((e) => e.regulation_id === r.id);
          return (
            <section key={r.id} className="card">
              <div className="ch" style={{ alignItems: "flex-start" }}>
                <span><b>{r.short}</b><div className="mini">{r.number}{r.number ? " · " : ""}{r.entities.filter((e) => !desk ? scope.includes(e) : true).map((e) => <span key={e}><span className="entdot" style={{ background: ENT_COLOR[e] ?? "#888" }} />{e} </span>)}</div></span>
                <span style={{ textAlign: "right" }}><span className={"pill " + (r.current_version ? "green" : "amber")}>{r.current_version ?? "version not read yet"}</span>{r.version_since && <div className="mini">in S.A.M. since {r.version_since}</div>}</span>
              </div>
              <div className="cb">
                <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                  {r.online_url && <a className="btn primary sm" href={r.online_url} target="_blank" rel="noreferrer">Read online ↗</a>}
                  {r.pdf_url && <a className={"btn sm" + (r.online_url ? "" : " primary")} href={r.pdf_url} target="_blank" rel="noreferrer">PDF ↗</a>}
                  {r.xml_url && desk && <a className="btn sm" href={r.xml_url} target="_blank" rel="noreferrer">XML ↗</a>}
                  <a className={"btn sm" + (!r.online_url && !r.pdf_url ? " primary" : "")} href={r.page_url} target="_blank" rel="noreferrer">{r.kind === "ear" ? "EASA page ↗" : "Official text ↗"}</a>
                </div>
                {desk && <div className="mini mt-2">{r.checked_at ? `checked ${r.checked_at.slice(0, 16).replace("T", " ")} UTC · ` : "never checked · "}<span className={r.check_result === "unreachable" ? "red" : ""}>{r.check_result === "unreachable" ? `page not read (${r.check_note ?? ""})` : r.check_result === "manual" ? "version recorded by hand" : r.check_result === "changed" ? `new version (${r.check_note ?? ""})` : r.checked_at ? "up to date" : ""}</span></div>}
                {desk && r.kind === "ear" && <div className="mini mt-1">{r.items_count ? <>Articles: <b>{r.items_count}</b> · {r.items_version}{r.items_version !== r.current_version ? <span className="red"> · not the current version</span> : ""}{r.items_note ? ` · ${r.items_note}` : ""} · </> : r.xml_url ? "Articles not loaded yet · " : "No XML export · "}{r.xml_url && <RegItemsLoad regKey={r.key} label={r.items_count ? "Reload articles" : "Load the articles"} />}</div>}
                {desk && ent.length > 0 && <div className="mini mt-1">To analyse in the watch: {ent.map((e) => <Link key={e.id} href={`/comp/watch/${e.id}`} className="mono" style={{ marginRight: 8 }}>{e.number}</Link>)}</div>}
                {desk && <details className="mt-2"><summary className="mini">Versions ({vs.length}) · record by hand · settings</summary>
                  <table className="tbl mt-2"><tbody>{vs.map((v) => <tr key={v.id}><td>{v.version}</td><td className="mono mini">{v.seen_on}</td><td className="mini">{v.recorded_by ? "recorded by hand" : "found by S.A.M."}{v.watch_entry_ids.length ? ` · ${v.watch_entry_ids.length} watch entr${v.watch_entry_ids.length > 1 ? "ies" : "y"}` : ""}</td></tr>)}{!vs.length && <tr><td className="mini">No version recorded yet.</td></tr>}</tbody></table>
                  <form action={recordByHand} className="grid grid-cols-3 gap-2 mt-2"><input type="hidden" name="id" value={r.id} /><input name="version" className="inp" placeholder="Revision 25, January 2027" required /><input name="pdf_url" className="inp" placeholder="PDF link (optional)" /><button className="btn sm">Record the new version</button></form>
                  <div className="flex gap-2 mt-2"><form action={checkNow}><input type="hidden" name="id" value={r.id} /><button className="btn sm">Check this page now</button></form><form action={archiveRegulation}><input type="hidden" name="id" value={r.id} /><button className="btn sm">Remove from the menu</button></form></div>
                </details>}
              </div>
            </section>);
        })}
        {!regs.length && <section className="card"><div className="cb mini">No regulation in your scope yet.</div></section>}
      </div>

      {desk && <details className="card mb-5"><summary className="ch"><span className="eyebrow">+ Add a text</span></summary>
        <form action={saveRegulation} className="cb grid gap-2">
          <div className="grid grid-cols-3 gap-2"><label><span className="mini">Short name</span><input name="short" className="inp" placeholder="SERA" required /></label><label className="col-span-2"><span className="mini">Title</span><input name="title" className="inp" placeholder="Easy Access Rules for Standardised European Rules of the Air" /></label></div>
          <div className="grid grid-cols-3 gap-2"><label><span className="mini">Regulation</span><input name="number" className="inp mono" placeholder="Regulation (EU) No 923/2012" /></label><label className="col-span-2"><span className="mini">EASA EAR page (or official text)</span><input name="page_url" className="inp" placeholder="https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-…" required /></label></div>
          <div className="mini">Entities {ENTS4.map((e) => <label key={e} style={{ marginRight: 8 }}><input type="checkbox" name="entities" value={e} defaultChecked={scope.includes(e)} /> {e}</label>)}</div>
          <div className="flex justify-end"><button className="btn primary">Add — S.A.M. reads the version</button></div>
        </form></details>}

      {cited && <section className="card" id="cited"><div className="ch"><span className="eyebrow">Texts cited in our manuals</span><span className="mini">current published revisions · {scope.join(", ")}</span></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Text</th><th>Sections citing it</th><th>Manuals</th><th>In this menu</th></tr></thead><tbody>
          {cited.filter((c) => c.count > 0).sort((a, b) => b.count - a.count).map((c) => {
            const inMenu = !!c.key && regs.some((r) => r.key === c.key);
            return <tr key={c.pattern}><td><b>{c.label}</b><div className="mini mono">“{c.pattern}”</div></td><td>{c.count}</td><td className="mini">{c.manuals.slice(0, 8).map((m) => `${m.entity} ${m.code} (${m.sections})`).join(" · ")}{c.manuals.length > 8 ? " …" : ""}</td><td>{inMenu ? <span className="pill green">yes</span> : <span className="pill amber">not yet</span>}</td></tr>;
          })}
          {!cited.some((c) => c.count > 0) && <tr><td colSpan={4} className="mini">No published manual text found in this scope.</td></tr>}
        </tbody></table></div></section>}
    </>
  );
}
