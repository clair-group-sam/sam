import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { MOC_CATEGORIES, mayEditRisk } from "@/lib/risk";
import { createMoc } from "../../risk/actions";

/** New MOC — also opened from a project task ("MOC / risk assessment"), which it then follows. */
export default async function NewMoc({ searchParams }: { searchParams: Promise<{ project?: string; task?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!mayEditRisk(s)) redirect("/safe/moc");
  const { project, task } = await searchParams;
  const db = supabaseAdmin();
  const { data: p } = project ? await db.from("projects").select("id,entity,title").eq("id", project).maybeSingle() : { data: null };
  const { data: t } = task ? await db.from("project_tasks").select("id,title,owner_role").eq("id", task).maybeSingle() : { data: null };
  const pj = p as { id: string; entity: string; title: string } | null; const tk = t as { id: string; title: string; owner_role: string | null } | null;
  const entity = pj?.entity ?? (s.entity !== "ALL" ? s.entity : s.entities[0]);
  return (
    <>
      <PageHeader eyebrow="Safety · Management of change" title="New management of change" sub={pj ? `For the project “${pj.title}”${tk ? ` — task “${tk.title}”` : ""}` : "Describe the change; the risk assessment comes next, SAM can propose the hazards."} />
      <section className="card">
        <form action={createMoc} className="cb grid grid-cols-3 gap-3">
          {pj && <input type="hidden" name="project_id" value={pj.id} />}{tk && <input type="hidden" name="project_task_id" value={tk.id} />}
          <label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={entity}>{s.entities.map((e) => <option key={e} value={e}>{e} — {ENT[e]?.name ?? e}</option>)}</select></label>
          <label className="col-span-2"><span className="mini">The change</span><input name="title" className="inp" required defaultValue={pj ? pj.title : ""} placeholder="e.g. Introduction of the C510 on the Maltese AOC" /></label>
          <label><span className="mini">Category</span><select name="category" className="inp" defaultValue={pj ? "aircraft" : "procedure"}>{Object.entries(MOC_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" defaultValue={tk?.owner_role ?? "SM"} /></label>
          <label><span className="mini">Target date</span><input type="date" name="target_date" className="inp" /></label>
          <label className="col-span-3"><span className="mini">What changes, why, from when, who is affected</span><textarea name="description" className="inp" rows={5} /></label>
          <div className="col-span-3 flex justify-end"><button className="btn primary">Open the MOC</button></div>
        </form>
      </section>
    </>
  );
}
