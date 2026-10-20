import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHeader } from "@/components/Page";
import ChapterEditor from "@/components/ChapterEditor";
import { STEPS, STEP_LABEL, partOf, partsOf, type Manual, type Revision, type Section } from "@/lib/docs";
import { allowedTransitions, isCmm, ownsManual } from "@/lib/revisions";
import { moveStep, saveSummary, resolveConflict } from "./actions";
import { frozenRefs } from "@/lib/revisions-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Round = { id: string; at: string; direction: string; who: string; note: string };
type Meta = { id: string; ord: number; ref: string; title: string | null; changed: boolean; conflict: { base_html: string; base_rev: string } | null };

export default async function Editor({ params, searchParams }: { params: Promise<{ rev: string }>; searchParams: Promise<{ tab?: string; sec?: string }> }) {
  const { rev: revId } = await params;
  const { tab = "write", sec } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login");
  const sb = await supabaseServer();
  const { data: r } = await sb.from("revisions").select("*").eq("id", revId).maybeSingle();
  if (!r) notFound();
  const rev = r as Revision & { submitted_at?: string | null; step_changed_at?: string | null; based_on?: string | null };
  const { data: m } = await sb.from("manuals").select("*").eq("id", rev.manual_id).maybeSingle();
  if (!m) notFound();
  const manual = m as Manual;
  const cmm = isCmm(s), owner = ownsManual(s, manual.owner_role);
  if (!cmm && !owner) notFound();
  const editable = rev.step === "draft";
  const { data: metaData } = await sb.from("revision_sections").select("id,ord,ref,title,changed,conflict").eq("revision_id", rev.id).order("ord");
  const frozen = await frozenRefs(supabaseAdmin(), rev);
  const { data: baseRow } = rev.based_on ? await sb.from("revisions").select("rev,step").eq("id", rev.based_on).maybeSingle() : { data: null };
  const baseLabel = baseRow ? `Rev ${(baseRow as { rev: string }).rev}` : "the published revision";
  const metas = (metaData ?? []) as Meta[];
  const activeMeta = metas.find((x) => x.ref === sec) ?? metas.find((x) => x.ord === 1) ?? metas[0] ?? null;
  let active: Section | null = null;
  if (activeMeta) { const { data: one } = await sb.from("revision_sections").select("id,ord,ref,title,body,changed,conflict").eq("id", activeMeta.id).maybeSingle(); active = (one as Section | null) ?? null; }
  const activeConflict = (active as (Section & { conflict?: { base_html: string; base_rev: string } | null }) | null)?.conflict ?? null;
  const conflicts = metas.filter((x) => x.conflict).length;
  const parts = partsOf(metas.map((x) => x.ref));
  const colorOf = Object.fromEntries(parts.map((p) => [p.key, p.color]));
  const changedCount = metas.filter((x) => x.changed).length;
  const { data: roundsData } = cmm ? await sb.from("authority_rounds").select("*").eq("revision_id", rev.id).order("at") : { data: [] };
  const rounds = (roundsData ?? []) as Round[];
  const transitions = allowedTransitions(s, rev.step, manual.owner_role, manual.needs_signature, manual.to_tmcad_repository);
  const stepIdx = STEPS.indexOf(rev.step);
  const tabs: [string, string][] = cmm ? [["write", "Write"], ["publish", "Publish · Compliance"]] : [["write", "Write"]];

  return (
    <>
      <PageHeader eyebrow={`Documents · ${manual.entity} · ${manual.code} · revision editor`} title={`${manual.title} — Issue ${rev.issue} Rev ${rev.rev}`}
        sub={`${STEP_LABEL[rev.step]} · based on ${baseLabel} · ${changedCount} chapter${changedCount === 1 ? "" : "s"} changed${frozen.refs.size ? ` · ${frozen.refs.size} frozen (Rev ${frozen.baseRev} under review)` : ""}${conflicts ? ` · ${conflicts} in conflict` : ""} · owner ${manual.owner_role}${editable ? "" : " · read-only at this step"}`}
        right={<><Link href={`/docs/manual/${manual.id}?rev=${rev.id}`} className="btn">Preview as reader</Link><Link href={`/docs/manual/${manual.id}`} className="btn">‹ Manual</Link></>} />

      <div className="steps mb-4">
        {STEPS.filter((st) => st !== "repository" || manual.to_tmcad_repository).map((st, i) => (
          <div key={st} className={"step" + (i < stepIdx ? " done" : i === stepIdx ? " now" : "")}><i /><span>{STEP_LABEL[st]}</span></div>
        ))}
      </div>
      <div className="tabs mb-4">
        {tabs.map(([k, l]) => <Link key={k} href={`/docs/editor/${rev.id}?tab=${k}${sec ? `&sec=${encodeURIComponent(sec)}` : ""}`} className={"tab" + (tab === k ? " on" : "")}>{l}</Link>)}
        {!cmm && <span className="mini ml-auto">Authority route, publication and notice are handled by the Compliance department (DOC-06).</span>}
      </div>

      {tab === "write" && (
        <div className="flex gap-4 items-start">
          <aside className="card toc edtoc">
            {parts.map((p) => (
              <div key={p.key} className="tocpart">
                <div className="ph" style={{ color: p.color }}><i style={{ background: p.color }} />{p.label}</div>
                {metas.filter((x) => partOf(x.ref) === p.key).map((x) => (
                  <Link key={x.id} href={`/docs/editor/${rev.id}?tab=write&sec=${encodeURIComponent(x.ref)}`} className={"tocch" + (active?.id === x.id ? " on" : "") + (x.changed ? " changed" : "")}>
                    <span className="badge" style={{ background: p.color }}>{x.ref}</span><span>{x.title}</span>
                    {x.conflict ? <b className="fold" style={{ color: "var(--terra)" }} title="conflict">!</b> : frozen.refs.has(x.ref) ? <b className="fold" title={`frozen · Rev ${frozen.baseRev}`}>🔒</b> : null}
                  </Link>
                ))}
              </div>
            ))}
          </aside>
          <section className="card flex-1 min-w-0" style={{ borderTop: `4px solid ${active ? colorOf[partOf(active.ref)] : "var(--line)"}` }}>
            {active && activeConflict && (
              <div className="conflict">
                <div className="ch"><span className="eyebrow" style={{ color: "var(--terra)" }}>Conflict · this chapter was also changed in Rev {activeConflict.base_rev}, now published</span></div>
                <div className="cb">
                  <p className="mini mb-2">Below, the approved text of Rev {activeConflict.base_rev}. Your own text stays in the editor underneath. Choose which one Rev {rev.rev} continues from.</p>
                  <div className="reader basepreview" dangerouslySetInnerHTML={{ __html: activeConflict.base_html }} />
                  <div className="flex gap-2 mt-3">
                    <form action={resolveConflict}><input type="hidden" name="revision_id" value={rev.id} /><input type="hidden" name="section_id" value={active.id} /><input type="hidden" name="choice" value="base" /><button className="btn primary" type="submit">Take the approved text</button></form>
                    <form action={resolveConflict}><input type="hidden" name="revision_id" value={rev.id} /><input type="hidden" name="section_id" value={active.id} /><input type="hidden" name="choice" value="mine" /><button className="btn" type="submit">Keep my text (I will merge by hand)</button></form>
                  </div>
                </div>
              </div>
            )}
            {active ? (
              <ChapterEditor key={active.id} revisionId={rev.id} sectionId={active.id} refCode={active.ref} title={active.title ?? ""} html={active.body.html ?? ""} changed={active.changed} editable={editable && (cmm || owner)} frozenBy={frozen.refs.has(active.ref) ? frozen.baseRev : null} baseRevLabel={baseLabel} />
            ) : <div className="cb text-slate6">No chapter.</div>}
          </section>
        </div>
      )}

      {tab === "publish" && cmm && (
        <div className="grid grid-cols-2 gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">Revision summary & authority route</span></div>
            <form action={saveSummary} className="cb">
              <input type="hidden" name="revision_id" value={rev.id} />
              <label className="block mb-3"><span className="eyebrow">What changes in Rev {rev.rev} (shown to readers in “What changed”)</span>
                <textarea name="summary" defaultValue={rev.summary ?? ""} rows={5} className="inp" placeholder="Short summary of the revision, in English…" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="eyebrow">Authority route</span>
                  <select name="authority_route" defaultValue={rev.authority_route ?? ""} className="inp"><option value="">none</option><option value="notification">notification</option><option value="approval">approval</option></select></label>
                <label><span className="eyebrow">Application / dossier reference</span><input name="authority_ref" defaultValue={rev.authority_ref ?? ""} className="inp" placeholder="TM-CAD OPS-…, METEOR …" /></label>
              </div>
              <button className="btn primary mt-3" type="submit">Save</button>
            </form>
          </section>
          <section className="card pubcard">
            <div className="ch"><span className="eyebrow">Workflow · DOC-09</span><span className="pill">{STEP_LABEL[rev.step]}</span></div>
            <div className="cb">
              {transitions.length === 0 && <p className="mini">No action for you at this step.</p>}
              {transitions.map((t) => (
                <form key={t.to} action={moveStep} className="mb-3 p-3 border border-line rounded-lg">
                  <input type="hidden" name="revision_id" value={rev.id} /><input type="hidden" name="to" value={t.to} />
                  <div className="flex items-center gap-3"><button className={"btn " + (t.to === "draft" ? "" : "primary")} type="submit">{t.label}</button><span className="mini">{t.note}</span></div>
                  {(t.to === "with_civil_aviation" || t.from === "with_civil_aviation") && <input name="note" className="inp mt-2" placeholder="Note for the authority exchange (what was sent / received)…" />}
                </form>
              ))}
              {rounds.length > 0 && (<>
                <div className="eyebrow mt-4 mb-2">Exchanges with the authority</div>
                <table className="tbl"><tbody>{rounds.map((x) => <tr key={x.id}><td className="mono" style={{ width: 100 }}>{x.at}</td><td style={{ width: 80 }}><span className={"pill " + (x.direction === "sent" ? "" : "green")}>{x.direction}</span></td><td><b>{x.who}</b><div className="mini">{x.note}</div></td></tr>)}</tbody></table>
              </>)}
            </div>
          </section>
          <section className="card col-span-2">
            <div className="ch"><span className="eyebrow">Changed chapters in this revision</span><span className="mini">{changedCount}</span></div>
            <div className="cb">
              {changedCount ? <ul className="list-disc pl-5">{metas.filter((x) => x.changed).map((x) => <li key={x.id}><Link className="underline" href={`/docs/editor/${rev.id}?tab=write&sec=${encodeURIComponent(x.ref)}`}>{x.ref} {x.title}</Link></li>)}</ul> : <p className="mini">No chapter has been modified yet.</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
