import { supabaseAdmin } from "@/lib/supabase-admin";
import { ACTION_KINDS } from "@/lib/actions-shared";
import { createAction } from "@/app/(app)/safe/actions/actions";

/** Raise a safety action — prefilled from where it comes from (report, hazard / mitigation, assessment). Owner = a post or a person of the entity. */
export default async function NewActionForm({ entity, source, title, description, owner_role, report_id, hazard_id, mitigation_id, assessment_id, stay, compact }: { entity: string; source: string; title?: string; description?: string; owner_role?: string | null; report_id?: string; hazard_id?: string; mitigation_id?: string; assessment_id?: string; stay?: boolean; compact?: boolean }) {
  const { data } = await supabaseAdmin().from("people").select("id,display_name").contains("entities", [entity]).order("display_name").limit(400);
  const people = (data ?? []) as { id: string; display_name: string }[];
  const in2w = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  return (
    <form action={createAction} className={compact ? "grid gap-2" : "grid gap-2 grid-cols-4"}>
      <input type="hidden" name="entity" value={entity} /><input type="hidden" name="source_kind" value={source} />
      {report_id && <input type="hidden" name="report_id" value={report_id} />}{hazard_id && <input type="hidden" name="hazard_id" value={hazard_id} />}
      {mitigation_id && <input type="hidden" name="mitigation_id" value={mitigation_id} />}{assessment_id && <input type="hidden" name="assessment_id" value={assessment_id} />}
      {stay && <input type="hidden" name="stay" value="1" />}
      <label className={compact ? "" : "col-span-4"}><span className="mini">Action</span><input name="title" className="inp" required defaultValue={title ?? ""} placeholder="What must be done (verb first)" /></label>
      {!compact && <label className="col-span-4"><span className="mini">Details (why, scope, expected result)</span><textarea name="description" className="inp" rows={2} defaultValue={description ?? ""} /></label>}
      <div className={compact ? "grid grid-cols-2 gap-2" : "contents"}>
        <label><span className="mini">Owner — post</span><input name="owner_role" className="inp mono" defaultValue={owner_role ?? ""} placeholder="NPFO, NPCA, SM, HT…" /></label>
        <label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue=""><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
        <label><span className="mini">Due</span><input type="date" name="due" className="inp" defaultValue={in2w} /></label>
        <label><span className="mini">Type</span><select name="kind" className="inp" defaultValue="corrective">{Object.entries(ACTION_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <div className={compact ? "" : "col-span-4 flex justify-end"}><button className="btn primary">Raise the action</button></div>
    </form>
  );
}
