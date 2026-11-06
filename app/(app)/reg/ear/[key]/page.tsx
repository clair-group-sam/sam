import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import type { Regulation } from "@/lib/regulation";
import type { RegItem } from "@/lib/regulation-items";
import { RuleText } from "@/components/RuleText";

type Sp = { q?: string; code?: string };
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
  let hits: RegItem[] = [], items: RegItem[] = [];
  if (v && code) { const { data } = await db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).eq("code", code).or("change.is.null,change.neq.removed").order("ord"); items = (data ?? []) as RegItem[]; }
  else if (v && q) {
    const byCode = /^[A-Z]{2,4}\./.test(q.toUpperCase());
    const { data } = byCode ? await db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).eq("kind", "ir").ilike("code", `${q.toUpperCase()}%`).order("ord").limit(60)
      : await db.from("regulation_items").select("*").eq("regulation_id", r.id).eq("version", v).or(`title.ilike.%${q}%,body_text.ilike.%${q}%`).order("ord").limit(60);
    hits = (data ?? []) as RegItem[];
  }
  return (
    <>
      <PageHeader eyebrow="Regulation, Easy Access Rules" title={r.title} sub={`${r.number ?? ""}, ${r.current_version ?? "version not read"}${v ? `, ${r.items_count} articles in S.A.M. (${v})` : ", articles not loaded"}`}
        right={<div className="flex gap-2"><Link className="btn" href="/reg/ear">All rules</Link>{r.online_url && <a className="btn" href={r.online_url} target="_blank" rel="noreferrer">EASA online ↗</a>}</div>} />
      <form className="card cb mb-4" style={{ display: "flex", gap: 8 }}><input name="q" className="inp" defaultValue={q} placeholder="ORO.GEN.200, SPA.RVSM, fatigue, flight data monitoring…" style={{ flex: 1 }} /><button className="btn primary">Find</button></form>
      {!v && <section className="card"><div className="cb mini">The articles of this text are not loaded in S.A.M. yet, read it on the EASA site.</div></section>}
      {hits.length > 0 && <section className="card mb-4"><div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>Rule</th><th>Where</th></tr></thead><tbody>
        {hits.map((h) => <tr key={h.id}><td><Link href={`/reg/ear/${key}?code=${encodeURIComponent(h.code)}`}><b className="mono">{h.ref}</b> {h.title}</Link><div className="mini">{h.kind.toUpperCase()}{h.source ? `, ${h.source}` : ""}</div></td><td className="mini">{h.annex}{h.section ? `, ${h.section}` : ""}</td></tr>)}</tbody></table></div></section>}
      {q && !hits.length && !code && v && <p className="mini">Nothing found for “{q}”.</p>}
      {items.length > 0 && <RuleText items={items} version={v!} onlineUrl={r.online_url} />}
    </>
  );
}
