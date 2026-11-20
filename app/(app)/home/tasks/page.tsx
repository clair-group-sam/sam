import { fr } from "@/lib/dates";
import { EntityTiles } from "@/components/GroupTiles";
import { frText } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { PageHeader, Metric } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { supabaseAdmin } from "@/lib/supabase-admin";
import DueBand, { dueWindow } from "@/components/DueBand";
import { KIND, myInbox, groupProjects, regroup, parisParts, type InboxLine } from "@/lib/inbox";
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
  const { day: today, hour } = parisParts();
  // FB-024 · test objects are labelled and left out of the counters
  const isTest = (t: { title: string; ctx?: string }) => isTestData(t.title, t.ctx);
  const real = all.filter((t) => !isTest(t));
  const late = real.filter((t) => t.due && t.due < today).length;
  const testCount = all.length - real.length;
  // projects: one line each (title, tasks waiting for me, late, next) — the detail is on the project page
  // then one line per subject: a project with the CAA applications it opened, an object with its tasks, a kind from 3 lines
  const flat = groupProjects(all, today);
  const fileIds = flat.map((t) => /^\/proj\/auth\/([^/?#]+)/.exec(t.link ?? "")?.[1]).filter((x): x is string => !!x);
  const fileProject = new Map<string, { id: string; title: string }>();
  if (fileIds.length) {
    const adb = supabaseAdmin();
    const { data: pt } = await adb.from("project_tasks").select("project_id,link_id").eq("link_kind", "authority_file").in("link_id", fileIds);
    const links = (pt ?? []) as { project_id: string; link_id: string }[];
    const { data: pj } = links.length ? await adb.from("projects").select("id,title").in("id", [...new Set(links.map((l) => l.project_id))]).eq("status", "open") : { data: [] };
    const titles = new Map(((pj ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
    for (const l of links) if (titles.has(l.project_id)) fileProject.set(l.link_id, { id: l.project_id, title: titles.get(l.project_id)! });
  }
  const tasks: InboxLine[] = [...regroup(flat.filter((t) => !isTest(t)), today, fileProject), ...flat.filter((t) => isTest(t))];
  // the list in groups, the most pressing first: late, the next 7 days, later, without a date; test objects apart
  const in7 = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  const realT = tasks.filter((t) => !isTest(t));
  const byEnt = (ts: typeof tasks) => { const m = new Map<string, number>(); for (const t of ts) m.set(t.entity, (m.get(t.entity) ?? 0) + 1); return s.entity === "ALL" && m.size > 1 ? [...m.entries()].map(([e, n]) => `${e} ${n}`).join(", ") : ""; };
  const mk = (key: string, label: string, tone: string, open: boolean, items: typeof tasks) => ({ key, label, tone, open, items, hint: byEnt(items) });
  const buckets = [
    mk("late", "Late", "red", true, realT.filter((t) => t.due && t.due < today)),
    mk("week", "Today and the next 7 days", "amber", true, realT.filter((t) => t.due && t.due >= today && t.due <= in7)),
    mk("later", "Later", "", realT.length <= 25, realT.filter((t) => t.due && t.due > in7)),
    mk("nodate", "Without a date", "", realT.length <= 25, realT.filter((t) => !t.due)),
    mk("test", "Test objects", "", false, tasks.filter((t) => isTest(t))),
  ].filter((b) => b.items.length);
  const first = s.name.split(" ")[0];
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // deadlines of the selected entity (all the entities of the scope in Group), same band as CODIR / SRB
  const dueEnts = s.entity === "ALL" ? ENTS4.filter((e) => s.group || s.entities.includes(e)) : [s.entity];
  const due = ["cmm", "am", "np"].includes(s.role) && dueEnts.length ? await dueWindow(supabaseAdmin(), dueEnts) : null;
  return (
    <>
      <PageHeader eyebrow="S.A.M., Inbox" title={`${greet} ${first}`} sub="Everything that needs you, in one list." />
      {/* Group view: where each entity stands, before the list; a click opens the Inbox of that entity */}
      {s.entity === "ALL" && dueEnts.length > 1 && ["cmm", "am"].includes(s.role) && <EntityTiles db={supabaseAdmin()} ents={dueEnts} />}
      {due && <DueBand dues={due.dues} win={due.win} lanes={dueEnts} />}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Open tasks" value={real.length} hint={(s.entity === "ALL" ? "all entities" : ENT[s.entity]?.name) + (testCount ? `, + ${testCount} test` : "") + (tasks.length !== all.length ? `, ${tasks.length} lines (grouped by subject)` : "")} />
        <Metric label="Overdue tasks" value={late} tone={late ? "red" : "green"} hint={late ? "past due date" : "nothing late"} />
        {s.entity !== "ALL" && (s.group || s.entities.length > 1) ? <Metric label="In your other entities" value={elseTotal} tone={elseTotal ? "amber" : "green"} hint={elseTotal ? `${elseText}; switch entity at the top, or Group to see all` : "nothing waiting elsewhere"} /> : <Metric label="Your posts" value={s.roles.map(basePost).filter((r, i, a) => a.indexOf(r) === i).slice(0, 3).join(", ") || "—"} hint={s.group ? "group function, every entity" : s.entities.join(", ") || "no entity yet"} />}
      </div>
      {buckets.map((b) => (
        <details key={b.key} className="card mb-3" open={b.open}>
          <summary className="ch" style={{ cursor: "pointer" }}><span className="eyebrow">{b.label}</span><span className={"pill " + b.tone}>{b.items.length}</span>{b.hint && <span className="mini">{b.hint}</span>}</summary>
          <table className="tbl">
            <thead><tr><th className="entcol" style={{ width: 70 }}>Entity</th><th style={{ width: 160 }}>What</th><th style={{ width: 110 }}>Due</th><th>Item</th></tr></thead>
            <tbody>
              {b.items.map((t) => (
                <tr key={t.id}>
                  <td className="entcol"><span className={"ent " + t.entity}>{t.entity}</span></td>
                  <td><span className={"kind " + (KIND[t.kind]?.[1] ?? "")}>{KIND[t.kind]?.[0] ?? t.kind.replace(/_/g, " ")}</span>{isTest(t) && <span className="pill ml-1" title={TEST_PILL_TITLE}>test</span>}</td>
                  <td className={"due" + (t.due && t.due < today ? " red" : "")}>{t.due ? fr(t.due) : ""}{t.due && t.due < today && <small> late</small>}</td>
                  <td>
                    {t.ctx && <div className="ctx">{t.kind === "project" ? "Project: " : ""}{t.ctxLink ? <Link href={t.ctxLink}>{t.ctx}</Link> : t.ctx}</div>}
                    {t.link ? <Link href={t.link} className="underline"><b>{frText(t.title)}</b></Link> : <b>{frText(t.title)}</b>}{t.detail && <div className="mini">{frText(t.detail)}</div>}
                    {t.children && (
                      <details className="mt-1"><summary className="mini underline" style={{ cursor: "pointer" }}>Show the {t.children.length} lines</summary>
                        <table className="tbl mt-1"><tbody>{t.children.map((c) => (
                          <tr key={c.id}><td style={{ width: 150 }}><span className={"kind " + (KIND[c.kind]?.[1] ?? "")}>{KIND[c.kind]?.[0] ?? c.kind.replace(/_/g, " ")}</span></td>
                            <td className={"due" + (c.due && c.due < today ? " red" : "")} style={{ width: 100 }}>{c.due ? fr(c.due) : ""}</td>
                            <td>{c.link ? <Link href={c.link} className="underline">{frText(c.title)}</Link> : frText(c.title)}{c.detail && <div className="mini">{frText(c.detail)}</div>}</td></tr>))}</tbody></table>
                      </details>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      {!tasks.length && (
        <section className="card"><div className="p-6 text-slate6">
          {s.person ? (elseTotal ? `Nothing to do in ${ENT[s.entity]?.name ?? s.entity}. ${elseTotal} line${elseTotal === 1 ? "" : "s"} wait${elseTotal === 1 ? "s" : ""} in ${elseText}.` : "Nothing to do.") : "Your account is not yet attached to a person in S.A.M. Ask the CMM to add you."}
        </div></section>
      )}
    </>
  );
}
