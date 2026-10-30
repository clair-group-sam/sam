import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { Metric, PageHeader } from "@/components/Page";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { overdueByOwner, STEP_LABEL } from "@/lib/escalation";
import { ENT_COLOR } from "@/lib/nav";

/* DASH-CS · first piece (SOC-02): what is overdue, by post / person, with the escalation level reached. AM, CMM, SM. */
export default async function ComplianceSafetyDash() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!["cmm", "am"].includes(s.role)) redirect("/home/tasks");
  const db = supabaseAdmin();
  const ents = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  const groups = await overdueByOwner(db, ents);
  const total = groups.reduce((n, g) => n + g.count, 0);
  const esc = groups.reduce((n, g) => n + g.escalated, 0);
  const am = groups.reduce((n, g) => n + g.am, 0);
  const worst = groups[0]?.worst ?? 0;
  return (
    <>
      <PageHeader eyebrow="Dashboards · Compliance & Safety · Overdue" title="Overdue items by post" sub="Open Inbox items past their due date, who holds them and how far the reminder ladder has gone. Updated every night." right={<span className="flex gap-2"><Link className="btn" href="/dash/cs">← Dashboard</Link><Link className="btn" href="/set/notif">Notification rules</Link></span>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Overdue items" value={total} tone={total ? "amber" : "green"} hint={total ? `${groups.length} post${groups.length === 1 ? "" : "s"} / person${groups.length === 1 ? "" : "s"}` : "nothing overdue"} />
        <Metric label="Oldest" value={worst ? `${worst} d` : "—"} tone={worst > 15 ? "red" : worst > 7 ? "amber" : undefined} hint="days past due" />
        <Metric label="Escalated to CMM / SM" value={esc} tone={esc ? "amber" : undefined} />
        <Metric label="At the AM" value={am} tone={am ? "red" : undefined} />
      </div>
      {!groups.length && <section className="card"><div className="cb">Nothing is overdue in your scope.</div></section>}
      <div className="grid grid-cols-2 gap-4">
        {groups.map((g) => (
          <section className="card" key={`${g.entity}|${g.owner}`}>
            <div className="ch">
              <span className="eyebrow"><span className="entdot" style={{ background: ENT_COLOR[g.entity] ?? "#888" }} /> {g.entity} · {g.owner}{g.isPerson ? "" : " (post)"}</span>
              <span className={"pill " + (g.worst > 15 ? "red" : g.worst > 7 ? "amber" : "")}>{g.count} overdue · worst {g.worst} d</span>
            </div>
            <div className="cb" style={{ padding: 0 }}>
              <table className="tbl">
                <tbody>
                  {g.items.map((t) => (
                    <tr key={t.id}>
                      <td>{t.link ? <Link href={t.link}>{t.title}</Link> : t.title}<div className="mini">{t.kind.replace(/_/g, " ")} · due {t.due}</div></td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}><span className={"pill " + (t.overdue > 15 ? "red" : t.overdue > 7 ? "amber" : "")}>{t.overdue} d</span>{t.level && <div className="mini">{STEP_LABEL[t.level]}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
