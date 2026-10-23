import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { canDownloadPdf, getSession } from "@/lib/session";
import DownloadMenu from "@/components/DownloadMenu";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader } from "@/components/Page";
import { STEPS, STEP_LABEL, linkRefs, partOf, partsOf, structureHtml, type Heading, type Manual, type Revision, type Section } from "@/lib/docs";
import Reader, { type TocItem } from "@/components/Reader";
import { acknowledge, saveAudience } from "./actions";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { audienceTokens, describeTokens, peopleFor, resolveReaders, POSTS } from "@/lib/audience";
import { diffBlocks, revbarPassages, type Row, type Word } from "@/lib/diff";
import { ENT } from "@/lib/nav";
import { linkIndex, rewriteLinks } from "@/lib/links";
import { renderCharts } from "@/lib/orgchart";
import { startRevision } from "@/app/(app)/docs/editor/[rev]/actions";
import { isCmm, ownsManual } from "@/lib/revisions";

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
  const workings = revs.filter((r) => r.step !== "published" && r.step !== "repository").sort((a, b) => STEPS.indexOf(b.step) - STEPS.indexOf(a.step));
  const working = workings[0] ?? null;
  // PRJ-01: authority files linked to the revisions in progress
  const { data: afRows } = workings.length ? await supabaseAdmin().from("authority_files").select("id,revision_id,stage,portal_ref").in("revision_id", workings.map((r) => r.id)).not("stage", "in", "(closed,standby)") : { data: [] };
  const authFiles = new Map(((afRows ?? []) as { id: string; revision_id: string; stage: string; portal_ref: string | null }[]).map((a) => [a.revision_id, a]));
  const editing = workings.find((r) => r.step === "draft" || r.step === "approved_np") ?? null;
  const current = (rev ? revs.find((r) => r.id === rev) : null) ?? published[0] ?? working ?? null;

  let sections: Section[] = [];
  const selfUids = new Map<string, string>();
  let readings: Reading[] = [];
  let mine: Reading | null = null;
  if (current) {
    const { data: sd } = await sb.from("revision_sections").select("id,ord,ref,title,changed,deleted_at,uid:body->>uid,headings:body->headings,structured:body->structured,pages:body->pages").eq("revision_id", current.id).order("ord");
    const live = ((sd ?? []) as unknown as (Omit<Section, "body"> & { deleted_at: string | null; uid: string | null; headings: Heading[] | null; structured: boolean | null; pages: string[] | null })[]).filter((x) => !x.deleted_at);
    for (const x of live) if (x.uid) selfUids.set(x.uid, x.ref);
    sections = live.map((x) => ({ id: x.id, ord: x.ord, ref: x.ref, title: x.title, changed: x.changed, body: { headings: x.headings ?? undefined, structured: !!x.structured, pages: x.pages ?? undefined } }));
    const { data: rd } = await sb.from("readings").select("person_id,acknowledged_at,via,people(display_name,job_title)").eq("revision_id", current.id);
    readings = (rd ?? []) as unknown as Reading[];
    mine = readings.find((r) => r.person_id === s.person?.id) ?? null;
  }
  const activeMeta = sections.find((x) => x.ref === sec) ?? sections.find((x) => x.ord === 1) ?? sections[0] ?? null;
  let active: Section | null = null;
  if (activeMeta) {
    const { data: one } = await sb.from("revision_sections").select("id,ord,ref,title,body,changed").eq("id", activeMeta.id).maybeSingle();
    active = (one as Section | null) ?? null;
  }
  // headings: stored at import; otherwise (legacy rows) computed for the active chapter only
  const activeStructured = active ? (active.body.structured ? { html: active.body.html ?? "", headings: active.body.headings ?? [] } : structureHtml(active.body.html ?? `<p>${active.body.text ?? ""}</p>`, `s${active.ord}`, active.ref)) : null;
  const parts = partsOf(sections.map((x) => x.ref));
  const toc: TocItem[] = sections.map((x) => ({ id: x.id, ref: x.ref, title: x.title, part: partOf(x.ref), headings: (x.id === active?.id ? activeStructured?.headings : x.body.headings) ?? [] }));
  // references inside the manual's own table of contents → links
  const chapterRefs = new Map(sections.map((x) => [x.ref, x.id]));
  const subRefs = new Map<string, { ref: string; id: string }>();
  for (const x of toc) for (const h of x.headings) { const mm = /^([A-Z]{0,2}\d*(?:\.\d+){1,3})\b/.exec(h.text); if (mm && !chapterRefs.has(mm[1])) subRefs.set(mm[1], { ref: x.ref, id: h.id }); }
  const base = current ? `/docs/manual/${manual.id}?rev=${current.id}` : `/docs/manual/${manual.id}?x=1`;
  // links copied from the source system first (same manual → its chapter, other manuals → S.A.M., web addresses in a new tab),
  // then the plain chapter numbers of the manual's own table of contents become links
  const refHref = (inner: string): string | null => {
    const mm = /^\s*([A-Z]{0,2}\d*(?:\.\d+){0,4})\b/.exec(inner.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
    let k = mm?.[1] ?? "";
    while (k) { if (chapterRefs.has(k)) return `${base}&sec=${encodeURIComponent(k)}`; const sr = subRefs.get(k); if (sr) return `${base}&sec=${encodeURIComponent(sr.ref)}#${sr.id}`; k = k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : ""; }
    return null;
  };
  const srcHtml = activeStructured?.html ?? "";
  const linked = /<a\b/i.test(srcHtml)
    ? rewriteLinks(srcHtml, {
        idx: /\/reader\/#\/|\/docs\/link\/ch\//.test(srcHtml) ? await linkIndex(supabaseAdmin()) : null, selfManualId: manual.id, base: "", newTab: true, selfUids,
        self: (ref) => (ref ? `${base}&sec=${encodeURIComponent(ref)}` : null), textTarget: refHref,
      })
    : srcHtml;
  const activeHtml = renderCharts(active && activeStructured ? (/table des mati|contents|sommaire/i.test(active.title ?? "") ? linkRefs(linked, chapterRefs, subRefs, base) : linked) : "");
  const stepIdx = current ? STEPS.indexOf(current.step) : -1;
  const canAudience = isCmm(s) || ownsManual(s, manual.owner_role);

  // What changed: each changed chapter against the revision it was based on (else the previous published one)
  type Change = { id: string; ref: string; title: string | null; note: string; rows: Row[] | null; passages: string[] };
  let changes: Change[] = []; let baseRevLabel = "";
  if (tab === "changed" && current) {
    const basedOn = (current as Revision & { based_on?: string | null }).based_on ?? null;
    const older = published.filter((r) => r.id !== current.id && (!current.published_at || (r.published_at ?? "") <= current.published_at));
    const base = (basedOn ? revs.find((r) => r.id === basedOn) : null) ?? (current.step === "published" || current.step === "repository" ? older[0] : published[0]) ?? null;
    baseRevLabel = base ? `Rev ${base.rev}` : "";
    const { data: cd } = await sb.from("revision_sections").select("id,ref,title,body,base_ref,deleted_at").eq("revision_id", current.id).eq("changed", true).order("ord");
    const cur = (cd ?? []) as (Section & { base_ref?: string | null; deleted_at?: string | null })[];
    const baseByUid = new Map<string, string>(), baseByRef = new Map<string, string>();
    if (base && cur.length) {
      const { data: bd } = await sb.from("revision_sections").select("ref,body").eq("revision_id", base.id);
      for (const b of (bd ?? []) as Section[]) { const u = (b.body as { uid?: string }).uid; if (u) baseByUid.set(u, b.body.html ?? ""); baseByRef.set(b.ref, b.body.html ?? ""); }
    }
    changes = cur.map((c) => {
      const after = c.deleted_at ? "" : c.body.html ?? "";
      const u = (c.body as { uid?: string }).uid;
      const before = (u ? baseByUid.get(u) : undefined) ?? baseByRef.get(c.base_ref ?? c.ref);
      const note = c.deleted_at ? `Deleted in Rev ${current.rev}` : !c.base_ref && basedOn ? "New chapter" : c.base_ref && c.base_ref !== c.ref ? `Renumbered — was ${c.base_ref}` : "";
      return { id: c.id, ref: c.ref, title: c.title, note, rows: before !== undefined ? diffBlocks(before, after) : null, passages: before === undefined ? revbarPassages(after) : [] };
    });
  }

  // Readers: who must read (audience) and who has acknowledged
  let audience: string[] = []; let expected: { id: string; display_name: string; job_title: string | null; roles: string[] }[] = []; let entityPeople: { id: string; display_name: string; job_title: string | null; roles: string[] }[] = []; let audienceText = "";
  if (tab === "readers" && s.role !== "user") {
    const admin = supabaseAdmin();
    const [tok, ppl, rd] = await Promise.all([audienceTokens(admin, manual.id), peopleFor(admin, manual.entity), current ? admin.from("readings").select("person_id,acknowledged_at,via,people(display_name,job_title)").eq("revision_id", current.id) : Promise.resolve({ data: [] })]);
    audience = tok; entityPeople = ppl; expected = resolveReaders(ppl, manual.entity, tok);
    readings = ((rd as { data: unknown }).data ?? []) as Reading[];
    audienceText = describeTokens(tok, ENT[manual.entity]?.name ?? manual.entity, new Map(ppl.map((p) => [p.id, p.display_name])));
  }
  const office = s.role !== "user";
  const tabs = [["read", "Read"], ["changed", "What changed"], ...(office ? [["history", "History"], ["readers", "Readers"]] : [])] as [string, string][];

  return (
    <>
      <PageHeader eyebrow={`Documents · ${manual.entity} · ${manual.code}`} title={manual.title}
        sub={current ? `Issue ${current.issue} Rev ${current.rev} · ${STEP_LABEL[current.step]}${current.published_at ? " · " + current.published_at : ""} · owner ${(manual as Manual & { owner_name?: string | null }).owner_name ?? manual.owner_role}${(manual as Manual & { internal?: boolean }).internal ? " · internal document" : ""}` : "No revision yet"}
        right={<>
          <Link href="/docs/lib" className="btn">‹ Library</Link>
          {canDownloadPdf(s.roles) && revs.length > 0 && (
            <DownloadMenu manualId={manual.id}
              published={published[0] ? { id: published[0].id, label: `Iss ${published[0].issue} Rev ${published[0].rev}`, sub: published[0].published_at ? `effective ${published[0].published_at}` : "published" } : null}
              drafts={workings.map((w) => ({ id: w.id, label: `Rev ${w.rev}`, sub: STEP_LABEL[w.step] }))}
              archive={published.slice(1).map((r) => ({ id: r.id, label: `Iss ${r.issue} Rev ${r.rev}`, sub: r.published_at ?? "published" }))} />
          )}
          {(isCmm(s) || ownsManual(s, manual.owner_role)) && editing && <Link href={`/docs/editor/${editing.id}`} className="btn">Open the draft (Rev {editing.rev})</Link>}
          {(isCmm(s) || ownsManual(s, manual.owner_role)) && !editing && (published[0] || working) && (
            <form action={startRevision}><input type="hidden" name="from_revision" value={(published[0] ?? working)!.id} /><button className="btn" type="submit">{working ? `Start Rev ${String(parseInt(working.rev, 10) + 1).padStart(working.rev.length, "0")} (parallel)` : "Start a new revision"}</button></form>
          )}
          {current && !mine?.acknowledged_at && (
            <form action={acknowledge}><input type="hidden" name="revision_id" value={current.id} /><input type="hidden" name="manual_id" value={manual.id} />
              <button className="btn primary" type="submit">I have read this revision</button></form>
          )}
          {mine?.acknowledged_at && <span className="pill green">Read · {mine.acknowledged_at.slice(0, 10)}</span>}
        </>} />

      {current && !(current.step === "published" || current.step === "repository") && (
        <div className="previewbar mb-4">
          <div><b>Preview — Rev {current.rev} is not published</b> ({STEP_LABEL[current.step]}). This is how readers will see it once published{published[0] ? `; today they read Rev ${published[0].rev}` : ""}.</div>
          {(isCmm(s) || ownsManual(s, manual.owner_role)) && <Link className="btn primary" href={`/docs/editor/${current.id}?tab=write${sec ? `&sec=${encodeURIComponent(sec)}` : ""}`}>‹ Back to the draft</Link>}
          {published[0] && <Link className="btn" href={`/docs/manual/${manual.id}`}>Published version</Link>}
        </div>
      )}
      {current && (current.step === "published" || current.step === "repository") && tab !== "history" && (
        <div className="statusline mb-4">
          <span className="pill green">Published · Iss {current.issue} Rev {current.rev}{current.published_at ? ` · ${current.published_at}` : ""}</span>
          {current.authority_route === "approval" && <span className="mini">approved by the civil aviation authority before publication</span>}
          {current.authority_route === "notification" && <span className="mini">notified to the civil aviation authority</span>}
          {workings.map((w) => <Link key={w.id} href={`/docs/manual/${manual.id}?rev=${w.id}`} className="pill amber">Rev {w.rev} — {STEP_LABEL[w.step]}</Link>)}
          {!workings.length && s.role !== "user" && <span className="mini">no revision in progress</span>}
        </div>
      )}
      {current && !(current.step === "published" || current.step === "repository") && s.role !== "user" && (
        <div className="mini mb-2">Authority file: {authFiles.get(current.id) ? <Link className="underline" href={`/proj/auth/${authFiles.get(current.id)!.id}`}>{authFiles.get(current.id)!.portal_ref ?? "open"} · {authFiles.get(current.id)!.stage}</Link> : <>none yet{(isCmm(s) || ownsManual(s, manual.owner_role)) && <> · <Link className="underline" href={`/proj/auth/new?entity=${manual.entity}&revision=${current.id}`}>open one</Link></>}</>}</div>
      )}
      {current && !(current.step === "published" || current.step === "repository") && (
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
          active={active ? { ref: active.ref, title: active.title, html: activeHtml, part: partOf(active.ref), pages: active.body.pages?.length ?? 0 } : null} />
      )}
      {tab === "read" && !current && <section className="card"><div className="cb text-slate6">No revision to read yet.</div></section>}

      {tab === "changed" && (
        <section className="card"><div className="ch"><span className="eyebrow">What changed in Rev {current?.rev ?? "—"}{baseRevLabel ? ` · compared with ${baseRevLabel}` : ""}</span><span className="mini">{changes.length} chapter{changes.length === 1 ? "" : "s"}</span></div>
          <div className="cb">
            <p className="mb-4">{current?.summary ?? "No revision summary recorded."}</p>
            {!changes.length && <p className="mini">No chapter is marked as changed in this revision.</p>}
            {changes.map((c) => (
              <div key={c.id} className="wchg">
                <div className="wchg-h"><span className="mono">{c.ref}</span> <b>{c.title}</b>{c.note && <span className="pill amber">{c.note}</span>}<Link className="mini underline ml-auto" href={`/docs/manual/${manual.id}?rev=${current?.id}&sec=${encodeURIComponent(c.ref)}`}>Open the chapter ›</Link></div>
                {c.rows ? <DiffTable rows={c.rows} left={baseRevLabel} right={`Rev ${current?.rev}`} />
                  : c.passages.length ? <div className="wchg-pass"><div className="mini mb-1">Passages marked as revised by the publisher (no previous text in S.A.M.):</div>{c.passages.map((t, i) => <p key={i} className="ins">{t}</p>)}</div>
                  : <p className="mini">New chapter, or no previous text available in S.A.M.</p>}
              </div>
            ))}
            {current && !mine?.acknowledged_at && changes.length > 0 && (
              <form action={acknowledge} className="mt-5"><input type="hidden" name="revision_id" value={current.id} /><input type="hidden" name="manual_id" value={manual.id} />
                <button className="btn primary" type="submit">I have read the changes of Rev {current.rev}</button></form>
            )}
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

      {tab === "readers" && office && (<>
        <section className="card mb-4"><div className="ch"><span className="eyebrow">Readers · Rev {current?.rev}</span>
          <span className="mini">{expected.filter((p) => readings.some((r) => r.person_id === p.id && r.acknowledged_at)).length} / {expected.length} acknowledged</span></div>
          <table className="tbl"><thead><tr><th>Person</th><th>Post</th><th>Acknowledged</th><th>Via</th></tr></thead>
            <tbody>
              {expected.map((p) => { const r = readings.find((x) => x.person_id === p.id); return (
                <tr key={p.id}><td><b>{p.display_name}</b><div className="mini">{p.job_title}</div></td><td className="mini">{p.roles.join(", ")}</td>
                  <td className="mono">{r?.acknowledged_at ? r.acknowledged_at.slice(0, 16).replace("T", " ") : <span className="pill amber">to read</span>}</td><td className="mini">{r?.via ?? ""}</td></tr>); })}
              {readings.filter((r) => r.acknowledged_at && !expected.some((p) => p.id === r.person_id)).map((r) => (
                <tr key={r.person_id}><td><b>{r.people?.display_name}</b><div className="mini">{r.people?.job_title} · not in the readers list</div></td><td /><td className="mono">{r.acknowledged_at?.slice(0, 16).replace("T", " ")}</td><td className="mini">{r.via ?? ""}</td></tr>))}
              {!expected.length && <tr><td colSpan={4} className="p-5 text-slate6">Nobody must read this manual with the current list (below).</td></tr>}
            </tbody></table>
        </section>
        <section className="card"><div className="ch"><span className="eyebrow">Who must read this manual</span><span className="mini">{audienceText}</span></div>
          {canAudience ? (
            <form action={saveAudience} className="cb">
              <input type="hidden" name="manual_id" value={manual.id} />
              <label className="flex items-center gap-2 mb-3"><input type="checkbox" name="all" defaultChecked={audience.includes("ALL")} /> <b>All staff of {ENT[manual.entity]?.name ?? manual.entity}</b><span className="mini">(everyone attached to the entity; group functions only when named below)</span></label>
              <div className="eyebrow mb-1">Posts — holders and their deputies</div>
              <div className="audgrid mb-3">{POSTS.map((p) => <label key={p} className="audchk"><input type="checkbox" name="post" value={p} defaultChecked={audience.includes(`ROLE:${p}`)} /> {p}</label>)}</div>
              <div className="eyebrow mb-1">People by name</div>
              <div className="audgrid people mb-3">{entityPeople.map((p) => <label key={p.id} className="audchk"><input type="checkbox" name="person" value={p.id} defaultChecked={audience.includes(`PERSON:${p.id}`)} /> {p.display_name}<span className="mini"> {p.roles.join(", ")}</span></label>)}
                {!entityPeople.length && <span className="mini">Nobody of this entity has signed in to S.A.M. yet.</span>}</div>
              <button className="btn primary" type="submit">Save the readers list</button>
              <p className="mini mt-2">Used for the update notice at each publication and for the reading status above. Aircraft-type filtering for crews comes with “My manuals”.</p>
            </form>
          ) : <div className="cb mini">Set by Compliance or the manual's owner ({manual.owner_role}).</div>}
        </section>
      </>)}
    </>
  );
}

function Words({ w }: { w: Word[] }) {
  return <>{w.map((x, i) => x.k === "=" ? <span key={i}>{x.t} </span> : x.k === "+" ? <ins key={i}>{x.t} </ins> : <del key={i}>{x.t} </del>)}</>;
}
/** Side by side; unchanged paragraphs are folded, one kept on each side of a change for context. */
function DiffTable({ rows, left, right }: { rows: Row[]; left: string; right: string }) {
  const changedAt = (i: number) => !!rows[i] && rows[i].kind !== "same";
  const keep = rows.map((_, i) => changedAt(i) || changedAt(i - 1) || changedAt(i + 1));
  const out: ReactNode[] = []; let folded = 0;
  rows.forEach((r, i) => {
    if (!keep[i]) { folded++; return; }
    if (folded) { out.push(<tr key={`f${i}`} className="fold"><td colSpan={2}>⋯ {folded} unchanged paragraph{folded === 1 ? "" : "s"}</td></tr>); folded = 0; }
    out.push(<tr key={i} className={r.kind}><td><Words w={r.left} /></td><td><Words w={r.right} /></td></tr>);
  });
  if (folded) out.push(<tr key="fend" className="fold"><td colSpan={2}>⋯ {folded} unchanged paragraph{folded === 1 ? "" : "s"}</td></tr>);
  if (!rows.some((r) => r.kind !== "same")) return <p className="mini">Marked as changed, but the text is identical to {left} (formatting only).</p>;
  return <table className="wdiff"><thead><tr><th>{left}</th><th>{right}</th></tr></thead><tbody>{out}</tbody></table>;
}
