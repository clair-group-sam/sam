import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { AUDIENCE, PROMO_KIND, PROMO_STATUS, SCALE, mayPublish, mayWrite, type Promotion } from "@/lib/promotion";
import { ackPromotion, answerSurvey, closePromotion, draftPromotion, publishPromotion, savePromotion, saveQuestion } from "../actions";

export const maxDuration = 60;
type Rd = { person_id: string; sent_at: string; read_at: string | null; acknowledged_at: string | null; answered_at: string | null };

/** One bulletin / notice / survey: draft & publish (desk), read & acknowledge or answer (everyone), reading and results (desk). */
export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params; const db = supabaseAdmin();
  const { data } = await db.from("safety_promotions").select("*").eq("id", id).maybeSingle();
  const p = data as Promotion | null;
  if (!p || !s.entities.includes(p.entity)) notFound();
  const writer = mayWrite(s);
  const { data: me } = s.person ? await db.from("safety_promotion_reads").select("*").eq("promotion_id", p.id).eq("person_id", s.person.id).maybeSingle() : { data: null };
  let mine = me as Rd | null;
  if (!writer && (p.status === "draft" || !mine)) notFound();
  if (mine && !mine.read_at && p.status !== "draft") { const now = new Date().toISOString(); await db.from("safety_promotion_reads").update({ read_at: now }).eq("promotion_id", p.id).eq("person_id", mine.person_id); mine = { ...mine, read_at: now };
    if (!p.ack_required && p.kind !== "survey") await db.from("tasks").update({ status: "done" }).eq("kind", "promo_read").eq("ref_id", p.id).eq("owner_person", mine.person_id).eq("status", "open"); }
  const desk = writer && p.status !== "draft";
  const [{ data: rd }, { data: ans }] = desk ? await Promise.all([
    db.from("safety_promotion_reads").select("person_id,sent_at,read_at,acknowledged_at,answered_at,people(display_name)").eq("promotion_id", p.id).limit(2000),
    p.kind === "survey" ? db.from("safety_survey_answers").select("answers").eq("promotion_id", p.id).limit(2000) : Promise.resolve({ data: [] }),
  ]) : [{ data: [] }, { data: [] }];
  const R = (rd ?? []) as unknown as (Rd & { people: { display_name: string } | null })[];
  const A = ((ans ?? []) as { answers: Record<string, string> }[]).map((x) => x.answers);
  const edit = writer && p.status === "draft";
  const Hid = () => <input type="hidden" name="id" value={p.id} />;
  const done = (r: Rd) => (p.kind === "survey" ? r.answered_at : p.ack_required ? r.acknowledged_at : r.read_at);
  const paras = (t: string | null) => (t ?? "").split(/\n\s*\n/).filter(Boolean);
  return (
    <>
      <PageHeader eyebrow={`Safety · ${PROMO_KIND[p.kind]?.label} · ${p.entity}`} title={`${p.number} — ${p.title}`} sub={`${AUDIENCE[p.audience]}${p.published_at ? ` · published ${p.published_at.slice(0, 10)}` : ""}${p.due ? ` · by ${p.due}` : ""}`}
        tag={<span className={"pill " + (PROMO_STATUS[p.status]?.[1] ?? "")}>{PROMO_STATUS[p.status]?.[0]}</span>} right={<Link href="/safe/promo" className="btn">← Safety promotion</Link>} />
      <div className="grid gap-5" style={{ gridTemplateColumns: edit || desk ? "minmax(0,2fr) minmax(0,1fr)" : "minmax(0,1fr)" }}>
        <div>
          {edit ? <section className="card mb-5"><div className="ch"><span className="eyebrow">Draft</span>
              <form action={draftPromotion} className="ml-auto"><Hid /><button className="btn">{p.draft_model ? "Draft again" : "Draft the text"}</button></form></div>
            <form action={savePromotion} className="cb grid grid-cols-3 gap-2"><Hid /><input type="hidden" name="ack_flag" value="1" /><input type="hidden" name="anon_flag" value="1" />
              <label className="col-span-3"><span className="mini">Title</span><input name="title" className="inp" defaultValue={p.title} /></label>
              <label className="col-span-3"><span className="mini">Summary (one line, shown in the Inbox)</span><input name="summary" className="inp" defaultValue={p.summary ?? ""} /></label>
              <label className="col-span-3"><span className="mini">{p.kind === "survey" ? "Introduction" : "Text"}{p.report_id ? ` · from report ${p.report_id}` : ""} — de-identified: no names, registrations, flight numbers</span><textarea name="body" className="inp" rows={12} defaultValue={p.body ?? ""} /></label>
              <label><span className="mini">Audience</span><select name="audience" className="inp" defaultValue={p.audience}>{Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="mini">{p.kind === "survey" ? "Closes on" : "To read by"}</span><input type="date" name={p.kind === "survey" ? "closes_at" : "due"} className="inp" defaultValue={(p.kind === "survey" ? p.closes_at : p.due) ?? ""} /></label>
              <label className="mini flex items-end gap-2">{p.kind === "survey" ? <><input type="checkbox" name="anonymous" value="1" defaultChecked={p.anonymous} /> anonymous answers</> : <><input type="checkbox" name="ack" value="1" defaultChecked={p.ack_required} /> acknowledgement required</>}</label>
              <div className="col-span-3 flex justify-end"><button className="btn">Save</button></div></form></section>
            : <section className="card mb-5"><div className="cb">{p.summary && <p className="mb-3"><b>{p.summary}</b></p>}{paras(p.body).map((t, k) => <p key={k} className="mb-2" style={{ whiteSpace: "pre-wrap" }}>{t}</p>)}</div></section>}

          {p.kind === "survey" && <section className="card mb-5"><div className="ch"><span className="eyebrow">Questions</span>{p.anonymous && <span className="mini">anonymous — answers are not linked to you</span>}</div>
            {edit ? <div className="cb grid gap-2">
                {p.questions.map((q, k) => <div key={q.key} className="flex gap-2 items-center"><span className="flex-1">{k + 1}. {q.label} <span className="mini">· {q.type}{q.options?.length ? `: ${q.options.join(" / ")}` : ""}</span></span><form action={saveQuestion}><Hid /><input type="hidden" name="remove" value={q.key} /><button className="btn">✕</button></form></div>)}
                <form action={saveQuestion} className="grid grid-cols-6 gap-2"><Hid />
                  <input name="label" className="inp col-span-3" placeholder="+ Question (e.g. I can report an error without fear of blame)" style={{ marginTop: 0 }} />
                  <select name="type" className="inp" style={{ marginTop: 0 }} defaultValue="scale"><option value="scale">Scale 1–5</option><option value="choice">Choice</option><option value="text">Free text</option></select>
                  <input name="options" className="inp" placeholder="choices; separated; by ;" style={{ marginTop: 0 }} /><button className="btn">Add</button></form></div>
              : mine && p.status === "published" && !mine.answered_at ? <form action={answerSurvey} className="cb grid gap-3"><Hid />
                {p.questions.map((q, k) => <label key={q.key}><span>{k + 1}. {q.label}</span>
                  {q.type === "text" ? <textarea name={q.key} className="inp" rows={2} /> : <select name={q.key} className="inp" defaultValue=""><option value="">—</option>{(q.type === "scale" ? SCALE : q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>}</label>)}
                <div className="flex justify-end"><button className="btn primary">Send my answers</button></div></form>
              : <div className="cb mini">{mine?.answered_at ? "Answered — thank you." : p.status === "closed" ? "The survey is closed." : `${p.questions.length} question(s).`}</div>}
          </section>}

          {mine && p.status === "published" && p.kind !== "survey" && p.ack_required && <section className="card mb-5"><div className="cb flex items-center gap-3">
            {mine.acknowledged_at ? <span className="mini">Acknowledged on {mine.acknowledged_at.slice(0, 10)}.</span> : <><span>Please confirm you have read and understood this {PROMO_KIND[p.kind].label.toLowerCase()}.</span><form action={ackPromotion} className="ml-auto"><Hid /><button className="btn primary">I have read and understood</button></form></>}</div></section>}

          {desk && p.kind === "survey" && <section className="card mb-5"><div className="ch"><span className="eyebrow">Results</span><span className="mini">{A.length} answer(s)</span></div>
            <div className="cb grid gap-3">{p.questions.map((q, k) => { const v = A.map((a) => a[q.key]).filter(Boolean); const opts = q.type === "scale" ? SCALE : q.options ?? [];
              return <div key={q.key}><b>{k + 1}. {q.label}</b>
                {q.type === "text" ? <ul className="mini" style={{ margin: "4px 0 0 16px", listStyle: "disc" }}>{v.map((t, j) => <li key={j}>{t}</li>)}{!v.length && <li>—</li>}</ul>
                  : <div className="grid gap-1 mt-1">{opts.map((o) => { const n = v.filter((x) => x === o).length; const pc = v.length ? Math.round((n / v.length) * 100) : 0; return <div key={o} className="flex gap-2 items-center mini"><span style={{ width: 170 }}>{o}</span><span style={{ flex: 1, background: "var(--line, #e3e8ee)", height: 8, borderRadius: 4 }}><span style={{ display: "block", width: `${pc}%`, height: 8, borderRadius: 4, background: "var(--accent, #006c9c)" }} /></span><span style={{ width: 70, textAlign: "right" }}>{n} · {pc}%</span></div>; })}
                    {q.type === "scale" && v.length > 0 && <span className="mini">mean {(v.reduce((t, x) => t + Number(String(x)[0]), 0) / v.length).toFixed(1)} / 5</span>}</div>}</div>; })}</div></section>}
        </div>

        {(edit || desk) && <div>
          {edit && <section className="card mb-5"><div className="ch"><span className="eyebrow">Publish</span></div>
            <div className="cb grid gap-2"><p className="mini">Everyone in “{AUDIENCE[p.audience]}” of {p.entity} gets it in the Inbox ({p.kind === "survey" ? "to answer" : p.ack_required ? "to acknowledge" : "to read"}). Once published it is frozen.</p>
              {mayPublish(s) ? <form action={publishPromotion}><Hid /><button className="btn primary">Publish</button></form> : <span className="mini">Published by the safety desk (SM / CMM / FSO).</span>}</div></section>}
          {desk && <section className="card mb-5"><div className="ch"><span className="eyebrow">Reading</span><span className="mini">{R.filter(done).length} / {R.length}</span>
              {p.status === "published" && mayPublish(s) && <form action={closePromotion} className="ml-auto"><Hid /><button className="btn">Close</button></form>}</div>
            <table className="tbl"><tbody>{R.sort((a, b) => Number(!!done(a)) - Number(!!done(b)) || (a.people?.display_name ?? "").localeCompare(b.people?.display_name ?? "")).map((r) => <tr key={r.person_id}><td>{r.people?.display_name ?? "—"}</td><td className="mini" style={{ width: 120 }}>{done(r) ? `${p.kind === "survey" ? "answered" : p.ack_required ? "acknowledged" : "read"} ${done(r)!.slice(0, 10)}` : r.read_at ? `opened ${r.read_at.slice(0, 10)}` : "not opened"}</td></tr>)}</tbody></table></section>}
        </div>}
      </div>
    </>
  );
}
