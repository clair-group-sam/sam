import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { AuditGrid } from "@/components/AuditGrid";
import { ENT, ENT_COLOR, ENTS4 } from "@/lib/nav";
import { coverage, current, elapsedPct, PROG_REF, PROG_STATUS, type Audit, type AuditModule, type Programme } from "@/lib/audit-programme";
import { today } from "@/lib/authority";
import { createProgramme } from "./actions";

/* AUD-01 · Compliance › Audit programme. The programme in force for each entity of the scope: its cycle, the audits month by month, what is done,
 * what moved and what the cycle does not cover yet. Older and next cycles below. */
export default async function AuditProgramme() {
  const s = await getSession();
  if (!s) redirect("/login");
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const db = supabaseAdmin();
  const desk = s.role === "cmm";
  const t0 = today();
  let q = db.from("audit_programmes").select("*").order("starts_on", { ascending: false });
  if (scope) q = q.in("entity", scope);
  const { data: pd } = await q;
  const progs = (pd ?? []) as Programme[];
  const cur = current(progs, t0);
  const ids = cur.map((p) => p.id);
  const [{ data: md }, { data: ad }] = ids.length ? await Promise.all([
    db.from("audit_modules").select("*").in("programme_id", ids).order("sort").order("code"),
    db.from("audits").select("*").in("programme_id", ids).order("planned_month"),
  ]) : [{ data: [] }, { data: [] }];
  const mods = (md ?? []) as AuditModule[], audits = (ad ?? []) as Audit[];
  const per = cur.map((p) => { const m = mods.filter((x) => x.programme_id === p.id), a = audits.filter((x) => x.programme_id === p.id); return { p, m, a, c: coverage(p, m, a, t0) }; });
  const tot = per.reduce((o, x) => ({ d: o.d + x.c.done, p: o.p + x.c.planned, r: o.r + x.c.replanned, l: o.l + x.c.late, g: o.g + x.c.gaps.length + x.c.modulesWithout.length }), { d: 0, p: 0, r: 0, l: 0, g: 0 });
  const ents = scope ?? ENTS4;
  const others = progs.filter((p) => !ids.includes(p.id));
  return (
    <>
      <PageHeader eyebrow="Compliance, Audit programme" title="Audit programme" sub="One programme per entity and cycle: the areas to audit, the requirements they cover, the audits month by month. A moved audit keeps its reason." right={desk ? <details className="inlineedit" style={{ position: "relative" }}><summary className="btn">+ Programme</summary>
        <form action={createProgramme} className="card cb grid gap-2" style={{ position: "absolute", right: 0, top: 36, width: 440, zIndex: 5 }}>
          <label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={ents[0]}>{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}, {PROG_REF[e]?.reference}</option>)}</select></label>
          <label><span className="mini">Title</span><input name="title" className="inp" placeholder="Audit programme 2026-2027" /></label>
          <div className="grid grid-cols-2 gap-2"><label><span className="mini">Cycle (months)</span><input name="cycle_months" type="number" min={6} max={36} className="inp" defaultValue={12} /></label><label><span className="mini">Starts (month)</span><input name="starts_on" type="month" className="inp" defaultValue={t0.slice(0, 7)} /></label></div>
          <label><span className="mini">Reference (blank = the MSM one)</span><input name="reference" className="inp mono" /></label>
          <label><span className="mini">Requirements the cycle must cover, one per line (optional, for the coverage matrix)</span><textarea name="requirements" className="inp mono" rows={3} placeholder={"ORO.GEN.200\nORO.FC.230"} /></label>
          <div className="flex justify-end"><button className="btn primary" type="submit">Create</button></div></form></details> : undefined} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Audits done" value={tot.d} hint="in the cycles in force" tone={tot.d ? "green" : undefined} />
        <Metric label="Planned" value={tot.p} hint={tot.l ? `${tot.l} with the month passed` : "remaining in the cycles"} tone={tot.l ? "red" : undefined} />
        <Metric label="Replanned" value={tot.r} hint="reason traced" tone={tot.r ? "amber" : undefined} />
        <Metric label="Coverage gaps" value={tot.g} hint="modules / requirements without an audit" tone={tot.g ? "amber" : "green"} />
      </div>
      {!per.length && <section className="card"><div className="cb mini">No audit programme in your scope yet.{desk ? " Create the first one with + Programme." : ""}</div></section>}
      {per.map(({ p, m, a, c }) => {
        const pct = elapsedPct(p, t0);
        return (
          <section key={p.id} className="card mb-4">
            <div className="ch" style={{ flexWrap: "wrap", gap: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="entdot" style={{ background: ENT_COLOR[p.entity] ?? "var(--field)" }} /><Link href={`/comp/prog/${p.id}`}><b>{ENT[p.entity]?.name ?? p.entity}, {p.title}</b></Link><span className="mini mono">{p.reference ?? PROG_REF[p.entity]?.reference}, {PROG_REF[p.entity]?.msm}</span></span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span className={"pill " + (p.status === "approved" ? "green" : p.status === "draft" ? "amber" : "")}>{PROG_STATUS[p.status]}</span><span className="pill">{p.cycle_months}-month cycle</span><span className="mono mini">{p.starts_on} → {p.ends_on}</span>
                <span className="mini">{pct} % elapsed, {c.done} done / {c.done + c.planned} audits</span><Link className="btn sm" href={`/comp/prog/${p.id}`}>Open</Link></span>
            </div>
            <div className="cb"><AuditGrid p={p} mods={m} audits={a} t0={t0} />
              {(c.modulesWithout.length > 0 || c.gaps.length > 0) && <p className="mini mt-2" style={{ color: "var(--amber-ink)" }}>{c.modulesWithout.length ? `No audit yet for ${c.modulesWithout.map((x) => x.code).join(", ")}. ` : ""}{c.gaps.length ? `Requirements not covered: ${c.gaps.join(", ")}.` : ""}</p>}
            </div>
          </section>
        );
      })}
      {others.length > 0 && <section className="card"><div className="ch"><span className="eyebrow">Other cycles</span></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Entity</th><th>Programme</th><th>Cycle</th><th>Status</th></tr></thead><tbody>{others.map((p) => (
          <tr key={p.id}><td><span className="entdot" style={{ background: ENT_COLOR[p.entity] ?? "var(--field)" }} />{p.entity}</td><td><Link href={`/comp/prog/${p.id}`}><b>{p.title}</b></Link></td><td className="mono">{p.starts_on} → {p.ends_on}</td><td><span className="pill">{PROG_STATUS[p.status]}</span></td></tr>))}</tbody></table></div></section>}
    </>
  );
}
