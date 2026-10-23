import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { STEP_LABEL } from "@/lib/docs";
import { CATEGORY_LABEL, STAGES, STAGE_LABEL, STAGE_TONE, TRIGGERS, daysAtAuthority, fr, loadFile, movesFrom, nextAction, today, type AuthorityFile } from "@/lib/authority";
import { addAttachment, addItem, addNote, addRound, moveStage, removeAttachment, saveFile, toggleItem } from "../actions";

const KIND_ICON: Record<string, string> = { created: "＋", stage: "→", note: "✎", item: "☑", submitted: "⇧", remarks: "✉", reply: "↩", decision: "✔", attachment: "📎", link: "🔗", task: "⏰", mail: "✉" };

export default async function AuthorityFilePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  const db = supabaseAdmin();
  const loaded = await loadFile(db, id);
  if (!loaded) notFound();
  const { file: f, items, events, attachments, rounds, type } = loaded;
  if (!s.group && !s.entities.includes(f.entity)) notFound();
  const cmm = isCmm(s);
  const owner = f.owner_person ? s.person?.id === f.owner_person : !!f.owner_role && s.roles.map(basePost).includes(basePost(f.owner_role));
  const mayEdit = cmm || owner;
  const moves = movesFrom(f.stage, !!type?.needs_signature).filter((m) => (m.by === "cmm" ? cmm : cmm || owner));
  const idx = STAGES.indexOf(f.stage);
  const required = items.filter((i) => i.required), done = required.filter((i) => i.done).length;
  const personIds = [...new Set([...items.map((i) => i.done_by), f.owner_person, f.created_by].filter((x): x is string => !!x))];
  const { data: people } = personIds.length ? await db.from("people").select("id,display_name").in("id", personIds) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  type RevRow = { id: string; rev: string; issue: number; step: string; manuals: { id: string; code: string; title: string } };
  const { data: rev } = f.revision_id ? await db.from("revisions").select("id,rev,issue,step,manuals!inner(id,code,title)").eq("id", f.revision_id).maybeSingle() : { data: null };
  const revision = rev as unknown as RevRow | null;
  const { data: prj } = (f as AuthorityFile & { project_id?: string | null }).project_id ? await db.from("projects").select("id,title").eq("id", (f as AuthorityFile & { project_id?: string | null }).project_id!).maybeSingle() : { data: null };
  const projectOf = prj as { id: string; title: string } | null;
  const days = daysAtAuthority(f);
  const t0 = today();
  const late = (f.stage === "submitted" || f.stage === "remarks") && f.target_date && f.target_date < t0;

  return (
    <>
      <PageHeader eyebrow={`Projects · Authority files · ${f.type_code}`} title={f.title}
        sub={`${ENT[f.entity]?.name ?? f.entity} · ${type?.name ?? f.type_code} · ${f.portal ?? f.authority ?? ""}${f.category ? ` · ${CATEGORY_LABEL[f.category] ?? f.category}` : ""}`}
        right={<><span className={"pill " + STAGE_TONE[f.stage]} style={{ alignSelf: "center" }}>{STAGE_LABEL[f.stage]}</span><Link href="/proj/auth" className="btn">All files</Link></>} />

      {f.stage !== "standby" && (
        <div className="steps mb-4">
          {STAGES.filter((st) => st !== "remarks" || f.stage === "remarks" || f.rounds > 0).map((st) => { const i = STAGES.indexOf(st); return <div key={st} className={"step" + (i < idx ? " done" : i === idx ? " now" : "")}><i /><span>{STAGE_LABEL[st]}</span></div>; })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 items-start">
        <div className="col-span-2 grid gap-4">
          {/* what next */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Next</span><span className={"mini" + (late ? " red" : "")}>{nextAction(f, items)}</span></div>
            <div className="cb">
              {!moves.length && <p className="mini">No move available for your role at this stage.</p>}
              <div className="grid gap-3">
                {moves.map((m) => (
                  <form key={m.to} action={moveStage} className="flex gap-2 items-end flex-wrap" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    <input type="hidden" name="id" value={f.id} /><input type="hidden" name="to" value={m.to} />
                    {m.needsRef && <>
                      <label style={{ width: 240 }}><span className="mini">Portal reference</span><input name="portal_ref" className="inp" required placeholder="APP/AJD/OPS_4/38315 · METEOR 252776 · SL-102901" defaultValue={f.portal_ref ?? ""} /></label>
                      <label style={{ width: 260 }}><span className="mini">Portal URL</span><input name="portal_url" className="inp" placeholder="https://…" defaultValue={f.portal_url ?? ""} /></label>
                      <label style={{ width: 150 }}><span className="mini">Submitted on</span><input name="submitted_at" type="date" className="inp" defaultValue={t0} /></label>
                      <label style={{ width: 150 }}><span className="mini">Target date</span><input name="target_date" type="date" className="inp" /></label>
                    </>}
                    {m.to === "approved" && <>
                      <label style={{ width: 170 }}><span className="mini">Outcome</span><select name="outcome" className="inp" defaultValue={f.category === "notification" || f.category === "communication" ? "acknowledged" : "approved"}><option value="approved">approved</option><option value="acknowledged">acknowledged</option><option value="refused">refused</option><option value="withdrawn">withdrawn</option></select></label>
                      <label style={{ width: 150 }}><span className="mini">Decision date</span><input name="decision_at" type="date" className="inp" defaultValue={t0} /></label>
                      <label style={{ width: 120 }}><span className="mini">Fee (€)</span><input name="fee" type="number" step="0.01" className="inp" placeholder="0" /></label>
                    </>}
                    {(m.needsNote || m.to === "approved" || m.to === "submitted") && <label className="flex-1" style={{ minWidth: 240 }}><span className="mini">{m.to === "remarks" ? "The authority's remarks (pasted or summarised)" : m.to === "submitted" && f.stage === "remarks" ? "What was sent back" : "Note"}</span><input name="note" className="inp" required={!!m.needsNote} placeholder={m.needsNote ? "required" : "optional"} /></label>}
                    <button className={"btn" + (m.primary ? " primary" : "")} type="submit" disabled={!!m.needsAllRequired && done < required.length} title={m.needsAllRequired && done < required.length ? `${required.length - done} required item(s) still open` : undefined}>{m.label}</button>
                    {m.needsAllRequired && done < required.length && <span className="mini red">{required.length - done} required item(s) still open</span>}
                  </form>
                ))}
              </div>
              {f.stage === "ready" && <p className="mini mt-3">Submit / « Envoyer à la DSAC » is the CMM's click on the portal; record it here right after, with the reference the portal gives.</p>}
              {f.stage === "remarks" && <p className="mini mt-3">Answer in the same application (Review tab / new dossier version), one sentence per remark; never open a new application.</p>}
            </div>
          </section>

          {/* checklist */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Dossier checklist</span><span className="mini">{done} / {required.length} required done{items.length > required.length ? ` · ${items.length - required.length} optional` : ""}</span></div>
            <table className="tbl"><tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td style={{ width: 40 }}>
                    <form action={toggleItem}><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="item_id" value={it.id} />
                      <button type="submit" className={"chk" + (it.done ? " on" : "")} disabled={!mayEdit} aria-label={it.done ? "Reopen" : "Mark as done"}>{it.done ? "✓" : ""}</button></form>
                  </td>
                  <td className={it.done ? "text-slate6" : ""}>{it.label}{it.note && <div className="mini">{it.note}</div>}</td>
                  <td className="mono" style={{ width: 80 }}>{it.role ?? ""}</td>
                  <td style={{ width: 110 }}>{it.required ? <span className="pill amber">required</span> : <span className="mini">optional</span>}</td>
                  <td className="mini" style={{ width: 190 }}>{it.done ? `${nameOf.get(it.done_by ?? "") ?? ""} · ${fr(it.done_at)}` : ""}</td>
                </tr>))}
              {!items.length && <tr><td className="p-5 text-slate6">No checklist item.</td></tr>}
            </tbody></table>
            {mayEdit && f.stage !== "closed" && (
              <form action={addItem} className="nprow add"><input type="hidden" name="file_id" value={f.id} />
                <input name="label" className="inp" placeholder="Add an item to this dossier" required /><input name="role" className="inp mono" style={{ maxWidth: 90 }} placeholder="Role" />
                <label className="mini flex items-center gap-1"><input type="checkbox" name="required" /> required</label><button className="btn" type="submit">+ Add</button></form>
            )}
          </section>

          {/* exchanges with the authority — the rounds of the same application (DOC-09), shared with the revision's Publish tab */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Exchanges with the authority</span><span className="mini">{rounds.length} round{rounds.length === 1 ? "" : "s"} · one application, every reply as a comment or a new version inside it</span></div>
            <table className="tbl"><tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ width: 100 }}>{fr(r.at)}</td>
                  <td style={{ width: 120 }}><span className={"pill " + (r.direction === "sent" ? "" : "amber")}>{r.direction === "sent" ? "⇧ sent" : "⇩ received"}</span></td>
                  <td>{r.note}<div className="mini">{r.who}{r.revision_id && !r.file_id ? " · from the revision editor" : ""}</div></td>
                </tr>))}
              {!rounds.length && <tr><td className="p-5 text-slate6">No exchange yet. The submission, the remarks and the decision are recorded here automatically; mails and calls can be added below.</td></tr>}
            </tbody></table>
            {mayEdit && f.stage !== "closed" && (
              <form action={addRound} className="nprow add"><input type="hidden" name="id" value={f.id} />
                <select name="direction" className="inp" style={{ maxWidth: 120 }} defaultValue="received"><option value="received">received</option><option value="sent">sent</option></select>
                <input name="at" type="date" className="inp" style={{ maxWidth: 150 }} defaultValue={t0} />
                <input name="who" className="inp" style={{ maxWidth: 160 }} placeholder={`Inspector / ${s.name}`} />
                <input name="note" className="inp" placeholder="What was exchanged (mail, call, portal comment)" required />
                <button className="btn" type="submit">Record</button></form>
            )}
          </section>

          {/* attachments */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Attachments</span><span className="mini">{attachments.length} · signed manual, checklist, forms, MOC, letters</span></div>
            <table className="tbl"><tbody>
              {attachments.map((a) => (
                <tr key={a.id}>
                  <td>{a.path ? <a className="underline" href={`/api/files/${a.path}`} target="_blank" rel="noreferrer">{a.name}</a> : <>{a.name} <span className="mini">(on the server)</span></>}</td>
                  <td className="mono" style={{ width: 90 }}>{a.kind ?? ""}</td>
                  <td className="mini" style={{ width: 100 }}>{a.size ? `${Math.round(a.size / 1024)} KB` : ""}</td>
                  <td className="mini" style={{ width: 110 }}>{fr(a.at)}</td>
                  {cmm && <td style={{ width: 50 }}><form action={removeAttachment}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="attachment_id" value={a.id} /><button className="btn" type="submit" title="Remove">✕</button></form></td>}
                </tr>))}
              {!attachments.length && <tr><td className="p-5 text-slate6">Nothing attached yet.</td></tr>}
            </tbody></table>
            {mayEdit && (
              <form action={addAttachment} className="nprow add" encType="multipart/form-data"><input type="hidden" name="id" value={f.id} />
                <input type="file" name="file" className="inp" style={{ flex: 2 }} /><input name="name" className="inp" placeholder="or the name of a file kept on the server (> 10 MB, MOC folder)" />
                <select name="kind" className="inp" style={{ maxWidth: 120 }} defaultValue="other"><option value="manual">manual</option><option value="checklist">checklist</option><option value="form">form</option><option value="moc">MOC / RA</option><option value="letter">letter</option><option value="signed">signed return</option><option value="other">other</option></select>
                <button className="btn" type="submit">Attach</button></form>
            )}
          </section>

          {/* journal */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Journal</span><span className="mini">append-only · {events.length}</span></div>
            <form action={addNote} className="nprow"><input type="hidden" name="id" value={f.id} />
              <select name="kind" className="inp" style={{ maxWidth: 140 }} defaultValue="note"><option value="note">note</option><option value="mail">mail exchanged</option><option value="remarks">authority remark</option><option value="reply">our reply</option></select>
              <input name="note" className="inp" placeholder="What happened (who, what, where)" required /><button className="btn" type="submit">Add</button></form>
            <table className="tbl"><tbody>
              {events.map((e) => <tr key={e.id}><td className="mono" style={{ width: 130 }}>{e.at.slice(0, 16).replace("T", " ")}</td><td style={{ width: 30 }}>{KIND_ICON[e.kind] ?? "·"}</td><td>{e.note}<div className="mini">{e.kind} · {e.who ?? ""}</div></td></tr>)}
            </tbody></table>
          </section>
        </div>

        <div className="grid gap-4">
          {/* route & portal */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Route and portal</span></div>
            <form action={saveFile} className="cb grid gap-2"><input type="hidden" name="id" value={f.id} />
              <div className="mini">Authority <b>{f.authority}</b>{f.stage !== "draft" && f.stage !== "compliance" ? "" : " · route decided by Compliance"}</div>
              <label><span className="mini">Category</span><select name="category" className="inp" defaultValue={f.category ?? "approval"} disabled={!cmm}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="mini">Portal / form</span><input name="portal" className="inp" defaultValue={f.portal ?? ""} disabled={!cmm} /></label>
              <label><span className="mini">Reference</span><input name="portal_ref" className="inp mono" defaultValue={f.portal_ref ?? ""} disabled={!mayEdit} /></label>
              <label><span className="mini">URL</span><input name="portal_url" className="inp" defaultValue={f.portal_url ?? ""} disabled={!mayEdit} /></label>
              <label><span className="mini">Target date</span><input name="target_date" type="date" className="inp" defaultValue={f.target_date ?? ""} disabled={!mayEdit} /></label>
              {cmm && <label><span className="mini">Fee (€)</span><input name="fee" type="number" step="0.01" className="inp" defaultValue={f.fee ?? ""} /></label>}
              <div className="mini">Triggered {fr(f.triggered_at)}{f.submitted_at ? ` · submitted ${fr(f.submitted_at)}` : ""}{f.decision_at ? ` · decision ${fr(f.decision_at)} (${f.outcome ?? ""})` : ""}{f.closed_at ? ` · closed ${fr(f.closed_at)}` : ""}{days !== null ? ` · ${days} day(s) at the authority` : ""}{f.rounds ? ` · ${f.rounds} round(s)` : ""}</div>
              {mayEdit && <button className="btn" type="submit">Save</button>}
            </form>
          </section>

          {/* links */}
          <section className="card">
            <div className="ch"><span className="eyebrow">Linked objects</span></div>
            <form action={saveFile} className="cb grid gap-2"><input type="hidden" name="id" value={f.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={f.title} disabled={!mayEdit} /></label>
              <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue={f.owner_role ?? ""} disabled={!cmm} /></label>
              <label><span className="mini">Trigger</span><select name="trigger_kind" className="inp" defaultValue={f.trigger_kind ?? "other"} disabled={!mayEdit}>{TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="mini">Trigger note</span><input name="trigger_note" className="inp" defaultValue={f.trigger_note ?? ""} disabled={!mayEdit} /></label>
              <div className="mini">Project: {projectOf ? <Link className="underline" href={`/proj/boards/${projectOf.id}`}>{projectOf.title}</Link> : "— (standalone file)"}</div>
              <div className="mini">Manual revision: {revision ? <Link className="underline" href={`/docs/manual/${revision.manuals.id}?rev=${revision.id}`}>{revision.manuals.code} Iss {revision.issue} Rev {revision.rev} · {STEP_LABEL[revision.step] ?? revision.step}</Link> : "—"}</div>
              <label><span className="mini">Finding</span><input name="finding_ref" className="inp mono" defaultValue={f.finding_ref ?? ""} disabled={!mayEdit} /></label>
              <label><span className="mini">Aircraft</span><input name="aircraft_reg" className="inp mono" defaultValue={f.aircraft_reg ?? ""} disabled={!mayEdit} /></label>
              <label><span className="mini">Nominated post</span><input name="np_post_code" className="inp mono" defaultValue={f.np_post_code ?? ""} disabled={!mayEdit} /></label>
              <label><span className="mini">MOC / server folder</span><input name="moc_ref" className="inp" defaultValue={f.moc_ref ?? ""} disabled={!mayEdit} /></label>
              {mayEdit && <button className="btn" type="submit">Save</button>}
            </form>
          </section>

          {/* close-out */}
          {type && type.closeout.length > 0 && (
            <section className="card">
              <div className="ch"><span className="eyebrow">Close-out steps</span><span className="mini">after the decision</span></div>
              <div className="cb"><ol className="pl-5 text-[13px] grid gap-1">{type.closeout.map((c, i) => <li key={i}>{c}</li>)}</ol></div>
            </section>
          )}
          {(f.stage === "closed" || f.stage === "published" || f.stage === "approved") && (
            <section className="card">
              <div className="ch"><span className="eyebrow">Lessons learned</span></div>
              <form action={saveFile} className="cb grid gap-2"><input type="hidden" name="id" value={f.id} />
                <textarea name="lessons" className="inp" rows={4} defaultValue={f.lessons ?? ""} placeholder="What would have made this a one-round approval?" disabled={!mayEdit} />
                {mayEdit && <button className="btn" type="submit">Save</button>}
              </form>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
