import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { registersSession, scopeOf } from "../guard";

type U = { at: string; person_id: string | null; entity: string | null; agent: string; model: string; input_tokens: number; output_tokens: number; cost_eur: number; ok: boolean };
const AGENT: Record<string, string> = { draft: "Editor: draft", rewrite: "Editor: rewrite", translate: "Editor: translate", check: "Check and review", explain: "Editor: explain a rule", summary: "What changed summary", route: "Authority route", file: "Drop a document", coffee: "Morning coffee", safety: "Safety analysis", ask: "Ask this manual" };
const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/* Registers · AI agents & usage (AI-01): every call to Claude, by month, entity, agent and person, against the monthly budget. */
export default async function AiUsage() {
  const s = await registersSession();
  const db = supabaseAdmin(); const scope = scopeOf(s);
  const since = new Date(Date.now() - 92 * 86_400_000).toISOString();
  let q = db.from("ai_usage").select("at,person_id,entity,agent,model,input_tokens,output_tokens,cost_eur,ok").gte("at", since).order("at", { ascending: false }).limit(20_000);
  if (scope) q = q.in("entity", scope);
  const [{ data }, { data: bp }, { data: ppl }] = await Promise.all([q, db.from("app_params").select("value").eq("key", "ai_budget_eur").maybeSingle(), db.from("people").select("id,display_name")]);
  const rows = (data ?? []) as U[];
  const budget = Number((bp as { value: string } | null)?.value ?? 150) || 150;
  const P = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const month = new Date().toISOString().slice(0, 7);
  const cur = rows.filter((r) => r.at.slice(0, 7) === month);
  const sum = (xs: U[]) => xs.reduce((n, r) => n + Number(r.cost_eur || 0), 0);
  const group = <K extends string>(xs: U[], key: (r: U) => K) => { const m = new Map<K, U[]>(); for (const r of xs) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); } return [...m.entries()].sort((a, b) => sum(b[1]) - sum(a[1])); };
  const ents = group(cur, (r) => (r.entity ?? "group") as string);
  const months = group(rows, (r) => r.at.slice(0, 7)).sort((a, b) => b[0].localeCompare(a[0]));
  const errors = cur.filter((r) => !r.ok).length;
  const worst = ents.reduce((m, [, xs]) => Math.max(m, sum(xs) / budget), 0);
  return (
    <>
      <PageHeader eyebrow="Registers, AI agents & usage" title="AI agents & usage" sub={`One Claude account for the group (AI-01). Every call is logged with its person, entity, agent and cost. Budget: ${budget} € per entity and month, alert at 80 %.`} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="This month" value={eur(sum(cur))} hint={`${cur.length} calls`} />
        <Metric label="Highest entity vs budget" value={`${Math.round(worst * 100)} %`} tone={worst >= 1 ? "red" : worst >= 0.8 ? "amber" : "green"} />
        <Metric label="Failed calls" value={errors} tone={errors ? "amber" : "green"} hint="this month" />
        <Metric label="Last 3 months" value={eur(sum(rows))} />
      </div>
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <section className="card"><div className="ch"><span className="eyebrow">This month by entity</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
          {ents.length ? ents.map(([e, xs]) => { const pc = sum(xs) / budget; return <tr key={e}><td><b>{e}</b></td><td className="due">{eur(sum(xs))}</td><td style={{ textAlign: "right" }}><span className={"pill " + (pc >= 1 ? "red" : pc >= 0.8 ? "amber" : "green")}>{Math.round(pc * 100)} % of budget</span></td></tr>; }) : <tr><td className="mini">No call this month.</td></tr>}
        </tbody></table></div></section>
        <section className="card"><div className="ch"><span className="eyebrow">This month by agent</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
          {group(cur, (r) => r.agent).map(([a, xs]) => <tr key={a}><td>{AGENT[a] ?? a}</td><td className="mini">{xs.length} calls</td><td className="due" style={{ textAlign: "right" }}>{eur(sum(xs))}</td></tr>)}
        </tbody></table></div></section>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <section className="card"><div className="ch"><span className="eyebrow">This month by person</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
          {group(cur, (r) => r.person_id ?? "system").slice(0, 15).map(([p, xs]) => <tr key={p}><td>{P.get(p) ?? "S.A.M. (scheduled jobs)"}</td><td className="mini">{xs.length} calls</td><td className="due" style={{ textAlign: "right" }}>{eur(sum(xs))}</td></tr>)}
        </tbody></table></div></section>
        <section className="card"><div className="ch"><span className="eyebrow">By month</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>
          {months.map(([m, xs]) => <tr key={m}><td className="mono">{m}</td><td className="mini">{xs.length} calls, {Math.round(xs.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0) / 1000)}k tokens</td><td className="due" style={{ textAlign: "right" }}>{eur(sum(xs))}</td></tr>)}
        </tbody></table></div></section>
      </div>
    </>
  );
}
