import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import { AUDIENCE, PROMO_KIND, PROMO_STATUS, mayWrite, type Promotion } from "@/lib/promotion";
import { createPromotion } from "./actions";

/** Safety › Safety promotion (SAF-09): bulletins, notices and surveys — for the desk the register with reading rates; for everyone, what was sent to them. */
export default async function SafetyPromotion({ searchParams }: { searchParams: Promise<{ k?: string; report?: string; inv?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin(); const writer = mayWrite(s);
  const { data: mine } = s.person ? await db.from("safety_promotion_reads").select("promotion_id,read_at,acknowledged_at,answered_at").eq("person_id", s.person.id) : { data: [] };
  const M = new Map(((mine ?? []) as { promotion_id: string; read_at: string | null; acknowledged_at: string | null; answered_at: string | null }[]).map((r) => [r.promotion_id, r]));
  let q = db.from("safety_promotions").select("*").in("entity", scope).order("created_at", { ascending: false }).limit(300);
  if (!writer) q = q.in("id", [...M.keys(), "00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  const all = ((data ?? []) as Promotion[]).filter((p) => writer || p.status !== "draft");
  const rows = sp.k ? all.filter((p) => p.kind === sp.k) : all;
  const { data: rd } = writer && all.length ? await db.from("safety_promotion_reads").select("promotion_id,read_at,acknowledged_at,answered_at").in("promotion_id", all.filter((p) => p.status !== "draft").map((p) => p.id)) : { data: [] };
  const R = (rd ?? []) as { promotion_id: string; read_at: string | null; acknowledged_at: string | null; answered_at: string | null }[];
  const rate = (p: Promotion) => { const r = R.filter((x) => x.promotion_id === p.id); const done = r.filter((x) => p.kind === "survey" ? x.answered_at : p.ack_required ? x.acknowledged_at : x.read_at).length; return r.length ? `${done} / ${r.length}` : "—"; };
  const todo = all.filter((p) => p.status === "published" && M.has(p.id) && !(p.kind === "survey" ? M.get(p.id)!.answered_at : p.ack_required ? M.get(p.id)!.acknowledged_at : M.get(p.id)!.read_at));
  const tab = (k: string, l: string) => <Link key={k} href={k ? `/safe/promo?k=${k}` : "/safe/promo"} className={"btn" + ((sp.k ?? "") === k ? " on" : "")}>{l}</Link>;
  const y = String(new Date().getUTCFullYear());
  return (
    <>
      <PageHeader eyebrow="Safety · Safety promotion" title={writer ? "Safety promotion" : "Safety bulletins"} sub="Safety bulletins (lessons learned, trends), safety notices (short, urgent, action required) and safety surveys — sent to the people concerned, reading and answers recorded." right={<>{tab("", "All")}{tab("bulletin", "Bulletins")}{tab("notice", "Notices")}{tab("survey", "Surveys")}</>} />
      {writer && <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label={`Bulletins ${y}`} value={all.filter((p) => p.kind === "bulletin" && (p.published_at ?? "").startsWith(y)).length} />
        <Metric label={`Notices ${y}`} value={all.filter((p) => p.kind === "notice" && (p.published_at ?? "").startsWith(y)).length} />
        <Metric label="Surveys open" value={all.filter((p) => p.kind === "survey" && p.status === "published").length} />
        <Metric label="Drafts" value={all.filter((p) => p.status === "draft").length} tone={all.some((p) => p.status === "draft") ? "amber" : undefined} />
      </div>}
      {todo.length > 0 && <section className="card mb-5"><div className="ch"><span className="eyebrow">For you</span><span className="mini">{todo.length}</span></div>
        <div className="cb grid gap-1">{todo.map((p) => <Link key={p.id} href={`/safe/promo/${p.id}`} className="flex gap-2 items-center"><span className="mono">{p.number}</span><b className="flex-1">{p.title}</b><span className="pill amber">{p.kind === "survey" ? "To answer" : p.ack_required ? "To acknowledge" : "To read"}</span></Link>)}</div></section>}
      <section className="card mb-5">
        <table className="tbl"><thead><tr><th style={{ width: 160 }}>Number</th><th>Title</th><th style={{ width: 120 }}>Published</th>{writer && <th style={{ width: 110 }}>{"Read / sent"}</th>}<th style={{ width: 130 }}>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td className="mono"><Link className="underline" href={`/safe/promo/${p.id}`}>{p.number}</Link>{scope.length > 1 && <div><span className={"ent " + p.entity}>{p.entity}</span></div>}</td>
              <td><Link href={`/safe/promo/${p.id}`}><b>{p.title}</b></Link><div className="mini">{PROMO_KIND[p.kind]?.label} · {AUDIENCE[p.audience]}{p.summary ? ` · ${p.summary.slice(0, 120)}` : ""}</div></td>
              <td className="mono">{p.published_at?.slice(0, 10) ?? "—"}</td>
              {writer && <td className="mini">{p.status === "draft" ? "—" : rate(p)}</td>}
              <td><span className={"pill " + (PROMO_STATUS[p.status]?.[1] ?? "")}>{PROMO_STATUS[p.status]?.[0]}</span></td>
            </tr>))}
            {!rows.length && <tr><td colSpan={5} className="p-5 mini">Nothing yet.</td></tr>}</tbody></table>
      </section>
      {writer && s.entity !== "ALL" && <details className="card" open={!!(sp.report || sp.inv)}><summary className="ch cursor-pointer"><span className="eyebrow">+ New</span><span className="mini">{ENT[s.entity]?.name ?? s.entity}</span></summary>
        <form action={createPromotion} className="cb grid grid-cols-6 gap-2">
          <input type="hidden" name="entity" value={s.entity} />{sp.report && <input type="hidden" name="report_id" value={sp.report} />}{sp.inv && <input type="hidden" name="investigation_id" value={sp.inv} />}
          <label className="col-span-2"><span className="mini">Kind</span><select name="kind" className="inp" defaultValue="bulletin">{Object.entries(PROMO_KIND).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.hint}</option>)}</select></label>
          <label className="col-span-4"><span className="mini">Title</span><input name="title" className="inp" required /></label>
          <label className="col-span-2"><span className="mini">Audience</span><select name="audience" className="inp" defaultValue="all">{Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="col-span-4"><span className="mini">Notes for the text (S.A.M. drafts from them{sp.report ? ` and report ${sp.report}` : ""}{sp.inv ? " and the investigation" : ""}, de-identified)</span><textarea name="notes" className="inp" rows={2} /></label>
          <div className="col-span-6 flex justify-end"><button className="btn primary">Create the draft</button></div>
        </form></details>}
    </>
  );
}
