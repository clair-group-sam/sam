import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { KIND, myInbox, groupProjects } from "@/lib/inbox";
import { CoffeeBox } from "@/components/CoffeeBox";
import { todaysRecap, parisParts } from "@/lib/coffee";
import { hasGraph } from "@/lib/msgraph-user";
import { isTestData, TEST_PILL_TITLE } from "@/lib/testdata";

export const maxDuration = 60;

export default async function Inbox() {
  const s = await getSession();
  if (!s) redirect("/login");
  const all = await myInbox(s);
  // FB-071 · working in one entity: say what waits in the others of the scope, instead of "Nothing to do"
  const elsewhere = new Map<string, number>();
  if (s.entity !== "ALL" && (s.group || s.entities.length > 1)) for (const t of groupProjects(await myInbox({ ...s, entity: "ALL" }), parisParts().day)) if (t.entity && t.entity !== s.entity && !isTestData(t.title, (t as { ctx?: string }).ctx)) elsewhere.set(t.entity, (elsewhere.get(t.entity) ?? 0) + 1);
  const elseTotal = [...elsewhere.values()].reduce((a, b) => a + b, 0);
  const elseText = [...elsewhere.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${ENT[e]?.name ?? e} ${n}`).join(", ");
  const [recap, connected] = s.person ? await Promise.all([todaysRecap(s.person.id), hasGraph(s.person.id)]) : [null, false];
  const { day: today, hour } = parisParts();
  // FB-024 · test objects are labelled and left out of the counters
  const isTest = (t: { title: string; ctx?: string }) => isTestData(t.title, t.ctx);
  const real = all.filter((t) => !isTest(t));
  const late = real.filter((t) => t.due && t.due < today).length;
  const testCount = all.length - real.length;
  // projects: one line each (title, tasks waiting for me, late, next) — the detail is on the project page
  const tasks = groupProjects(all, today).sort((a, b) => Number(isTest(a)) - Number(isTest(b)));
  const first = s.name.split(" ")[0];
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader eyebrow="S.A.M., Inbox" title={`${greet} ${first}`} sub="Everything that needs you, in one list." />
      <CoffeeBox recap={recap} connected={connected} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Open tasks" value={real.length} hint={(s.entity === "ALL" ? "all entities" : ENT[s.entity]?.name) + (testCount ? `, + ${testCount} test` : "") + (tasks.length !== all.length ? `, ${tasks.length} lines (a project = one line)` : "")} />
        <Metric label="Overdue tasks" value={late} tone={late ? "red" : "green"} hint={late ? "past due date" : "nothing late"} />
        {s.entity !== "ALL" && (s.group || s.entities.length > 1) ? <Metric label="In your other entities" value={elseTotal} tone={elseTotal ? "amber" : "green"} hint={elseTotal ? `${elseText}; switch entity at the top, or Group to see all` : "nothing waiting elsewhere"} /> : <Metric label="Your posts" value={s.roles.map(basePost).filter((r, i, a) => a.indexOf(r) === i).slice(0, 3).join(", ") || "—"} hint={s.group ? "group function, every entity" : s.entities.join(", ") || "no entity yet"} />}
      </div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th className="entcol" style={{ width: 70 }}>Entity</th><th style={{ width: 160 }}>What</th><th style={{ width: 110 }}>Due</th><th>Item</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="entcol"><span className={"ent " + t.entity}>{t.entity}</span></td>
                <td><span className={"kind " + (KIND[t.kind]?.[1] ?? "")}>{KIND[t.kind]?.[0] ?? t.kind.replace(/_/g, " ")}</span>{isTest(t) && <span className="pill ml-1" title={TEST_PILL_TITLE}>test</span>}</td>
                <td className={"due" + (t.due && t.due < today ? " red" : "")}>{t.due ?? ""}{t.due && t.due < today && <small> late</small>}</td>
                <td>
                  {t.ctx && <div className="ctx">{t.kind === "project" ? "Project: " : ""}{t.ctxLink ? <Link href={t.ctxLink}>{t.ctx}</Link> : t.ctx}</div>}
                  {t.link ? <Link href={t.link} className="underline"><b>{t.title}</b></Link> : <b>{t.title}</b>}{t.detail && <div className="mini">{t.detail}</div>}
                </td>
              </tr>
            ))}
            {!tasks.length && (
              <tr><td colSpan={4} className="p-6 text-slate6">
                {s.person ? (elseTotal ? `Nothing to do in ${ENT[s.entity]?.name ?? s.entity}. ${elseTotal} line${elseTotal === 1 ? "" : "s"} wait${elseTotal === 1 ? "s" : ""} in ${elseText}.` : "Nothing to do.") : "Your account is not yet attached to a person in S.A.M. Ask the CMM to add you."}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
