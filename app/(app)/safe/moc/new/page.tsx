import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { DOMAINS, MOC_CATEGORIES, mayEditRisk } from "@/lib/risk";
import { createAssessment } from "../../risk/actions";

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
      <PageHeader eyebrow="Safety · Management of change" title="New management of change" sub={pj ? `For the project “${pj.title}”${tk ? ` — task “${tk.title}”` : ""}` : "Describe the change (MSM §3.4 steps 1–2); hazards, mitigations and sign-offs come next."} />
      <section className="card">
        <form action={createAssessment} className="cb grid grid-cols-3 gap-3"><input type="hidden" name="kind" value="moc" />
          {pj && <input type="hidden" name="project_id" value={pj.id} />}{tk && <input type="hidden" name="project_task_id" value={tk.id} />}
          <label><span className="mini">Entity</span><select name="entity" className="inp" defaultValue={entity}>{s.entities.map((e) => <option key={e} value={e}>{e} — {ENT[e]?.name ?? e}</option>)}</select></label>
          <label className="col-span-2"><span className="mini">The change</span><input name="name" className="inp" required defaultValue={pj ? pj.title : ""} placeholder="e.g. Introduction of the C510 on the Maltese AOC" /></label>
          <label><span className="mini">Category</span><select name="category" className="inp" defaultValue={pj ? "aircraft" : "procedure"}>{Object.entries(MOC_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span className="mini">Domain</span><select name="domain" className="inp">{DOMAINS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label><span className="mini">Planned start</span><input type="date" name="start_date" className="inp" /></label>
          <label><span className="mini">Owner (post)</span><input name="owner_role" className="inp mono" defaultValue={tk?.owner_role ?? "SM"} /></label>
          <label><span className="mini">Permanent / temporary</span><select name="change_type" className="inp"><option value="permanent">permanent</option><option value="temporary">temporary</option></select></label>
          <label><span className="mini">Requestor</span><input name="requestor" className="inp" /></label>
          <label className="col-span-3"><span className="mini">1 · The change in detail — indirect changes, timing, transition period</span><textarea name="description" className="inp" rows={4} /></label>
          <label className="col-span-3"><span className="mini">2 · Reason for the change</span><textarea name="reason" className="inp" rows={2} /></label>
          <label className="col-span-3"><span className="mini">Participants — one per line: Name — role (NPs, managers, experts)</span><textarea name="participants" className="inp" rows={3} placeholder={"Guillaume Fournie — SM\nJonathan Wolski — NPFO"} /></label>
          <div className="col-span-3 flex justify-end"><button className="btn primary">Open the MOC</button></div>
        </form>
      </section>
    </>
  );
}
