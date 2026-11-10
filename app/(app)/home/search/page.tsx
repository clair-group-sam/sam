import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { isSafetyDesk } from "@/lib/safety";

type Hit = { href: string; code?: string; title: string; sub?: string; entity?: string };
type Group = { label: string; all?: string; hits: Hit[] };

/* FB-087 · one search for everything S.A.M. holds: manuals, rules, reports, hazards, actions, findings, audits, watch, projects,
   CAA files, meetings, people. Scope and role decide what is searched; each group links to its list. */
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const office = s.role !== "user"; const desk = isSafetyDesk(s);
  const groups: Group[] = [];
  if (q.length >= 2 && scope.length) {
    const db = supabaseAdmin();
    const like = `%${q.replace(/[%_,()]/g, " ").trim()}%`;
    const code = q.toUpperCase().replace(/[^A-Z0-9.()]/g, "");
    const none = Promise.resolve({ data: [] as unknown[] });
    const [man, rules, rep, haz, act, fnd, aud, wat, prj, fil, com, ppl] = await Promise.all([
      db.from("manuals").select("id,entity,code,title").in("entity", scope).or(`title.ilike.${like},code.ilike.${like}`).limit(8),
      /^[A-Z]{2,5}\.[A-Z0-9.]+/.test(code)
        ? db.from("regulation_items").select("code,ref,title,kind,regulations!inner(key,title,items_version),version").eq("kind", "ir").ilike("code", `${code}%`).order("ord").limit(40)
        : db.from("regulation_items").select("code,ref,title,kind,regulations!inner(key,title,items_version),version").eq("kind", "ir").ilike("title", like).order("ord").limit(40),
      desk ? db.from("reports").select("id,entity,headline,headline_en,status,received_at").in("entity", scope).or(`headline.ilike.${like},headline_en.ilike.${like},id.ilike.${like},aircraft.ilike.${like}`).order("received_at", { ascending: false }).limit(8) : none,
      office ? db.from("hazards").select("id,entity,ref,title").in("entity", scope).eq("proposed", false).or(`title.ilike.${like},ref.ilike.${like}`).limit(8) : none,
      office ? db.from("safety_actions").select("id,entity,number,title,status").in("entity", scope).or(`title.ilike.${like},number.ilike.${like}`).order("created_at", { ascending: false }).limit(8) : none,
      office ? db.from("findings").select("id,entity,number,title,status").in("entity", scope).or(`title.ilike.${like},number.ilike.${like}`).limit(8) : none,
      office ? db.from("audits").select("id,entity,number,title,status").in("entity", scope).or(`title.ilike.${like},number.ilike.${like}`).order("planned_month", { ascending: false }).limit(8) : none,
      office ? db.from("watch_entries").select("id,entity,number,title").in("entity", scope).or(`title.ilike.${like},number.ilike.${like}`).limit(8) : none,
      office ? db.from("projects").select("id,entity,title,status").in("entity", scope).ilike("title", like).limit(8) : none,
      office ? db.from("authority_files").select("id,entity,title,stage,portal_ref").in("entity", scope).or(`title.ilike.${like},portal_ref.ilike.${like}`).limit(8) : none,
      office ? db.from("committees").select("id,entity,number,title,status").in("entity", scope).or(`title.ilike.${like},number.ilike.${like}`).order("planned_on", { ascending: false }).limit(8) : none,
      s.role === "cmm" ? db.from("people").select("id,display_name,job_title,home_entity").ilike("display_name", like).limit(8) : none,
    ]);
    type Row = Record<string, string | null> & { regulations?: { key: string; title: string; items_version: string | null } };
    const rows = (x: { data: unknown }) => (x.data ?? []) as Row[];
    const add = (label: string, all: string | undefined, hits: Hit[]) => { if (hits.length) groups.push({ label, all, hits }); };
    add("Manuals", `/docs/lib?q=${encodeURIComponent(q)}`, rows(man).map((m) => ({ href: `/docs/manual/${m.id}`, code: m.code ?? "", title: m.title ?? "", entity: m.entity ?? undefined })));
    groups.push({ label: "Text of the published manuals", hits: [{ href: `/docs/lib?q=${encodeURIComponent(q)}`, title: `Search “${q}” in the text of the manuals`, sub: "chapters and passages, in the Library" }] });
    add("Easy Access Rules", "/reg/ear", rows(rules).filter((r) => r.regulations && r.version === r.regulations.items_version).slice(0, 8).map((r) => ({ href: `/reg/ear/${r.regulations!.key}?code=${encodeURIComponent(r.code ?? "")}`, code: r.ref ?? r.code ?? "", title: r.title ?? "", sub: r.regulations!.title })));
    add("Safety reports", "/safe/reports", rows(rep).map((r) => ({ href: `/safe/reports/${r.id}`, code: r.id ?? "", title: r.headline_en || r.headline || "", sub: r.status ?? "", entity: r.entity ?? undefined })));
    add("Hazards", "/safe/risk", rows(haz).map((h) => ({ href: `/safe/risk/${h.id}`, code: h.ref ?? "", title: h.title ?? "", entity: h.entity ?? undefined })));
    add("Safety actions", "/safe/actions", rows(act).map((a) => ({ href: `/safe/actions/${a.id}`, code: a.number ?? "", title: a.title ?? "", sub: a.status ?? "", entity: a.entity ?? undefined })));
    add("Findings", "/comp/find", rows(fnd).map((f) => ({ href: `/comp/find/${f.id}`, code: f.number ?? "", title: f.title ?? "", sub: f.status ?? "", entity: f.entity ?? undefined })));
    add("Audits", "/comp/audits", rows(aud).map((a) => ({ href: `/comp/audits/${a.id}`, code: a.number ?? "", title: a.title ?? "", sub: a.status ?? "", entity: a.entity ?? undefined })));
    add("Regulatory watch", "/comp/watch", rows(wat).map((w) => ({ href: `/comp/watch/${w.id}`, code: w.number ?? "", title: w.title ?? "", entity: w.entity ?? undefined })));
    add("Projects", "/proj/boards", rows(prj).map((p) => ({ href: `/proj/boards/${p.id}`, title: p.title ?? "", sub: p.status ?? "", entity: p.entity ?? undefined })));
    add("CAA applications", "/proj/auth", rows(fil).map((f) => ({ href: `/proj/auth/${f.id}`, code: f.portal_ref ?? "", title: f.title ?? "", sub: f.stage ?? "", entity: f.entity ?? undefined })));
    add("Committees and meetings", "/safe/comm", rows(com).map((c) => ({ href: `/safe/comm/${c.id}`, code: c.number ?? "", title: c.title ?? "", sub: c.status ?? "", entity: c.entity ?? undefined })));
    add("People", "/users/book", rows(ppl).map((p) => ({ href: `/users/book?open=${p.id}`, title: p.display_name ?? "", sub: p.job_title ?? "", entity: p.home_entity ?? undefined })));
  }
  const total = groups.reduce((n, g) => n + g.hits.length, 0) - (groups.some((g) => g.label.startsWith("Text of")) ? 1 : 0);
  return (
    <>
      <PageHeader eyebrow="S.A.M., Search" title={q ? `Search: ${q}` : "Search"} sub={q.length >= 2 ? `${total} result${total === 1 ? "" : "s"} in ${s.entity === "ALL" ? "every entity of your scope" : "the working entity"}, 8 at most per kind; each heading opens its full list.` : "Type at least 2 letters: a word, a number (2026-002, MOC 39), a registration, a rule code (ORO.GEN.200)."} />
      <form className="card cb mb-4" style={{ display: "flex", gap: 8 }} action="/home/search"><input name="q" className="inp" defaultValue={q} placeholder="bird strike, 9H-AJD, ORO.FTL.120, MOC 39, Leon…" aria-label="Search S.A.M." style={{ flex: 1, marginTop: 0 }} autoFocus /><button className="btn primary">Search</button></form>
      {q.length >= 2 && total === 0 && <p className="mini mb-4">Nothing found outside the text of the manuals. Try a shorter word, or the Group view at the top to search every entity.</p>}
      <div className="searchgrid">
        {groups.map((g) => (
          <section key={g.label} className="card">
            <div className="ch"><h2 className="eyebrow">{g.label}</h2>{g.all && <Link className="mini underline" href={g.all}>open the list</Link>}</div>
            <ul className="searchlist">{g.hits.map((h, i) => <li key={i}><Link href={h.href}>{h.entity && <span className={"ent " + h.entity}>{h.entity}</span>}{h.code && <span className="mono">{h.code}</span>}<b>{h.title}</b>{h.sub && <span className="mini">{h.sub}</span>}</Link></li>)}</ul>
          </section>
        ))}
      </div>
    </>
  );
}
