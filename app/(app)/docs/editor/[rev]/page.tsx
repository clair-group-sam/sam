import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { STAGE_LABEL, type Stage } from "@/lib/authority";
import Workflow, { type StepRow } from "@/components/Workflow";
import { postsOf } from "@/lib/np";
import { basePost } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import ChapterEditor from "@/components/ChapterEditor";
import { STEPS, STEP_LABEL, partOf, partsOf, type Manual, type Revision, type Section } from "@/lib/docs";
import { allowedTransitions, expectedReturn, isCmm, ownsManual, RETURN_LABEL, type ReturnKind } from "@/lib/revisions";
import { moveStep, saveSummary, resolveConflict, clearReturn, setReturnKind, type RouteProposal as Proposal, type Review } from "./actions";
import ReviewPanel from "@/components/ReviewPanel";
import ChapterTools from "@/components/ChapterTools";
import EntityBand from "@/components/EntityBand";
import { checkLinks } from "@/lib/links";
import AuthorityReturn from "@/components/AuthorityReturn";
import RouteProposal from "@/components/RouteProposal";
import { ENT } from "@/lib/nav";
import { frozenRefs } from "@/lib/revisions-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Round = { id: string; at: string; direction: string; who: string; note: string };
type Meta = { id: string; ord: number; ref: string; title: string | null; changed: boolean; conflict: { base_html: string; base_rev: string } | null; deleted_at: string | null; base_ref: string | null; uid: string | null };

export default async function Editor({ params, searchParams }: { params: Promise<{ rev: string }>; searchParams: Promise<{ tab?: string; sec?: string }> }) {
  const { rev: revId } = await params;
  const { tab = "write", sec } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login");
  const sb = await supabaseServer();
  const { data: r } = await sb.from("revisions").select("*").eq("id", revId).maybeSingle();
  if (!r) notFound();
  const rev = r as Revision & { submitted_at?: string | null; step_changed_at?: string | null; based_on?: string | null; return_kind?: string | null; return_pdf_path?: string | null; return_pages?: { path: string; role: string; page: number }[] | null; return_received_at?: string | null; route_proposal?: Proposal | null; review?: Review | null };
  const { data: m } = await sb.from("manuals").select("*").eq("id", rev.manual_id).maybeSingle();
  if (!m) notFound();
  const manual = m as Manual & { internal?: boolean; owner_name?: string | null };
  const internal = !!manual.internal;
  const cmm = isCmm(s), owner = ownsManual(s, manual.owner_role);
  if (!cmm && !owner) notFound();
  const editable = rev.step === "draft";
  const { data: metaData } = await sb.from("revision_sections").select("id,ord,ref,title,changed,conflict,deleted_at,base_ref,uid:body->>uid").eq("revision_id", rev.id).order("ord");
  const frozen = await frozenRefs(supabaseAdmin(), rev);
  const { data: baseRow } = rev.based_on ? await sb.from("revisions").select("rev,step").eq("id", rev.based_on).maybeSingle() : { data: null };
  const baseLabel = baseRow ? `Rev ${(baseRow as { rev: string }).rev}` : "the published revision";
  const metas = (metaData ?? []) as Meta[];
  const activeMeta = metas.find((x) => x.ref === sec && !x.deleted_at) ?? metas.find((x) => x.ref === sec) ?? metas.find((x) => !x.deleted_at) ?? metas[0] ?? null;
  let active: Section | null = null;
  if (activeMeta) { const { data: one } = await sb.from("revision_sections").select("id,ord,ref,title,body,changed,conflict").eq("id", activeMeta.id).maybeSingle(); active = (one as Section | null) ?? null; }
  const activeConflict = (active as (Section & { conflict?: { base_html: string; base_rev: string } | null }) | null)?.conflict ?? null;
  const conflicts = metas.filter((x) => x.conflict).length;
  const parts = partsOf(metas.map((x) => x.ref));
  const colorOf = Object.fromEntries(parts.map((p) => [p.key, p.color]));
  const changedCount = metas.filter((x) => x.changed).length;
  const { data: roundsData } = cmm ? await sb.from("authority_rounds").select("*").eq("revision_id", rev.id).order("at") : { data: [] };
  const rounds = (roundsData ?? []) as Round[];
  // PRJ-01: the authority file that carries this revision's application (opened automatically when the revision leaves for the authority)
  const { data: afData } = cmm ? await supabaseAdmin().from("authority_files").select("id,stage,portal_ref,type_code").eq("revision_id", rev.id).not("stage", "in", "(closed,standby)").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const authFile = afData as { id: string; stage: Stage; portal_ref: string | null; type_code: string } | null;
  const transitions = allowedTransitions(s, rev.step, manual.owner_role, manual.needs_signature, manual.to_tmcad_repository, rev.authority_route, internal);
  // DOC-03: what the authority sends back, and whether it is in
  const returnKind = (rev.return_kind ?? expectedReturn(manual.entity, manual.code, rev.authority_route)) as ReturnKind;
  const returnMissing = returnKind !== "none" && !rev.return_pdf_path;
  const admin = supabaseAdmin();
  const retPages = rev.return_pages ?? [];
  const retUrls = new Map<string, string>();
  if (cmm && retPages.length) { const { data: su } = await admin.storage.from("manuals").createSignedUrls(retPages.map((x) => x.path), 600); for (const x of su ?? []) if (x.path && x.signedUrl) retUrls.set(x.path, x.signedUrl); }
  const { data: noticeData } = cmm || (internal && owner) ? await admin.from("manual_notices").select("sent_at,recipients,emailed,email_status").eq("revision_id", rev.id).order("sent_at") : { data: [] };
  const notices = (noticeData ?? []) as { sent_at: string; recipients: number; emailed: number; email_status: string | null }[];
  const broken = tab === "publish" ? await checkLinks(admin, rev.id, manual.id) : [];
  const linkCard = (
    <section className="card col-span-2">
      <div className="ch"><span className="eyebrow">Links check</span><span className={"pill " + (broken.length ? "amber" : "green")}>{broken.length ? `${broken.length} to fix` : "all links resolve"}</span></div>
      <div className="cb">{broken.length ? <table className="tbl"><tbody>{broken.map((b, i) => <tr key={i}><td className="mono" style={{ width: 80 }}><Link className="underline" href={`/docs/editor/${rev.id}?tab=write&sec=${encodeURIComponent(b.chapter)}`}>{b.chapter}</Link></td><td>“{b.text}”<div className="mini">{b.why}</div></td></tr>)}</tbody></table>
        : <p className="mini">Every link to a chapter of this or another manual points to a chapter that exists.</p>}</div>
    </section>
  );
  const routeOpen = ["draft", "approved_np", "approved_compliance", "signed"].includes(rev.step);
  const auth = ENT[manual.entity]?.auth ?? "authority";
  const stepIdx = STEPS.indexOf(rev.step);
  const tabs: [string, string][] = internal ? [["write", "Write"], ["publish", "Review & publish"]] : [["write", "Write"], ["publish", "Approve & publish"]];

  // DOC-09 workflow rows: who does each step (names from NP management), what was done when (document journal)
  const posts = internal ? [] : await postsOf(admin, manual.entity);
  const holder = (code: string) => posts.find((p) => p.code === basePost(code))?.holder_name ?? null;
  const ownerWho = manual.owner_role.startsWith("PERSON:") ? (manual.owner_name ?? "the author") : [holder(manual.owner_role), `(${basePost(manual.owner_role)})`].filter(Boolean).join(" ");
  const cmmWho = `Compliance department${holder("CMM") ? ` · ${holder("CMM")}` : ""}`;
  const signWho = /MSM/i.test(manual.code) ? `Accountable Manager${holder("AM") ? ` ${holder("AM")}` : ""} + CMM` : `${ownerWho} + CMM`;
  const { data: histData } = internal ? { data: [] } : await admin.from("audit_log").select("action,at,actor").eq("object_type", "revision").eq("object_id", rev.id).like("action", "step_%").order("at");
  const hist = (histData ?? []) as { action: string; at: string; actor: string | null }[];
  const actorIds = [...new Set(hist.map((h) => h.actor).filter((x): x is string => !!x))];
  const { data: actorRows } = actorIds.length ? await admin.from("people").select("id,display_name").in("id", actorIds) : { data: [] };
  const actorName = new Map(((actorRows ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const doneAt = (step: string) => { const h = [...hist].reverse().find((x) => x.action === `step_${step}`); return h ? { at: h.at, by: h.actor ? actorName.get(h.actor) ?? null : null } : null; };
  const route = rev.authority_route;
  const wfRows: StepRow[] = [
    { step: "approved_np", label: "Approve (NP)", who: ownerWho, detail: "The nominated person validates the content and hands over to Compliance.", done: doneAt("approved_np") },
    { step: "approved_compliance", label: "Approve (Compliance)", who: cmmWho, detail: "Checked against the requirements; the authority route is decided here.", done: doneAt("approved_compliance") },
    ...(manual.needs_signature ? [{ step: "signed", label: "Sign", who: signWho, done: doneAt("signed") }] : []),
    { step: "with_civil_aviation", label: `Send to ${auth}`, who: `Compliance → ${auth}`, detail: route === "approval" ? "Prior approval: one application, every reply inside it." : route === "notification" ? "Notification to the authority." : "Approval or notification, decided by Compliance.", skipped: route === "none" ? "not required — no authority route for this revision" : undefined, done: doneAt("with_civil_aviation") },
    { step: "published", label: "Publish", who: "Compliance", detail: "Readers are notified; reading is tracked per reader.", done: doneAt("published") },
    ...(manual.to_tmcad_repository ? [{ step: "repository", label: "TM-CAD repository", who: "Compliance", done: doneAt("repository") }] : []),
  ];
  const routeHint = (rev.step === "approved_compliance" || rev.step === "signed") && !route ? (cmm ? "Decide the authority route (card on the right) to continue." : "Waiting for Compliance to decide the authority route.") : null;

  return (
    <>
      <EntityBand entity={manual.entity} current={s.entity} multi={s.group || s.entities.length > 1} />
      <PageHeader eyebrow={`Documents · ${manual.entity} · ${manual.code} · revision editor`} title={`${manual.title} — Issue ${rev.issue} Rev ${rev.rev}`}
        sub={`${STEP_LABEL[rev.step]} · based on ${baseLabel} · ${changedCount} chapter${changedCount === 1 ? "" : "s"} changed${frozen.refs.size ? ` · ${frozen.refs.size} frozen (Rev ${frozen.baseRev} under review)` : ""}${conflicts ? ` · ${conflicts} in conflict` : ""} · owner ${manual.owner_name ?? manual.owner_role}${internal ? " · internal document" : ""}${editable ? "" : " · read-only at this step"}`}
        right={<><Link href={`/docs/manual/${manual.id}?rev=${rev.id}${active ? `&sec=${encodeURIComponent(active.ref)}` : ""}`} className="btn">Preview as reader</Link><Link href={`/docs/manual/${manual.id}`} className="btn">‹ Manual</Link></>} />

      <div className="steps mb-4">
        {STEPS.filter((st) => st !== "repository" || manual.to_tmcad_repository).map((st, i) => (
          <div key={st} className={"step" + (i < stepIdx ? " done" : i === stepIdx ? " now" : "")}><i /><span>{STEP_LABEL[st]}</span></div>
        ))}
      </div>
      <div className="tabs mb-4">
        {tabs.map(([k, l]) => <Link key={k} href={`/docs/editor/${rev.id}?tab=${k}${sec ? `&sec=${encodeURIComponent(sec)}` : ""}`} className={"tab" + (tab === k ? " on" : "")}>{l}</Link>)}
        <span className="nature ml-auto" title={internal ? "Internal document: no authority route, published by its author after the review" : "Regulated manual: DOC-09 cycle, authority route decided by Compliance"}>{internal ? "internal document" : "regulated manual"}</span>
        {!cmm && !internal && <span className="mini">Authority route, publication and notice are handled by the Compliance department (DOC-06).</span>}
      </div>
      {editable ? (
        <div className="draftbar mb-4"><div><b>Draft — Rev {rev.rev}</b> is the working copy, based on {baseLabel}. Nothing here is visible to readers until it is published{frozen.refs.size ? `; ${frozen.refs.size} chapter(s) are frozen while Rev ${frozen.baseRev} is under review` : ""}.</div><Link href={`/docs/manual/${manual.id}?rev=${rev.id}${active ? `&sec=${encodeURIComponent(active.ref)}` : ""}`} className="btn">Preview as reader</Link></div>
      ) : (
        <div className="draftbar mb-4"><div><b>Rev {rev.rev} — {STEP_LABEL[rev.step]}</b>. The text is read-only at this step{rev.step === "published" || rev.step === "repository" ? "" : "; it goes back to Draft if Compliance or the authority ask for changes"}.</div></div>
      )}

      {tab === "write" && (
        <div className="flex gap-4 items-start">
          <aside className="card toc edtoc">
            {parts.map((p) => (
              <div key={p.key} className="tocpart">
                <div className="ph" style={{ color: p.color }}><i style={{ background: p.color }} />{p.label}</div>
                {metas.filter((x) => partOf(x.ref) === p.key).map((x) => (
                  <Link key={x.id} href={`/docs/editor/${rev.id}?tab=write&sec=${encodeURIComponent(x.ref)}`} className={"tocch" + (active?.id === x.id ? " on" : "") + (x.changed ? " changed" : "") + (x.deleted_at ? " deleted" : "")} title={x.deleted_at ? "deleted in this revision" : x.base_ref && x.base_ref !== x.ref ? `was ${x.base_ref}` : !x.base_ref && rev.based_on ? "new chapter" : undefined}>
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
              <>
              {editable && (cmm || owner) && <ChapterTools revisionId={rev.id} sectionId={active.id} refCode={active.ref} deleted={!!activeMeta?.deleted_at} isNew={!activeMeta?.base_ref} />}
              <ChapterEditor key={active.id} manualId={manual.id} chapters={metas.filter((x) => !x.deleted_at && x.uid).map((x) => ({ ref: x.ref, title: x.title, uid: x.uid! }))} revisionId={rev.id} sectionId={active.id} refCode={active.ref} title={active.title ?? ""} html={active.body.html ?? ""} changed={active.changed} editable={editable && (cmm || owner) && !activeMeta?.deleted_at} frozenBy={frozen.refs.has(active.ref) ? frozen.baseRev : null} baseRevLabel={baseLabel} />
              </>
            ) : <div className="cb text-slate6">No chapter.</div>}
          </section>
        </div>
      )}

      {tab === "publish" && internal && (owner || cmm) && (
        <div className="grid grid-cols-2 gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">Revision summary</span></div>
            <form action={saveSummary} className="cb">
              <input type="hidden" name="revision_id" value={rev.id} />
              <label className="block mb-3"><span className="eyebrow">What changes in Rev {rev.rev} (shown to readers in “What changed”)</span>
                <textarea name="summary" defaultValue={rev.summary ?? ""} rows={4} className="inp" placeholder="Short summary of the revision…" /></label>
              <button className="btn primary" type="submit">Save</button>
            </form>
          </section>
          <section className="card pubcard">
            <div className="ch"><span className="eyebrow">Publication · internal document</span><span className="pill">{STEP_LABEL[rev.step]}</span></div>
            <div className="cb">
              {rev.step === "draft" && !rev.review && <p className="mini mb-3">Run the review (below) first. Its comments are yours to use or to ignore.</p>}
              {transitions.map((t) => (
                <form key={t.to} action={moveStep} className="mb-3 p-3 border border-line rounded-lg">
                  <input type="hidden" name="revision_id" value={rev.id} /><input type="hidden" name="to" value={t.to} />
                  <div className="flex items-center gap-3"><button className="btn primary" type="submit" disabled={t.to === "published" && !rev.review}>{t.label}</button><span className="mini">No authority approval or notification. The update notice goes to every reader of the document.</span></div>
                </form>
              ))}
              {notices.map((n, i) => <p key={i} className="mini">Update notice · {n.sent_at.slice(0, 16).replace("T", " ")} · {n.recipients} reader{n.recipients === 1 ? "" : "s"} · e-mail: {n.email_status === "sent" ? `${n.emailed} sent` : n.email_status}</p>)}
            </div>
          </section>
          {linkCard}
          <section className="card col-span-2">
            <div className="ch"><span className="eyebrow">Review before publication</span></div>
            <div className="cb"><ReviewPanel revisionId={rev.id} initial={rev.review ?? null} editable={rev.step === "draft"} /></div>
          </section>
        </div>
      )}

      {tab === "publish" && !internal && (
        <div className="grid grid-cols-2 gap-4">
          <section className="card">
            <div className="ch"><span className="eyebrow">Revision summary</span></div>
            <form action={saveSummary} className="cb">
              <input type="hidden" name="revision_id" value={rev.id} />
              <label className="block mb-3"><span className="eyebrow">What changes in Rev {rev.rev} (shown to readers in “What changed”)</span>
                <textarea name="summary" defaultValue={rev.summary ?? ""} rows={5} className="inp" placeholder="Short summary of the revision, in English…" /></label>
              <button className="btn primary mt-3" type="submit">Save</button>
            </form>
          </section>
          <section className="card pubcard">
            <div className="ch"><span className="eyebrow">Approval and publication · DOC-09</span><span className="pill">{STEP_LABEL[rev.step]}</span></div>
            <div className="cb">
              <Workflow revisionId={rev.id} current={rev.step} rows={wfRows} transitions={transitions} routeHint={routeHint}
                blockedNote={rev.step === "with_civil_aviation" && returnMissing ? `Waiting for the authority's return (${RETURN_LABEL[returnKind].toLowerCase()}) — integrate it in the card below first.` : null} />
              {notices.map((n, i) => <p key={i} className="mini">Update notice · {n.sent_at.slice(0, 16).replace("T", " ")} · {n.recipients} reader{n.recipients === 1 ? "" : "s"} (task in S.A.M.) · e-mail: {n.email_status === "sent" ? `${n.emailed} sent` : n.email_status}</p>)}
              {cmm && (rev.authority_route === "approval" || rev.authority_route === "notification") && (
                <p className="mini mt-3">Authority file: {authFile ? <Link className="underline" href={`/proj/auth/${authFile.id}`}>{authFile.type_code} · {authFile.portal_ref ?? "no reference yet"} · {STAGE_LABEL[authFile.stage]}</Link> : <>none yet — opened automatically when the revision is sent to the authority, or <Link className="underline" href={`/proj/auth/new?entity=${manual.entity}&revision=${rev.id}`}>open it now</Link> to prepare the dossier checklist first.</>}</p>
              )}
              {rounds.length > 0 && (<>
                <div className="eyebrow mt-4 mb-2">Exchanges with the authority</div>
                <table className="tbl"><tbody>{rounds.map((x) => <tr key={x.id}><td className="mono" style={{ width: 100 }}>{x.at}</td><td style={{ width: 80 }}><span className={"pill " + (x.direction === "sent" ? "" : "green")}>{x.direction}</span></td><td><b>{x.who}</b><div className="mini">{x.note}</div></td></tr>)}</tbody></table>
              </>)}
            </div>
          </section>
          {!cmm && route && <section className="card"><div className="ch"><span className="eyebrow">Authority route · DOC-06</span><span className="pill">{route}</span></div><div className="cb mini">Decided by the Compliance department{rev.authority_ref ? ` · ref. ${rev.authority_ref}` : ""}.</div></section>}
          {cmm && <section className="card">
            <div className="ch"><span className="eyebrow">Authority route · DOC-06</span>{rev.authority_route && <span className="pill">{rev.authority_route}</span>}</div>
            <div className="cb">
              {routeOpen
                ? <RouteProposal revisionId={rev.id} initial={rev.route_proposal ?? null} route={rev.authority_route} authority={auth} />
                : <p className="mini">Route: <b>{rev.authority_route ?? "none"}</b>{rev.authority_ref ? ` · ref. ${rev.authority_ref}` : ""} — fixed once the revision is with the authority.</p>}
            </div>
          </section>}
          {cmm && <section className="card">
            <div className="ch"><span className="eyebrow">Authority return · DOC-03</span><span className={"pill " + (returnMissing ? "amber" : "green")}>{returnKind === "none" ? "nothing expected" : rev.return_pdf_path ? "integrated" : "waiting"}</span></div>
            <div className="cb">
              <p className="mini mb-3">Application / dossier reference: {rev.authority_ref || authFile?.portal_ref ? <b className="mono">{rev.authority_ref ?? authFile?.portal_ref}</b> : <i>none yet</i>} — {authFile ? <>from the <Link className="underline" href={`/proj/auth/${authFile.id}`}>authority file</Link>, filled when the submission is recorded there</> : "filled automatically from the authority file when the submission is recorded"}.</p>
              <form action={setReturnKind} className="flex items-center gap-2 mb-3">
                <input type="hidden" name="revision_id" value={rev.id} />
                <span className="mini">Expected from {auth}:</span>
                <select name="kind" defaultValue={returnKind} className="inp" style={{ width: "auto" }} disabled={!!rev.return_pdf_path}>
                  {(Object.keys(RETURN_LABEL) as ReturnKind[]).map((k) => <option key={k} value={k}>{RETURN_LABEL[k]}</option>)}
                </select>
                {!rev.return_pdf_path && <button className="btn" type="submit">Set</button>}
              </form>
              {rev.return_pdf_path ? (<>
                <p className="mini mb-2">Received {rev.return_received_at ?? ""} · {retPages.length} page(s) kept in the manual (added to the PDF: approval / signature page as page 0.0{retPages.some((x) => x.role === "lep") ? ", stamped LEP in place of S.A.M.'s list" : ""}).</p>
                <div className="athumbs">{retPages.map((x) => <div key={x.path} className="athumb on">{retUrls.get(x.path) && <img src={retUrls.get(x.path)} alt={`page ${x.page}`} />}<span className="mini">p. {x.page} · {x.role}</span></div>)}</div>
                <div className="flex gap-2 mt-3">
                  <a className="btn" href={`/api/files/manuals/${rev.return_pdf_path}`} target="_blank" rel="noreferrer">Open the authority's PDF</a>
                  {rev.step === "with_civil_aviation" && <form action={clearReturn}><input type="hidden" name="revision_id" value={rev.id} /><button className="btn" type="submit">Remove and upload again</button></form>}
                </div>
              </>) : rev.step === "with_civil_aviation" ? (
                returnKind === "none"
                  ? <p className="mini">{auth} sends nothing to integrate for this manual: publication is not blocked. If an approval letter or page should go into the manual, choose “Approval page” above.</p>
                  : <AuthorityReturn revisionId={rev.id} entity={manual.entity} code={manual.code} rev={rev.rev} kind={returnKind} />
              ) : <p className="mini">{returnKind === "none" ? "Nothing to integrate." : "Available once the revision has been sent to the authority."}</p>}
            </div>
          </section>}
          {linkCard}
          <section className="card col-span-2">
            <div className="ch"><span className="eyebrow">Changed chapters in this revision</span><span className="mini">{changedCount}</span></div>
            <div className="cb">
              {changedCount ? <ul className="list-disc pl-5">{metas.filter((x) => x.changed).map((x) => <li key={x.id}><Link className="underline" href={`/docs/editor/${rev.id}?tab=write&sec=${encodeURIComponent(x.ref)}`}>{x.ref} {x.title}</Link>{x.deleted_at ? <span className="mini"> — deleted</span> : !x.base_ref ? <span className="mini"> — new</span> : x.base_ref !== x.ref ? <span className="mini"> — was {x.base_ref}</span> : null}</li>)}</ul> : <p className="mini">No chapter has been modified yet.</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
