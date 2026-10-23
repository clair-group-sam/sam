import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENTS4 } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { PIVOT_LABEL, type ProjectTemplate } from "@/lib/projects";
import { saveTemplate } from "./actions";

function templateText(t: ProjectTemplate | null): { phases: string; tasks: string } {
  return {
    phases: (t?.phases ?? []).map((p) => `${p.key} | ${p.label}`).join("\n"),
    tasks: (t?.tasks ?? []).map((x) => [x.key, x.phase, x.title, x.owner_role ?? "", x.days ?? "", (x.deps ?? []).join(","), x.link_kind ? `${x.link_kind}:${x.link_ref ?? ""}` : "", x.detail ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n"),
  };
}
function TemplateForm({ t, isNew }: { t: ProjectTemplate | null; isNew?: boolean }) {
  const txt = templateText(t);
  return (
    <form action={saveTemplate} className="grid gap-3 mt-3 p-3" style={{ background: "#f7f9fb", borderRadius: 10 }}>
      <div className="grid grid-cols-4 gap-3">
        <label><span className="mini">Code</span>{isNew ? <input name="code" className="inp mono" required placeholder="e.g. BASE-NEW" /> : <><input type="hidden" name="code" value={t!.code} /><input className="inp mono" value={t!.code} disabled /></>}</label>
        <label className="col-span-2"><span className="mini">Name</span><input name="name" className="inp" required defaultValue={t?.name ?? ""} /></label>
        <label><span className="mini">Order</span><input name="ord" type="number" className="inp" defaultValue={t?.ord ?? 99} /></label>
      </div>
      <label><span className="mini">Description</span><textarea name="description" className="inp" rows={2} defaultValue={t?.description ?? ""} /></label>
      <div className="flex gap-6 flex-wrap">
        <div className="flex gap-3 items-center"><span className="mini">Entities</span>{ENTS4.map((e) => <label key={e} className="flex items-center gap-1"><input type="checkbox" name={`ent_${e}`} defaultChecked={t?.entities.includes(e) ?? true} /><span className={"ent " + e}>{e}</span></label>)}</div>
        <div className="flex gap-3 items-center"><span className="mini">Asks for</span>{Object.entries(PIVOT_LABEL).map(([k, l]) => <label key={k} className="mini flex items-center gap-1"><input type="checkbox" name={`pivot_${k}`} defaultChecked={t?.pivots.includes(k) ?? false} /> {l}</label>)}</div>
        <label className="mini flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={t ? t.active : true} /> active</label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label><span className="mini">Phases — one per line: <code>key | Label</code></span><textarea name="phases" className="inp mono" rows={Math.max(8, (t?.phases.length ?? 0) + 2)} defaultValue={txt.phases} /></label>
        <label className="col-span-2"><span className="mini">Tasks — one per line: <code>key | phase | Title | ROLE | days | dep1,dep2 | link:REF | detail</code> (link = manual:OM-A · authority_file:AC-NEW · certificate:insurance · moc)</span><textarea name="tasks" className="inp mono" rows={Math.max(8, (t?.tasks.length ?? 0) + 2)} defaultValue={txt.tasks} style={{ fontSize: 11.5 }} /></label>
      </div>
      <div className="flex items-center gap-3"><button className="btn primary" type="submit">{isNew ? "+ Create the template" : "Save"}</button><span className="mini">Applies to projects opened afterwards; running projects keep their own tasks. Keys are what dependencies point to — keep them stable.</span></div>
    </form>
  );
}

/** References › Project templates: phases, tasks, owners, durations, dependencies and linked objects of each kind of project. */
export default async function ProjectTemplates({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { edit } = await searchParams;
  const cmm = isCmm(s);
  const { data } = await supabaseAdmin().from("project_templates").select("*").order("ord");
  const templates = (data ?? []) as ProjectTemplate[];
  return (
    <>
      <PageHeader eyebrow="References" title="Project templates" sub="What a kind of project is made of: phases, tasks with their post, duration, dependencies and the S.A.M. object each task calls for. Projects opened from a template copy all of it; lessons learned on a closed project can be pushed back here." right={<Link href="/proj/boards/new" className="btn primary">Open a project</Link>} />
      {templates.map((t) => (
        <section key={t.code} className="card mb-4" id={t.code} style={{ opacity: t.active ? 1 : 0.6 }}>
          <div className="ch"><span className="pill">{t.code}</span><b>{t.name}</b><span className="mini ml-auto">{t.entities.join(" · ")} · {t.phases.length} phases · {t.tasks.length} tasks{t.pivots.length ? ` · asks ${t.pivots.map((k) => PIVOT_LABEL[k] ?? k).join(", ")}` : ""}{!t.active ? " · inactive" : ""}</span></div>
          <div className="cb">
            {t.description && <p className="mini mb-2">{t.description}</p>}
            <div className="grid grid-cols-2 gap-4">
              {t.phases.map((ph) => <div key={ph.key}><div className="eyebrow mb-1">{ph.label}</div><ol className="pl-5 text-[13px] grid gap-1">{t.tasks.filter((x) => x.phase === ph.key).map((x) => <li key={x.key}>{x.title}<span className="mini mono"> {x.owner_role ?? ""}{x.days ? ` · ${x.days} d` : ""}{x.deps?.length ? ` · after ${x.deps.join(", ")}` : ""}{x.link_kind ? ` · ${x.link_kind}${x.link_ref ? `:${x.link_ref}` : ""}` : ""}</span></li>)}</ol></div>)}
            </div>
            {cmm && <details className="mt-2" open={edit === t.code}><summary className="mini underline cursor-pointer">Edit this template</summary><TemplateForm t={t} /></details>}
          </div>
        </section>))}
      {cmm && <section className="card mb-4"><div className="ch"><span className="eyebrow">New template</span><span className="mini">Compliance</span></div><div className="cb"><TemplateForm t={null} isNew /></div></section>}
      <p className="mini">Table project_templates. Every change is in the audit log. AC-NEW was transcribed from the Monday board « MT - AC addition in CAT » (23/10/2026).</p>
    </>
  );
}
