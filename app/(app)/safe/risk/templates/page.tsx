import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { RiskTabs } from "@/components/RiskTabs";
import { toMatchCount } from "@/lib/risk-count";
import { KINDS, mayEditRisk, riskLabel, schemeOf, tolerability, tolTone } from "@/lib/risk";
import type { Template } from "@/lib/risk-start";
import { proposeTemplates, setTemplateStatus, updateTemplate } from "../start-actions";

export const maxDuration = 300;
const ST: Record<string, [string, string]> = { proposed: ["Proposed by SAM", "amber"], active: ["Active", "green"], retired: ["Retired", ""] };

/** Safety › risk templates: starting points for a new RA / MOC (hazards, ratings, mitigations, questions to ask). Built from a signed study or proposed by SAM from the history. */
export default async function Templates({ searchParams }: { searchParams: Promise<{ st?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { st } = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const [{ data }, toMatch] = await Promise.all([db.from("risk_templates").select("*").or(`entity.in.(${scope.join(",")}),entity.is.null`).order("status").order("uses", { ascending: false }), toMatchCount(scope)]);
  const all = (data ?? []) as Template[]; const rows = all.filter((t) => (st === "retired" ? t.status === "retired" : t.status !== "retired"));
  const edit = mayEditRisk(s);
  return (
    <>
      <PageHeader eyebrow="Safety · Risk management" title="Templates" sub="Starting points for a new risk assessment or MOC: hazards, ratings, mitigations and the questions SAM asks to adapt them. Built from a signed study (“Save as a template”) or proposed by SAM from your history." />
      <RiskTabs on="tpl" toMatch={toMatch} />
      {edit && <div className="flex gap-2 mb-4 flex-wrap">{scope.flatMap((e) => (["ra", "moc"] as const).map((k) => <form key={e + k} action={proposeTemplates}><input type="hidden" name="entity" value={e} /><input type="hidden" name="kind" value={k} /><button className="btn">🤝 Propose {k === "ra" ? "RA" : "MOC"} templates from the {e} history</button></form>))}</div>}
      {rows.map((t) => { const sc = schemeOf(t.entity ?? scope[0]); return (
        <details key={t.id} className="card mb-3">
          <summary className="ch cursor-pointer"><span className="flex gap-2 items-center"><span className={"pill " + (ST[t.status]?.[1] ?? "")}>{ST[t.status]?.[0]}</span><b>{t.name}</b><span className="mini">{KINDS[t.kind]} · {t.entity ?? "group"}{t.category ? ` · ${t.category}` : ""} · {t.hazards.length} hazards · {t.questions.length} questions · used {t.uses}×</span></span></summary>
          <div className="cb grid gap-3">
            {t.description && <p className="mini">{t.description}</p>}
            {t.source_ids.length > 0 && <p className="mini">From: {t.source_ids.map((id, i) => <Link key={id} className="underline mr-2" href={`/safe/risk/a/${id}`}>study {i + 1}</Link>)}</p>}
            <table className="tbl"><tbody>{t.hazards.map((h, i) => { const a = tolerability(h.lik_before ?? null, h.sev_before ?? null, sc), b = tolerability(h.lik_after ?? null, h.sev_after ?? null, sc); return (
              <tr key={i}><td><b>{h.title}</b>{h.consequence && <div className="mini">→ {h.consequence}</div>}<div className="mini">{(h.existing ?? []).length} current · {(h.mitigations ?? []).length} planned{h.log_hazard_id ? " · linked to the hazard log" : ""}</div></td>
                <td style={{ width: 170 }}>{a ? <span className={"pill " + tolTone(a)}>{riskLabel(h.lik_before ?? null, h.sev_before ?? null, sc)}</span> : "—"} → {b ? <span className={"pill " + tolTone(b)}>{riskLabel(h.lik_after ?? null, h.sev_after ?? null, sc)}</span> : "—"}</td></tr>); })}</tbody></table>
            {edit && <form action={updateTemplate} className="grid gap-2"><input type="hidden" name="id" value={t.id} />
              <div className="grid grid-cols-2 gap-2"><label><span className="mini">Name</span><input name="name" className="inp" defaultValue={t.name} /></label><label><span className="mini">Category</span><input name="category" className="inp" defaultValue={t.category ?? ""} /></label></div>
              <label><span className="mini">Questions to ask next time — one per line (SAM adds what the case needs)</span><textarea name="questions" className="inp" rows={4} defaultValue={t.questions.map((q) => q.label).join("\n")} /></label>
              <div className="flex gap-2"><button className="btn">Save</button></div></form>}
            {edit && <div className="flex gap-2">
              {t.status === "proposed" && <form action={setTemplateStatus}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="active" /><button className="btn primary">Accept this template</button></form>}
              {t.status === "proposed" && <form action={setTemplateStatus}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="delete" /><button className="btn">Delete</button></form>}
              {t.status === "active" && <form action={setTemplateStatus}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="retired" /><button className="btn">Retire</button></form>}
              {t.status === "retired" && <form action={setTemplateStatus}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="active" /><button className="btn">Reactivate</button></form>}
            </div>}
          </div>
        </details>); })}
      {!rows.length && <section className="card"><p className="p-6 text-slate6">No template yet — ask SAM to propose some from the history, or open a signed study and “Save as a template”.</p></section>}
      <p className="mini mt-3"><Link className="underline" href={st === "retired" ? "/safe/risk/templates" : "/safe/risk/templates?st=retired"}>{st === "retired" ? "Back to templates" : "Retired templates"}</Link></p>
    </>
  );
}
