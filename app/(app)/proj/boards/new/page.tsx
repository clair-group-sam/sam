import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { today } from "@/lib/authority";
import { PIVOT_LABEL, loadTemplates } from "@/lib/projects";
import { createProject } from "../actions";

/** Projects › New project: blank, or from a template whose phases, tasks, owners, durations and dependencies are copied. */
export default async function NewProject({ searchParams }: { searchParams: Promise<{ entity?: string; template?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "user") redirect("/proj/boards");
  const sp = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = sp.entity && ents.includes(sp.entity) ? sp.entity : s.entity !== "ALL" && ents.includes(s.entity) ? s.entity : ents[0];
  const templates = (await loadTemplates(supabaseAdmin())).filter((t) => t.entities.includes(entity));
  const chosen = templates.find((t) => t.code === sp.template) ?? null;
  const pivots = chosen ? chosen.pivots : ["aircraft_type", "aircraft_reg", "np_post_code"];
  return (
    <>
      <PageHeader eyebrow="Projects" title="New project" sub={`${ENT[entity]?.name ?? entity} · pick a template or start blank; phases and tasks can be changed afterwards.`} right={<Link href="/proj/boards" className="btn">‹ Projects</Link>} />
      {ents.length > 1 && <div className="chips mb-4" style={{ display: "inline-flex" }}>{ents.map((e) => <Link key={e} href={`/proj/boards/new?entity=${e}`} className={"ent " + e + (e === entity ? " on" : "")}>{e}</Link>)}</div>}
      <div className="grid grid-cols-3 gap-4 items-start">
        <section className="card">
          <div className="ch"><span className="eyebrow">Template</span><span className="mini">{templates.length} for {entity}</span></div>
          <div className="cb grid gap-2">
            <Link href={`/proj/boards/new?entity=${entity}`} className={"tplrow" + (!chosen ? " on" : "")}><b>Blank project</b><span className="mini">One phase, add your own tasks.</span></Link>
            {templates.map((t) => <Link key={t.code} href={`/proj/boards/new?entity=${entity}&template=${t.code}`} className={"tplrow" + (chosen?.code === t.code ? " on" : "")}><b>{t.name}</b><span className="mini">{t.code} · {t.phases.length} phases · {t.tasks.length} tasks</span></Link>)}
            <p className="mini">Templates are maintained in the database (project_templates); a change applies to projects opened afterwards.</p>
          </div>
        </section>
        <section className="card col-span-2">
          <div className="ch"><span className="eyebrow">{chosen ? chosen.name : "Blank project"}</span></div>
          <form action={createProject} className="cb grid gap-3">
            <input type="hidden" name="entity" value={entity} /><input type="hidden" name="template_code" value={chosen?.code ?? ""} />
            {chosen?.description && <p className="mini">{chosen.description}</p>}
            <label><span className="mini">Title</span><input name="title" className="inp" placeholder={chosen ? `${chosen.name} — …` : "What this project achieves"} /></label>
            {pivots.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {pivots.map((k) => <label key={k}><span className="mini">{PIVOT_LABEL[k] ?? k}</span><input name={`pivot_${k}`} className="inp mono" placeholder={k === "aircraft_type" ? "GL7T, C68A…" : k === "aircraft_reg" ? "9H-XXX / F-HXXX" : "NPFO, CMM, HT…"} /></label>)}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <label><span className="mini">Owner post</span><input name="owner_role" className="inp mono" defaultValue="CMM" /></label>
              <label><span className="mini">Start</span><input name="started_at" type="date" className="inp" defaultValue={today()} /></label>
              <label><span className="mini">Target date</span><input name="target_date" type="date" className="inp" /></label>
            </div>
            <label className="mini flex items-center gap-2"><input type="checkbox" name="owner_me" /> I am the owner of this project (by name, not by post)</label>
            <label><span className="mini">Description</span><textarea name="description" className="inp" rows={2} placeholder="Context, scope, what is out of scope" /></label>
            {chosen && (
              <details><summary className="mini underline cursor-pointer">What the template creates ({chosen.tasks.length} tasks)</summary>
                {chosen.phases.map((ph) => <div key={ph.key} className="mt-2"><div className="eyebrow">{ph.label}</div><ul className="pl-5 text-[13px] list-disc">{chosen.tasks.filter((t) => t.phase === ph.key).map((t) => <li key={t.key}>{t.title}<span className="mini"> {t.owner_role ? `· ${t.owner_role}` : ""}{t.days ? ` · ${t.days} d` : ""}{t.link_kind ? ` · ${t.link_kind.replace("_", " ")} ${t.link_ref ?? ""}` : ""}</span></li>)}</ul></div>)}
              </details>
            )}
            <div><button className="btn primary" type="submit">Create the project</button></div>
          </form>
        </section>
      </div>
    </>
  );
}
