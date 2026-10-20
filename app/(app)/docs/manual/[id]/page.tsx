import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader } from "@/components/Page";
import { STEPS, STEP_LABEL, partOf, partsOf, structureHtml, type Manual, type Revision, type Section } from "@/lib/docs";
import Reader, { type TocItem } from "@/components/Reader";
import { acknowledge } from "./actions";

type Reading = { person_id: string; acknowledged_at: string | null; via: string | null; people: { display_name: string; job_title: string | null } | null };

export default async function ManualPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; sec?: string; rev?: string; q?: string }> }) {
  const { id } = await params;
  const { tab = "read", sec, rev, q = "" } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login");
  const sb = await supabaseServer();
  const { data: m } = await sb.from("manuals").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();
  const manual = m as Manual;
  const { data: revsData } = await sb.from("revisions").select("*").eq("manual_id", id).order("published_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false });
  const revs = (revsData ?? []) as Revision[];
  const published = revs.filter((r) => r.step === "published" || r.step === "repository").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const working = revs.find((r) => r.step !== "published" && r.step !== "repository") ?? null;
  const current = (rev ? revs.find((r) => r.id === rev) : null) ?? published[0] ?? working ?? null;

  let sections: Section[] = [];
  let readings: Reading[] = [];
  let mine: Reading | null = null;
  if (current) {
    const { data: sd } = await sb.from("revision_sections").select("id,ord,ref,title,body,changed").eq("revision_id", current.id).order("ord");
    sections = (sd ?? []) as Section[];
    const { data: rd } = await sb.from("readings").select("person_id,acknowledged_at,via,people(display_name,job_title)").eq("revision_id", current.id);
    readings = (rd ?? []) as unknown as Reading[];
    mine = readings.find((r) => r.person_id === s.person?.id) ?? null;
  }
  const active = sections.find((x) => x.ref === sec) ?? sections.find((x) => x.ord === 1) ?? sections[0] ?? null;
  const structured = new Map(sections.map((x) => [x.id, structureHtml(x.body.html ?? `<p>${x.body.text ?? ""}</p>`, `s${x.ord}`, x.ref)]));
  const parts = partsOf(sections.map((x) => x.ref));
  const toc: TocItem[] = sections.map((x) => ({ id: x.id, ref: x.ref, title: x.title, part: partOf(x.ref), headings: structured.get(x.id)?.headings ?? [] }));
  const stepIdx = current ? STEPS.indexOf(current.step) : -1;
  const office = s.role !== "user";
  const tabs = [["read", "Read"], ["changed", "What changed"], ...(office ? [["history", "History"], ["readers", "Readers"]] : [])] as [string, string][];

  return (
    <>
      <PageHeader eyebrow={`Documents · ${manual.entity} · ${manual.code}`} title={manual.title}
        sub={current ? `Issue ${current.issue} Rev ${current.rev} · ${STEP_LABEL[current.step]}${current.published_at ? " · " + current.published_at : ""} · owner ${manual.owner_role}` : "No revision yet"}
        right={<>
          <Link href="/docs/lib" className="btn">‹ Library</Link>
          {current && !mine?.acknowledged_at && (
            <form action={acknowledge}><input type="hidden" name="revision_id" value={current.id} /><input type="hidden" name="manual_id" value={manual.id} />
              <button className="btn primary" type="submit">I have read this revision</button></form>
          )}
          {mine?.acknowledged_at && <span className="pill green">Read · {mine.acknowledged_at.slice(0, 10)}</span>}
        </>} />

      {current && (
        <div className="steps mb-5">
          {STEPS.filter((st) => st !== "repository" || manual.to_tmcad_repository).map((st, i) => (
            <div key={st} className={"step" + (i < stepIdx ? " done" : i === stepIdx ? " now" : "")}><i /><span>{STEP_LABEL[st]}</span></div>
          ))}
        </div>
      )}

      <div className="tabs mb-4">
        {tabs.map(([k, l]) => <Link key={k} href={`/docs/manual/${manual.id}?tab=${k}${current ? `&rev=${current.id}` : ""}`} className={"tab" + (tab === k ? " on" : "")}>{l}</Link>)}
        {published.length > 1 && <span className="mini ml-auto">Other published revisions: {published.slice(1).map((r) => <Link key={r.id} className="underline mr-2" href={`/docs/manual/${manual.id}?rev=${r.id}`}>Rev {r.rev}</Link>)}</span>}
      </div>

      {tab === "read" && current && (
        <Reader manualId={manual.id} revId={current.id} parts={parts} toc={toc} initialQuery={q}
          active={active ? { ref: active.ref, title: active.title, html: structured.get(active.id)?.html ?? "", part: partOf(active.ref), pages: active.body.pages?.length ?? 0 } : null} />
      )}
      {tab === "read" && !current && <section className="card"><div className="cb text-slate6">No revision to read yet.</div></section>}

      {tab === "changed" && (
        <section className="card"><div className="ch"><span className="eyebrow">What changed in Rev {current?.rev ?? "—"}</span></div>
          <div className="cb">
            <p>{current?.summary ?? "No revision summary recorded."}</p>
            {sections.some((x) => x.changed)
              ? <ul className="mt-3 list-disc pl-5">{sections.filter((x) => x.changed).map((x) => <li key={x.id}><Link className="underline" href={`/docs/manual/${manual.id}?sec=${encodeURIComponent(x.ref)}`}>{x.ref} {x.title}</Link></li>)}</ul>
              : <p className="mini mt-2">Changed passages are marked from the first revision written in S.A.M.; imported revisions carry the publisher’s summary only.</p>}
          </div>
        </section>
      )}

      {tab === "history" && office && (
        <section className="card"><table className="tbl">
          <thead><tr><th>Issue / Rev</th><th>Step</th><th>Authority route</th><th>Published</th><th>Summary</th></tr></thead>
          <tbody>{revs.map((r) => (
            <tr key={r.id}><td className="mono"><Link className="underline" href={`/docs/manual/${manual.id}?rev=${r.id}`}>Iss {r.issue} Rev {r.rev}</Link></td><td>{STEP_LABEL[r.step]}</td><td className="mini">{r.authority_route ?? "—"}{r.authority_ref ? ` · ${r.authority_ref}` : ""}</td><td className="mono">{r.published_at ?? "—"}</td><td className="mini">{r.summary}</td></tr>
          ))}</tbody>
        </table></section>
      )}

      {tab === "readers" && office && (
        <section className="card"><div className="ch"><span className="eyebrow">Readers · Rev {current?.rev}</span><span className="mini">{readings.filter((r) => r.acknowledged_at).length} acknowledged</span></div>
          <table className="tbl"><thead><tr><th>Person</th><th>Acknowledged</th><th>Via</th></tr></thead>
            <tbody>{readings.map((r) => <tr key={r.person_id}><td><b>{r.people?.display_name}</b><div className="mini">{r.people?.job_title}</div></td><td className="mono">{r.acknowledged_at?.slice(0, 16).replace("T", " ") ?? "—"}</td><td className="mini">{r.via ?? ""}</td></tr>)}
              {!readings.length && <tr><td colSpan={3} className="p-5 text-slate6">Nobody has acknowledged this revision yet. Audiences and reading deadlines come with the publication flow.</td></tr>}</tbody></table>
        </section>
      )}
    </>
  );
}
