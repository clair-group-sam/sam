import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { AT_AUTHORITY, OPEN_STAGES, STAGE_LABEL, STAGE_TONE, daysAtAuthority, fr, nextAction, today, type AuthorityFile, type FileItem, type FileType, type Stage } from "@/lib/authority";

/** Projects › CAA applications: every application, notification and report to the authority, by stage. */
export default async function AuthorityFiles({ searchParams }: { searchParams: Promise<{ entity?: string; stage?: string; type?: string; q?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = sp.entity && (sp.entity === "ALL" ? s.group : ents.includes(sp.entity)) ? sp.entity : s.entity;
  const db = supabaseAdmin();
  let q = db.from("authority_files").select("*").order("updated_at", { ascending: false }).limit(500);
  if (entity !== "ALL") q = q.eq("entity", entity); else q = q.in("entity", ents);
  const stage = sp.stage ?? "open";
  if (stage === "open") q = q.in("stage", OPEN_STAGES); else if (stage !== "all") q = q.eq("stage", stage);
  if (sp.type) q = q.eq("type_code", sp.type);
  if (sp.q) q = q.or(`title.ilike.%${sp.q}%,portal_ref.ilike.%${sp.q}%,finding_ref.ilike.%${sp.q}%,aircraft_reg.ilike.%${sp.q}%`);
  const [{ data: rows }, { data: types }] = await Promise.all([q, db.from("authority_file_types").select("*").order("ord")]);
  const files = (rows ?? []) as AuthorityFile[];
  const typeMap = new Map(((types ?? []) as FileType[]).map((t) => [t.code, t]));
  const ids = files.map((f) => f.id);
  const { data: itemRows } = ids.length ? await db.from("authority_file_items").select("file_id,required,done,label").in("file_id", ids) : { data: [] };
  const itemsBy = new Map<string, Pick<FileItem, "required" | "done" | "label">[]>();
  for (const it of (itemRows ?? []) as (Pick<FileItem, "file_id" | "required" | "done" | "label">)[]) { const a = itemsBy.get(it.file_id) ?? []; a.push(it); itemsBy.set(it.file_id, a); }

  // metrics over the open files of the scope (independent of the stage filter)
  let mq = db.from("authority_files").select("stage,target_date,submitted_at").in("stage", OPEN_STAGES);
  mq = entity !== "ALL" ? mq.eq("entity", entity) : mq.in("entity", ents);
  const { data: open } = await mq;
  const o = (open ?? []) as { stage: Stage; target_date: string | null; submitted_at: string | null }[];
  const t0 = today();
  const atAuth = o.filter((x) => AT_AUTHORITY.includes(x.stage)).length;
  const remarks = o.filter((x) => x.stage === "remarks").length;
  const late = o.filter((x) => AT_AUTHORITY.includes(x.stage) && x.target_date && x.target_date < t0).length;
  const link = (p: Record<string, string | undefined>) => { const u = new URLSearchParams(); const all = { entity, stage, type: sp.type, q: sp.q, ...p }; for (const [k, v] of Object.entries(all)) if (v) u.set(k, v); return `/proj/auth?${u}`; };

  return (
    <>
      <PageHeader eyebrow="Projects · CAA applications" title="CAA applications" sub="Applications, notifications and reports to TM-CAD, the DSAC and the OSAC — one file per change, from the trigger to the close-out."
        right={<Link href="/proj/auth/new" className="btn primary">+ New file</Link>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open files" value={o.length} hint={entity === "ALL" ? "all entities" : ENT[entity]?.name} />
        <Metric label="At the authority" value={atAuth} hint="submitted, waiting for a decision" />
        <Metric label="Remarks to answer" value={remarks} tone={remarks ? "amber" : undefined} hint="authority rounds in progress" />
        <Metric label="Past target date" value={late} tone={late ? "red" : undefined} hint="follow-up due" />
      </div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {ents.length > 1 && <div className="chips">{(s.group ? ["ALL", ...ents] : ents).map((e) => <Link key={e} href={link({ entity: e })} className={"ent " + e + (e === entity ? " on" : "")}>{e}</Link>)}</div>}
        <div className="chips">{[["open", "Open"], ["draft", "Draft"], ["compliance", "Compliance"], ["ready", "Ready"], ["submitted", "At the authority"], ["remarks", "Remarks"], ["approved", "Decision"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={link({ stage: k })} className={"ent" + (stage === k ? " on" : "")}>{l}</Link>)}</div>
        <form className="flex gap-2 ml-auto" action="/proj/auth"><input type="hidden" name="entity" value={entity} /><input type="hidden" name="stage" value={stage} /><input name="q" defaultValue={sp.q ?? ""} placeholder="Search title, reference, finding, registration" className="inp" style={{ width: 300, marginTop: 0 }} /><button className="btn" type="submit">Search</button></form>
      </div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Type</th><th>File</th><th>Stage</th><th>Reference</th><th>Owner</th><th>At authority</th><th>Target</th><th>Next action</th></tr></thead>
          <tbody>
            {files.map((f) => {
              const d = daysAtAuthority(f);
              const late = AT_AUTHORITY.includes(f.stage) && f.target_date && f.target_date < t0;
              return (
                <tr key={f.id}>
                  <td><span className={"ent " + f.entity}>{f.entity}</span></td>
                  <td className="mono"><Link className="underline" href={link({ type: f.type_code })} title={typeMap.get(f.type_code)?.name}>{f.type_code}</Link></td>
                  <td><Link href={`/proj/auth/${f.id}`} className="underline"><b>{f.title}</b></Link><div className="mini">{f.portal ?? f.authority}{f.trigger_note ? ` · ${f.trigger_note}` : ""}</div></td>
                  <td><span className={"pill " + STAGE_TONE[f.stage]}>{STAGE_LABEL[f.stage]}</span>{f.rounds > 0 && <div className="mini">{f.rounds} round{f.rounds > 1 ? "s" : ""}</div>}</td>
                  <td className="mono">{f.portal_url ? <a className="underline" href={f.portal_url} target="_blank" rel="noreferrer">{f.portal_ref ?? "portal"}</a> : f.portal_ref ?? "—"}</td>
                  <td className="mono">{f.owner_role ?? "—"}</td>
                  <td className={"mono" + (late ? " red" : "")}>{d !== null && AT_AUTHORITY.includes(f.stage) ? `${d} d` : f.decision_at && d !== null ? `${d} d` : "—"}</td>
                  <td className={"mono" + (late ? " red" : "")}>{fr(f.target_date)}</td>
                  <td className="mini">{nextAction(f, itemsBy.get(f.id) ?? [])}</td>
                </tr>);
            })}
            {!files.length && <tr><td colSpan={9} className="p-6 text-slate6">No file {stage === "open" ? "open" : stage === "all" ? "" : `in stage “${STAGE_LABEL[stage as Stage] ?? stage}”`} in this scope. <Link className="underline" href="/proj/auth/new">Open one</Link>.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="mini mt-3">Types: {[...typeMap.values()].map((t) => <Link key={t.code} href={link({ type: t.code })} className={"mr-2 underline" + (sp.type === t.code ? " font-bold" : "")}>{t.code}</Link>)} {sp.type && <Link href={link({ type: "" })} className="underline">clear</Link>} · <Link className="underline" href="/ref/types">Reference of application types</Link></p>
    </>
  );
}
