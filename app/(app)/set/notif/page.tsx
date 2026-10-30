import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadRules } from "@/lib/escalation";
import { addRule, runNow, saveRule } from "./actions";

/* SOC-02 · Settings › Notification rules: the single ladder every due date follows. */
export default async function NotificationRules() {
  const s = await getSession();
  if (!s) redirect("/login");
  const canEdit = s.roles.includes("SUPERADMIN") || s.roles.includes("CMM") || s.roles.includes("SM");
  const db = supabaseAdmin();
  const rules = await loadRules(db);
  const { data: last } = await db.from("audit_log").select("at,after").eq("object_type", "escalation").order("id", { ascending: false }).limit(1).maybeSingle();
  const lr = last as { at: string; after: Record<string, number> } | null;
  const def = rules.find((r) => r.kind === "*");
  const others = rules.filter((r) => r.kind !== "*");
  return (
    <>
      <PageHeader eyebrow="Settings · Notification rules" title="Reminders & escalation" sub="One ladder for everything with a due date: reminder, chase, department head, Accountable Manager. Days are counted after the due date." right={canEdit ? <form action={runNow}><button className="btn" type="submit">Run the ladder now</button></form> : undefined} />
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">How it works</span><span className="mini">runs once a day with the other S.A.M. jobs · {lr ? `last run ${lr.at.slice(0, 16).replace("T", " ")} · ${Object.entries(lr.after ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}` : "not run yet"}</span></div>
        <div className="cb mini">
          <p><b>Reminder</b> and <b>chase</b>: the owner gets the Teams card again (Inbox unchanged, the item simply turns red). <b>Escalate</b>: a new Inbox item for the CMM (compliance side) or the SM (safety side), pointing at the same object. <b>AM</b>: the same for the Accountable Manager. Each step happens once per item; escalation items close themselves when the original is done. Leave a box empty to skip that step for a kind. The <Link href="/dash/cs">Compliance &amp; Safety dashboard</Link> shows what is overdue, by post.</p>
        </div>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Rules by kind of item</span><span className="mini">{rules.length} rules</span></div>
        <div className="cb" style={{ padding: 0 }}>
          <table className="tbl">
            <thead><tr><th>Kind</th><th>Reminder (J+)</th><th>Chase (J+)</th><th>Escalate (J+)</th><th>To</th><th>AM (J+)</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {[def, ...others].filter(Boolean).map((r) => (
                <tr key={r!.kind}>
                  <td colSpan={8} style={{ padding: 0 }}>
                    <form action={saveRule} className="rulerow">
                      <input type="hidden" name="kind" value={r!.kind} />
                      <span className="rk"><b>{r!.label}</b><span className="mini"> · {r!.kind}</span></span>
                      <input className="inp n" name="remind_days" type="number" min={0} defaultValue={r!.remind_days ?? ""} disabled={!canEdit} />
                      <input className="inp n" name="chase_days" type="number" min={0} defaultValue={r!.chase_days ?? ""} disabled={!canEdit} />
                      <input className="inp n" name="escalate_days" type="number" min={0} defaultValue={r!.escalate_days ?? ""} disabled={!canEdit} />
                      <select className="inp" name="escalate_to" defaultValue={r!.escalate_to ?? ""} disabled={!canEdit}><option value="">—</option><option value="CMM">CMM</option><option value="SM">SM</option></select>
                      <input className="inp n" name="am_days" type="number" min={0} defaultValue={r!.am_days ?? ""} disabled={!canEdit} />
                      <input name="active" type="checkbox" defaultChecked={r!.active} disabled={!canEdit} />
                      {canEdit ? <button className="btn" type="submit">Save</button> : <span />}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <form action={addRule} className="flex items-center gap-2 p-3 mini" style={{ borderTop: "1px solid var(--line)" }}>
              <span>Add a kind:</span>
              <input className="inp" name="kind" placeholder="kind (as in the Inbox, e.g. moc)" style={{ width: 220 }} />
              <input className="inp" name="label" placeholder="Label" style={{ width: 240 }} />
              <button className="btn" type="submit">Add</button>
              <span>Kinds without a rule follow the default.</span>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
