import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { KIND, myInbox, groupProjects } from "@/lib/inbox";
import { CoffeeBox } from "@/components/CoffeeBox";
import { todaysRecap, parisParts } from "@/lib/coffee";
import { hasGraph } from "@/lib/msgraph-user";

export const maxDuration = 60;

export default async function Inbox() {
  const s = await getSession();
  if (!s) redirect("/login");
  const all = await myInbox(s);
  const [recap, connected] = s.person ? await Promise.all([todaysRecap(s.person.id), hasGraph(s.person.id)]) : [null, false];
  const { day: today, hour } = parisParts();
  const late = all.filter((t) => t.due && t.due < today).length;
  // projects: one line each (title, tasks waiting for me, late, next) — the detail is on the project page
  const tasks = groupProjects(all, today);
  const first = s.name.split(" ")[0];
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader eyebrow="S.A.M. · Inbox" title={`${greet} ${first}`} sub="Everything that needs you, in one list." />
      <CoffeeBox recap={recap} connected={connected} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Open items" value={all.length} hint={s.entity === "ALL" ? "all entities" : ENT[s.entity]?.name} />
        <Metric label="Overdue" value={late} tone={late ? "red" : undefined} hint="past due date" />
        <Metric label="Scope" value={s.group ? "Group" : s.entities.join(" · ") || "—"} hint={s.roles.join(", ") || "no role yet"} />
      </div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th style={{ width: 70 }}>Entity</th><th style={{ width: 160 }}>What</th><th style={{ width: 110 }}>Due</th><th>Item</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><span className={"ent " + t.entity}>{t.entity}</span></td>
                <td><span className={"kind " + (KIND[t.kind]?.[1] ?? "")}>{KIND[t.kind]?.[0] ?? t.kind.replace(/_/g, " ")}</span></td>
                <td className={"mono" + (t.due && t.due < today ? " red" : "")}>{t.due ?? "—"}</td>
                <td>
                  {t.ctx && <div className="ctx">{t.kind === "project" ? "Project · " : ""}{t.ctxLink ? <Link href={t.ctxLink}>{t.ctx}</Link> : t.ctx}</div>}
                  {t.link ? <Link href={t.link} className="underline"><b>{t.title}</b></Link> : <b>{t.title}</b>}{t.detail && <div className="mini">{t.detail}</div>}
                </td>
              </tr>
            ))}
            {!tasks.length && (
              <tr><td colSpan={4} className="p-6 text-slate6">
                {s.person ? "Nothing to do." : "Your account is not yet attached to a person in S.A.M. — ask the CMM to add you."}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
