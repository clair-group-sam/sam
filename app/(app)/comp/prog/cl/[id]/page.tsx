import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENT_COLOR } from "@/lib/nav";
import { loadChecklist } from "@/lib/audit-run";
import type { Regulation } from "@/lib/regulation";
import { addItems, removeItem, removeSection, saveChecklist, saveItem, saveSection } from "../actions";

/* AUD-02 · one checklist: sections and items (rule code + optional house wording / guidance). The official text is read at audit time from the EAR loaded. */
export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const x = await loadChecklist(db, id); if (!x) notFound();
  const { cl, sections, items } = x;
  if (!s.group && !s.entities.includes(cl.entity)) notFound();
  const desk = s.role === "cmm";
  const [{ data: regs }, { data: mods }, { data: used }] = await Promise.all([
    db.from("regulations").select("*").eq("active", true).order("sort"),
    db.from("audit_modules").select("id,code,title,programme_id").eq("checklist_id", cl.id),
    db.from("audits").select("id,number,status,planned_month").eq("checklist_id", cl.id).order("planned_month", { ascending: false }).limit(10),
  ]);
  const regulations = ((regs ?? []) as (Regulation & { items_version: string | null; items_count: number | null })[]).filter((r) => r.entities.includes(cl.entity));
  const regName = (rid: string | null) => regulations.find((r) => r.id === rid)?.short ?? "—";
  const defReg = regulations.find((r) => r.id === cl.regulation_id);
  // codes of the default EAR, to flag items whose rule is not found in the loaded text
  const codes = new Set<string>();
  if (defReg?.items_version) { const { data } = await db.from("regulation_items").select("code").eq("regulation_id", defReg.id).eq("version", defReg.items_version).eq("kind", "ir").limit(20000); for (const r of (data ?? []) as { code: string }[]) codes.add(r.code); }
  const review = items.filter((i) => i.review_flag);
  const unknown = items.filter((i) => (i.regulation_id ?? cl.regulation_id) === defReg?.id && codes.size && !codes.has(i.code));
  const secOf = (sid: string | null) => sections.find((q) => q.id === sid);
  const groups: { sec: typeof sections[number] | null; list: typeof items }[] = [...sections.map((sec) => ({ sec, list: items.filter((i) => i.section_id === sec.id) })), { sec: null, list: items.filter((i) => !i.section_id || !secOf(i.section_id)) }].filter((g) => g.list.length || g.sec);
  return (
    <>
      <PageHeader eyebrow={`Compliance, Checklists, ${cl.entity}`} title={`${cl.code}, ${cl.title}`} sub={`${ENT[cl.entity]?.name ?? cl.entity}${cl.domain ? `, ${cl.domain}` : ""}, default text: ${defReg ? `${defReg.short} (${defReg.items_version ?? "articles not loaded"})` : "none"}${(mods ?? []).length ? `, used by module${(mods ?? []).length > 1 ? "s" : ""} ${((mods ?? []) as { code: string }[]).map((m) => m.code).join(", ")}` : ""}${cl.imported_from ? `, imported from ${cl.imported_from}` : ""}`}
        right={<div className="flex gap-2"><Link className="btn" href="/comp/prog">Audit programme</Link>{((mods ?? []) as { programme_id: string }[])[0] && <Link className="btn" href={`/comp/prog/${((mods ?? []) as { programme_id: string }[])[0].programme_id}`}>Programme</Link>}</div>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Items" value={items.length} hint={`${sections.length} section${sections.length === 1 ? "" : "s"}`} />
        <Metric label="Rules covered" value={new Set(items.map((i) => i.code)).size} hint="distinct codes" />
        <Metric label="To review" value={review.length} hint="rule changed in a new EAR version" tone={review.length ? "amber" : "green"} />
        <Metric label="Not in the loaded text" value={unknown.length} hint={unknown.length ? unknown.slice(0, 4).map((i) => i.code).join(", ") : "all codes found"} tone={unknown.length ? "amber" : undefined} />
      </div>
      {!desk && <p className="mini mb-3">Read-only: the Compliance desk maintains the checklists.</p>}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 360px" }}>
        <div>
          {groups.map(({ sec, list }) => (
            <section key={sec?.id ?? "none"} className="card mb-3"><div className="ch"><span className="eyebrow">{sec ? `${sec.code ? sec.code + ", " : ""}${sec.title}` : "Without section"}</span><span className="mini">{list.length}</span></div>
              <div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{list.map((it) => (
                <tr key={it.id} className={it.review_flag ? "late" : ""}><td style={{ width: 200 }}><Link href={`/reg/ear/${regulations.find((r) => r.id === (it.regulation_id ?? cl.regulation_id))?.key ?? ""}?code=${encodeURIComponent(it.code)}`}><b className="mono">{it.ref ?? it.code}</b></Link>{it.regulation_id && it.regulation_id !== cl.regulation_id && <div className="mini">{regName(it.regulation_id)}</div>}{codes.size > 0 && !codes.has(it.code) && (it.regulation_id ?? cl.regulation_id) === defReg?.id && <div className="mini" style={{ color: "#8a5a00" }}>not found in the loaded text</div>}</td>
                  <td>{it.question && <div>{it.question}</div>}{it.guidance && <div className="mini">{it.guidance}</div>}{it.review_flag && <div className="mini" style={{ color: "#8a5a00" }}>To review, {it.review_note}</div>}</td>
                  {desk && <td style={{ width: 70 }}><details className="inlineedit" style={{ position: "relative" }}><summary className="btn sm">Edit</summary>
                    <div className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 30, width: 460, zIndex: 5 }}>
                      <form action={saveItem} className="grid gap-2"><input type="hidden" name="checklist" value={cl.id} /><input type="hidden" name="id" value={it.id} />
                        <div className="grid grid-cols-3 gap-2"><label><span className="mini">Code</span><input name="code" className="inp mono" defaultValue={it.code} /></label><label><span className="mini">Precise ref</span><input name="ref" className="inp mono" defaultValue={it.ref ?? ""} /></label><label><span className="mini">Order</span><input name="ord" type="number" className="inp" defaultValue={it.ord} /></label></div>
                        <label><span className="mini">Section</span><select name="section" className="inp" defaultValue={it.section_id ?? ""}><option value="">—</option>{sections.map((q) => <option key={q.id} value={q.id}>{q.code ? q.code + ", " : ""}{q.title}</option>)}</select></label>
                        <label><span className="mini">Question / what is checked</span><input name="question" className="inp" defaultValue={it.question ?? ""} /></label>
                        <label><span className="mini">House guidance</span><textarea name="guidance" className="inp" rows={2} defaultValue={it.guidance ?? ""} /></label>
                        {it.review_flag && <label className="mini"><input type="checkbox" name="reviewed" /> Reviewed against the new version</label>}
                        <div className="flex justify-end"><button className="btn primary sm">Save</button></div></form>
                      <form action={removeItem}><input type="hidden" name="checklist" value={cl.id} /><input type="hidden" name="id" value={it.id} /><button className="btn sm">Remove</button></form>
                    </div></details></td>}
                </tr>))}{!list.length && <tr><td className="mini">No item yet.</td></tr>}</tbody></table></div>
              {desk && sec && <div className="cb mini flex gap-2" style={{ borderTop: "1px solid var(--line)" }}><form action={saveSection} className="flex gap-2" style={{ flex: 1 }}><input type="hidden" name="checklist" value={cl.id} /><input type="hidden" name="id" value={sec.id} /><input name="code" className="inp mono" defaultValue={sec.code ?? ""} style={{ width: 90 }} /><input name="title" className="inp" defaultValue={sec.title} style={{ flex: 1 }} /><input name="ord" type="number" className="inp" defaultValue={sec.ord} style={{ width: 70 }} /><button className="btn sm">Rename</button></form><form action={removeSection}><input type="hidden" name="checklist" value={cl.id} /><input type="hidden" name="id" value={sec.id} /><button className="btn sm">Remove section</button></form></div>}
            </section>))}
          {review.length > 0 && desk && <p className="mini">Items marked “to review” keep the flag until you tick “Reviewed against the new version” in their Edit box.</p>}
        </div>
        <div>
          {desk && <>
            <section className="card mb-3"><div className="ch"><span className="eyebrow">Add items</span></div><form action={addItems} className="cb grid gap-2"><input type="hidden" name="checklist" value={cl.id} />
              <label><span className="mini">Section</span><select name="section" className="inp" defaultValue={sections[0]?.id ?? ""}><option value="">—</option>{sections.map((q) => <option key={q.id} value={q.id}>{q.code ? q.code + ", " : ""}{q.title}</option>)}</select></label>
              <label><span className="mini">Text (EAR)</span><select name="regulation" className="inp" defaultValue={cl.regulation_id ?? ""}><option value="">none (house check)</option>{regulations.map((r) => <option key={r.id} value={r.id}>{r.short}</option>)}</select></label>
              <label><span className="mini">One per line, code, or code | question | guidance</span><textarea name="items" className="inp mono" rows={7} placeholder={"ORO.GEN.200\nAMC1 ORO.GEN.200(a)(3)\nC1-01 | Flight package complete | sample 5 flights of the month"} /></label>
              <div className="flex justify-end"><button className="btn primary sm">Add</button></div></form></section>
            <section className="card mb-3"><div className="ch"><span className="eyebrow">New section</span></div><form action={saveSection} className="cb grid gap-2"><input type="hidden" name="checklist" value={cl.id} /><div className="grid grid-cols-3 gap-2"><input name="code" className="inp mono" placeholder="Code" /><input name="title" className="inp col-span-2" placeholder="Title" required /></div><div className="flex justify-end"><button className="btn sm">Add section</button></div></form></section>
            <section className="card mb-3"><div className="ch"><span className="eyebrow">Checklist</span></div><form action={saveChecklist} className="cb grid gap-2"><input type="hidden" name="id" value={cl.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={cl.title} /></label>
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Domain</span><input name="domain" className="inp" defaultValue={cl.domain ?? ""} /></label><label><span className="mini">Default text</span><select name="regulation" className="inp" defaultValue={cl.regulation_id ?? ""}><option value="">—</option>{regulations.map((r) => <option key={r.id} value={r.id}>{r.short}</option>)}</select></label></div>
              <label><span className="mini">Note</span><textarea name="note" className="inp" rows={2} defaultValue={cl.note ?? ""} /></label>
              <div className="flex justify-end"><button className="btn primary sm">Save</button></div></form></section></>}
          <section className="card"><div className="ch"><span className="eyebrow">Audits run with it</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{((used ?? []) as { id: string; number: string; status: string; planned_month: string }[]).map((a) => <tr key={a.id}><td><Link href={`/comp/audits/${a.id}`}><b className="mono">{a.number}</b></Link></td><td className="mini">{a.planned_month.slice(0, 7)}</td><td className="mini">{a.status}</td></tr>)}{!(used ?? []).length && <tr><td className="mini">None yet.</td></tr>}</tbody></table></div></section>
        </div>
      </div>
      <p className="mini mt-3"><span className="entdot" style={{ background: ENT_COLOR[cl.entity] ?? "#888" }} />{cl.entity}</p>
    </>
  );
}
