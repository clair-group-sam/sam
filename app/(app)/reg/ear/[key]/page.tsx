import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import type { Regulation } from "@/lib/regulation";
import type { RegItem } from "@/lib/regulation-items";
import { RuleText } from "@/components/RuleText";

type Sp = { q?: string; code?: string; annex?: string; section?: string };
const KIND_ORD: Record<string, number> = { ir: 0, amc: 1, gm: 2 };
/* REG-03 · one EAR in S.A.M.: find a rule by code or words, read it with its AMC / GM in the current version. Everyone can read. */
export default async function EarPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Sp> }) {
  const { key } = await params; const sp = await searchParams;
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data: rd } = await db.from("regulations").select("*").eq("key", key).maybeSingle();
  if (!rd) notFound();
  const r = rd as Regulation & { items_version: string | null; items_count: number | null };
  const v = r.items_version;
  const q = (sp.q ?? "").trim(); const code = (sp.code ?? "").trim();
  let hits: RegItem[] = [], items: RegItem[] = []; let titleHits = 0;
  if (v && code) { const { data } = await db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).eq("code", code).or("change.is.null,change.neq.removed").order("ord"); items = (data ?? []) as RegItem[]; }
  else if (v && q) {
    const byCode = /^[A-Z]{2,4}\./.test(q.toUpperCase());
    const { data } = byCode ? await db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).eq("kind", "ir").ilike("code", `${q.toUpperCase()}%`).order("ord").limit(60)
      : { data: null };
    if (byCode) hits = (data ?? []) as RegItem[];
    else {
      // FB-101 · rules whose title carries the words first (implementing rule, then AMC, then GM), then the ones that only mention them
      const safe = q.replace(/[%,()]/g, " ").trim();
      const base = () => db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).or("change.is.null,change.neq.removed");
      const [{ data: t }, { data: b }] = await Promise.all([base().ilike("title", `%${safe}%`).order("ord").limit(80), base().ilike("body_text", `%${safe}%`).order("ord").limit(80)]);
      const T = ((t ?? []) as RegItem[]).sort((x, y) => (KIND_ORD[x.kind] ?? 9) - (KIND_ORD[y.kind] ?? 9) || x.ord - y.ord);
      const seen = new Set(T.map((x) => x.id)); titleHits = T.length;
      hits = [...T, ...((b ?? []) as RegItem[]).filter((x) => !seen.has(x.id))].slice(0, 100);
    }
  } else if (v && sp.annex) {
    let sq = db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).eq("kind", "ir").or("change.is.null,change.neq.removed");
    sq = sp.annex === "-" ? sq.is("annex", null) : sq.eq("annex", sp.annex);
    sq = sp.section ? sq.eq("section", sp.section) : sq.is("section", null);
    const { data } = await sq.order("ord").limit(300); hits = (data ?? []) as RegItem[];
  }
  // contents: annexes and their sections (implementing rules), shown when nothing is searched
  const toc = new Map<string, Map<string, number>>();
  if (v && !q && !code) for (let from = 0; from < 6000; from += 1000) {
    const { data } = await db.from("regulation_items").select("annex,section").eq("regulation_id", r.id).eq("version", v).eq("kind", "ir").order("ord").range(from, from + 999);
    const rows = (data ?? []) as { annex: string | null; section: string | null }[];
    for (const x of rows) { const a = x.annex ?? "General"; if (!toc.has(a)) toc.set(a, new Map()); const m = toc.get(a)!; const k = x.section ?? ""; m.set(k, (m.get(k) ?? 0) + 1); }
    if (rows.length < 1000) break;
  }
  return (
    <>
      <PageHeader eyebrow="Regulation, Easy Access Rules" title={r.title} sub={`${r.number ?? ""}, ${r.current_version ?? "version not read"}${v ? `, ${r.items_count} articles in S.A.M. (${v})` : ", articles not loaded"}`}
        right={<div className="flex gap-2"><Link className="btn" href="/reg/ear">All rules</Link>{r.online_url && <a className="btn" href={r.online_url} target="_blank" rel="noreferrer">EASA online ↗</a>}</div>} />
      <form className="card cb mb-4" style={{ display: "flex", gap: 8 }}><input name="q" className="inp" defaultValue={q} placeholder="ORO.GEN.200, SPA.RVSM, fatigue, flight data monitoring…" style={{ flex: 1 }} /><button className="btn primary">Find</button></form>
      {!v && <section className="card"><div className="cb mini">The articles of this text are not loaded in S.A.M. yet, read it on the EASA site.</div></section>}
      {q && hits.length > 0 && !code && <p className="mini mb-3">{hits.length}{hits.length === 100 ? "+" : ""} rule{hits.length === 1 ? "" : "s"} for “{q}”{titleHits ? `: ${titleHits} with it in the title (shown first, implementing rules before AMC and GM), then the ones that mention it` : ""}.</p>}
      {!q && !code && sp.annex && <p className="mini mb-3"><Link className="underline" href={`/reg/ear/${key}`}>Contents</Link> › {sp.annex === "-" ? "General" : sp.annex}{sp.section ? ` › ${sp.section}` : ""}: {hits.length} implementing rule{hits.length === 1 ? "" : "s"}; AMC and GM open with each rule.</p>}
      {hits.length > 0 && <section className="card mb-4"><div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>Rule</th><th>Where</th></tr></thead><tbody>
        {hits.map((h) => <tr key={h.id}><td><Link href={`/reg/ear/${key}?code=${encodeURIComponent(h.code)}`}><b className="mono">{h.ref}</b> {h.title}</Link><div className="mini">{h.kind.toUpperCase()}{h.source ? `, ${h.source}` : ""}</div></td><td className="mini">{h.annex}{h.section ? `, ${h.section}` : ""}</td></tr>)}</tbody></table></div></section>}
      {q && !hits.length && !code && v && <p className="mini">Nothing found for “{q}”.</p>}
      {!q && !code && !sp.annex && toc.size > 0 && <section className="card mb-4"><div className="ch"><span className="eyebrow">Contents</span><span className="mini">implementing rules; AMC and GM open with each rule</span></div><div className="cb">
        {[...toc.entries()].map(([a, secs]) => <details key={a} className="mb-2"><summary style={{ cursor: "pointer" }}><b>{a}</b> <span className="mini">{[...secs.values()].reduce((x, y) => x + y, 0)} rules</span></summary>
          <ul className="mini" style={{ margin: "6px 0 8px 18px", columns: secs.size > 8 ? 2 : 1 }}>{[...secs.entries()].map(([sec, n]) => <li key={sec} style={{ padding: "3px 0" }}><Link className="underline" href={`/reg/ear/${key}?annex=${encodeURIComponent(a === "General" ? "-" : a)}${sec ? `&section=${encodeURIComponent(sec)}` : ""}`}>{sec || "General provisions"}</Link> ({n})</li>)}</ul></details>)}
      </div></section>}
      {items.length > 0 && <RuleText items={items} version={v!} onlineUrl={r.online_url} />}
    </>
  );
}
