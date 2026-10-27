import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENTS4 } from "@/lib/nav";
import { daysBetween, fr, type AuthorityFile } from "@/lib/authority";
import type { Project } from "@/lib/projects";

/** Projects › Closed & lessons learned: what each closed file cost in rounds and days, and what we learned. */
export default async function Rex({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { entity: q } = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = s.entity;
  const db = supabaseAdmin();
  let fq = db.from("authority_files").select("*").in("stage", ["closed", "standby"]).order("closed_at", { ascending: false, nullsFirst: false }).limit(300);
  fq = entity === "ALL" ? fq.in("entity", ents) : fq.eq("entity", entity);
  const { data } = await fq;
  const files = (data ?? []) as AuthorityFile[];
  const closed = files.filter((f) => f.stage === "closed" && f.submitted_at);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const atAuth = avg(closed.map((f) => daysBetween(f.submitted_at, f.decision_at) ?? 0));
  const toSubmit = avg(closed.map((f) => daysBetween(f.triggered_at, f.submitted_at) ?? 0));
  const oneRound = closed.length ? Math.round((100 * closed.filter((f) => !f.rounds).length) / closed.length) : 0;
  const fees = files.reduce((a, f) => a + (f.fee ?? 0), 0);
  let pq = db.from("projects").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(100);
  pq = entity === "ALL" ? pq.in("entity", ents) : pq.eq("entity", entity);
  const { data: pData } = await pq;
  const projects = (pData ?? []) as Project[];
  return (
    <>
      <PageHeader eyebrow="Projects · Closed & lessons learned" title="Closed projects and files" sub="Durations, rounds and lessons — the numbers that tell whether the one-round workflow holds." />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Closed files" value={closed.length} />
        <Metric label="Approved in one round" value={`${oneRound} %`} tone={closed.length && oneRound < 80 ? "amber" : undefined} hint="target 100 %" />
        <Metric label="Days trigger → submission" value={toSubmit} hint="average" />
        <Metric label="Days at the authority" value={atAuth} hint={`average · fees ${fees ? `${fees.toLocaleString("fr-FR")} €` : "—"}`} />
      </div>
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Closed projects</span><span className="mini">{projects.length}</span></div>
        <table className="tbl"><thead><tr><th style={{ width: 60 }}>Entity</th><th>Project</th><th style={{ width: 110 }}>Started</th><th style={{ width: 110 }}>Closed</th><th style={{ width: 80 }}>Days</th><th>Lessons</th></tr></thead>
          <tbody>{projects.map((p) => <tr key={p.id}><td><span className={"ent " + p.entity}>{p.entity}</span></td><td><Link className="underline" href={`/proj/boards/${p.id}`}><b>{p.title}</b></Link><div className="mini">{p.template_code ?? "blank project"}</div></td><td className="mono">{fr(p.started_at)}</td><td className="mono">{fr(p.closed_at)}</td><td className="mono">{daysBetween(p.started_at, p.closed_at) ?? "—"}</td><td className="mini">{p.lessons ?? ""}</td></tr>)}
            {!projects.length && <tr><td colSpan={6} className="p-5 text-slate6">No closed project yet.</td></tr>}</tbody></table>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Closed authority files</span><span className="mini">{files.length}</span></div>
        <table className="tbl"><thead><tr><th>Entity</th><th>Type</th><th>File</th><th>Reference</th><th>Submitted</th><th>Decision</th><th>Rounds</th><th>Days</th><th>Lessons</th></tr></thead>
          <tbody>{files.map((f) => <tr key={f.id}><td><span className={"ent " + f.entity}>{f.entity}</span></td><td className="mono">{f.type_code}</td><td><Link className="underline" href={`/proj/auth/${f.id}`}><b>{f.title}</b></Link><div className="mini">{f.stage === "standby" ? "standby" : f.outcome ?? ""}</div></td><td className="mono">{f.portal_ref ?? "—"}</td><td className="mono">{fr(f.submitted_at)}</td><td className="mono">{fr(f.decision_at)}</td><td className="mono">{f.rounds}</td><td className="mono">{daysBetween(f.submitted_at, f.decision_at) ?? "—"}</td><td className="mini">{f.lessons ?? ""}</td></tr>)}
            {!files.length && <tr><td colSpan={9} className="p-6 text-slate6">No closed file yet.</td></tr>}</tbody></table>
      </section>
    </>
  );
}
