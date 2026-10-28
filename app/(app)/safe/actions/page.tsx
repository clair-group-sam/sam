import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import NewActionForm from "@/components/NewActionForm";
import { ACTION_KINDS, ACTION_SOURCES, ACTION_STATUS, isLate, isOwner, mayManageActions, type Action } from "@/lib/actions";

type Sp = { st?: string; src?: string; mine?: string; q?: string };
const qs = (sp: Sp, p: Partial<Sp>) => { const o = { ...sp, ...p }; const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const t = u.toString(); return `/safe/actions${t ? "?" + t : ""}`; };

/** Safety › Actions: corrective / preventive actions raised from reports, hazards, assessments and committees — owner, due date, evidence, verification by the safety desk, effectiveness. */
export default async function Actions({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const { data } = await db.from("safety_actions").select("*").in("entity", scope).eq("module", "safety").order("created_at", { ascending: false }).limit(1000);
  const all = (data ?? []) as Action[];
  const ids = [...new Set(all.map((a) => a.owner_person).filter(Boolean) as string[])];
  const { data: ppl } = ids.length ? await db.from("people").select("id,display_name").in("id", ids) : { data: [] };
  const nameOf = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const today = new Date().toISOString().slice(0, 10);
  const effDue = (a: Action) => a.status === "verified" && !a.effectiveness && !!a.effectiveness_due && a.effectiveness_due <= today;
  const open = all.filter((a) => ["open", "in_progress"].includes(a.status));
  let rows = all;
  if (sp.st === "open") rows = open; else if (sp.st === "late") rows = open.filter((a) => isLate(a, today)); else if (sp.st === "verify") rows = all.filter((a) => a.status === "done"); else if (sp.st === "eff") rows = all.filter(effDue); else if (sp.st === "closed") rows = all.filter((a) => ["verified", "cancelled"].includes(a.status));
  else rows = all.filter((a) => !["verified", "cancelled"].includes(a.status) || effDue(a));
  if (sp.src) rows = rows.filter((a) => a.source_kind === sp.src);
  if (sp.mine) rows = rows.filter((a) => isOwner(s, a));
  if (sp.q) { const q = sp.q.toLowerCase(); rows = rows.filter((a) => `${a.number} ${a.title} ${a.description ?? ""}`.toLowerCase().includes(q)); }
  const tab = (k: string, l: string, n: number, tone?: string) => <Link key={k} href={qs(sp, { st: k || undefined })} className={"btn" + ((sp.st ?? "") === k ? " on" : "")}>{l} <span className={"pill " + (n ? tone ?? "" : "")}>{n}</span></Link>;
  const edit = mayManageActions(s);
  return (
    <>
      <PageHeader eyebrow="Safety · Safety assurance" title="Actions" sub="Corrective and preventive actions — raised from reports, hazards, assessments and committees; done by their owner with evidence, verified by the safety desk, checked for effectiveness." />
      <div className="grid grid-cols-5 gap-4 mb-5">
        <Metric label="Open" value={open.length} />
        <Metric label="Overdue" value={open.filter((a) => isLate(a, today)).length} tone={open.some((a) => isLate(a, today)) ? "red" : undefined} />
        <Metric label="Done — to verify" value={all.filter((a) => a.status === "done").length} tone={all.some((a) => a.status === "done") ? "amber" : undefined} hint="safety desk" />
        <Metric label="Effectiveness to check" value={all.filter(effDue).length} tone={all.some(effDue) ? "amber" : undefined} />
        <Metric label="Closed this year" value={all.filter((a) => a.status === "verified" && (a.verified_at ?? "").startsWith(today.slice(0, 4))).length} />
      </div>
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        {tab("", "Current", all.filter((a) => !["verified", "cancelled"].includes(a.status) || effDue(a)).length)}{tab("late", "Overdue", open.filter((a) => isLate(a, today)).length, "red")}{tab("verify", "To verify", all.filter((a) => a.status === "done").length, "amber")}{tab("eff", "Effectiveness due", all.filter(effDue).length, "amber")}{tab("closed", "Closed", all.filter((a) => ["verified", "cancelled"].includes(a.status)).length)}
        <Link href={qs(sp, { mine: sp.mine ? undefined : "1" })} className={"btn" + (sp.mine ? " on" : "")}>Mine</Link>
        <form className="ml-auto flex gap-2" action="/safe/actions">{sp.st && <input type="hidden" name="st" value={sp.st} />}
          <select name="src" defaultValue={sp.src ?? ""} className="inp" style={{ marginTop: 0, width: 190 }}><option value="">any source</option>{Object.entries(ACTION_SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input name="q" defaultValue={sp.q ?? ""} className="inp" placeholder="Search" style={{ marginTop: 0, width: 170 }} /><button className="btn">Filter</button></form>
      </div>
      <section className="card mb-5">
        <table className="tbl">
          <thead><tr><th style={{ width: 150 }}>Number</th><th>Action</th><th style={{ width: 160 }}>Owner</th><th style={{ width: 100 }}>Due</th><th style={{ width: 170 }}>Status</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="mono"><Link className="underline" href={`/safe/actions/${a.id}`}>{a.number}</Link>{scope.length > 1 && <div><span className={"ent " + a.entity}>{a.entity}</span></div>}</td>
                <td><Link href={`/safe/actions/${a.id}`}><b>{a.title}</b></Link><div className="mini">{ACTION_KINDS[a.kind]} · {ACTION_SOURCES[a.source_kind]}{a.report_id ? ` ${a.report_id}` : ""}</div></td>
                <td className="mini">{a.owner_person ? nameOf.get(a.owner_person) ?? "—" : <span className="mono">{a.owner_role ?? "—"}</span>}</td>
                <td className={"mono" + (isLate(a, today) ? " red" : "")}>{a.due ?? "—"}</td>
                <td><span className={"pill " + (ACTION_STATUS[a.status]?.[1] ?? "")}>{ACTION_STATUS[a.status]?.[0]}</span>{effDue(a) && <div className="mini">effectiveness to check</div>}{a.effectiveness && <div className="mini">{a.effectiveness === "effective" ? "✓ effective" : "✕ not effective"}</div>}</td>
              </tr>))}
            {!rows.length && <tr><td colSpan={5} className="p-6 text-slate6">No action{sp.st || sp.src || sp.q || sp.mine ? " matching the filters" : " yet — raise one from a safety report (SAM suggests some), a hazard or below"}.</td></tr>}
          </tbody>
        </table>
      </section>
      {edit && s.entity !== "ALL" && (
        <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">+ New action</span><span className="mini">not linked to a report or a hazard</span></summary>
          <div className="cb"><NewActionForm entity={s.entity} source="other" /></div></details>)}
    </>
  );
}
