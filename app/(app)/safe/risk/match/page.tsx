import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { KINDS, mayEditRisk, riskLabel, schemeOf, tolerability, tolTone } from "@/lib/risk";
import { RiskTabs } from "@/components/RiskTabs";
import type { Suggestion } from "@/lib/risk-match";
import { checkDuplicates, dismissMatch, keepLocal, linkToLog, promoteToLog, suggestMatches } from "../actions";

export const maxDuration = 300;
type H = { id: string; ref: string; title: string; consequence: string | null; entity: string; lik_after: number | null; sev_after: string | null; risk_assessments: { id: string; kind: string; number: string; name: string; status: string } };
type M = { subject_id: string; suggestions: Suggestion[]; ran_at: string };

/** Safety › Hazard log › to match: each hazard written in a MOC / RA is either the same as a hazard of the log (link: its acceptance then triggers
 *  the log reassessment), a new lasting hazard (add to the log), or temporary (keep local). SAM suggests; the safety desk decides. Also: possible duplicates in the log. */
export default async function MatchPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const db = supabaseAdmin();
  const { data } = await db.from("hazards").select("id,ref,title,consequence,entity,lik_after,sev_after,risk_assessments!inner(id,kind,number,name,status)").in("entity", scope).eq("proposed", false).eq("local_only", false).is("log_hazard_id", null).neq("status", "closed").in("risk_assessments.kind", ["moc", "ra"]).not("risk_assessments.status", "in", "(archived,cancelled)").order("created_at", { ascending: false });
  const hs = (data ?? []) as unknown as H[];
  const [{ data: mm }, { data: dd }] = await Promise.all([
    hs.length ? db.from("risk_matches").select("subject_id,suggestions,ran_at").eq("subject_kind", "hazard").in("subject_id", hs.map((h) => h.id)) : Promise.resolve({ data: [] }),
    db.from("risk_matches").select("subject_id,suggestions,ran_at").eq("subject_kind", "duplicate").in("entity", scope),
  ]);
  const sug = new Map(((mm ?? []) as M[]).map((m) => [m.subject_id, m]));
  const dups = ((dd ?? []) as M[]).filter((d) => d.suggestions.length);
  const { data: dh } = dups.length ? await db.from("hazards").select("id,ref,title").in("id", dups.map((d) => d.subject_id)) : { data: [] };
  const dName = new Map(((dh ?? []) as { id: string; ref: string; title: string }[]).map((h) => [h.id, h]));
  const pending = hs.filter((h) => !sug.has(h.id)).length;
  const edit = mayEditRisk(s);
  const seen = new Set<string>();
  return (
    <>
      <PageHeader eyebrow="Safety · Risk management" title="To match with the hazard log" sub="Hazards of the MOCs and risk assessments: same as a hazard of the log → link · new lasting hazard → add to the log · temporary → keep local. SAM suggests, you decide." />
      <RiskTabs on="match" toMatch={hs.length} />
      {edit && (
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <form action={suggestMatches}><button className="btn primary" disabled={!pending}>🤝 Ask SAM to suggest matches{pending ? ` (${pending} not checked)` : ""}</button></form>
          <form action={suggestMatches}><input type="hidden" name="force" value="1" /><button className="btn" disabled={!hs.length}>Check them all again</button></form>
          <form action={checkDuplicates} className="ml-auto"><button className="btn">🤝 Look for duplicates in the log</button></form>
        </div>
      )}
      <section className="card mb-5">
        <table className="tbl">
          <thead><tr><th style={{ width: 120 }}>Study</th><th>Hazard of the study</th><th style={{ width: 90 }}>Residual</th><th style={{ width: "40%" }}>In the hazard log?</th></tr></thead>
          <tbody>
            {hs.map((h) => { const m = sug.get(h.id); const sc = schemeOf(h.entity); const t = tolerability(h.lik_after, h.sev_after, sc); return (
              <tr key={h.id}>
                <td className="mono"><Link className="underline" href={`/safe/risk/a/${h.risk_assessments.id}`}>{h.risk_assessments.number}</Link><div className="mini">{KINDS[h.risk_assessments.kind]}</div></td>
                <td><Link href={`/safe/risk/${h.id}`}><b>{h.title}</b></Link>{h.consequence && <div className="mini">→ {h.consequence}</div>}<div className="mini">{h.risk_assessments.name}</div></td>
                <td>{t ? <span className={"pill " + tolTone(t)}>{riskLabel(h.lik_after, h.sev_after, sc)}</span> : <span className="mini">—</span>}</td>
                <td>
                  {!m && <p className="mini">Not checked by SAM yet.</p>}
                  {m && !m.suggestions.length && <p className="mini">SAM found no matching hazard in the log.</p>}
                  {m?.suggestions.map((x) => (
                    <div key={x.id} className="flex gap-2 items-center mb-1">
                      <span className="flex-1"><Link className="underline mono" href={`/safe/risk/${x.id}`}>{x.ref}</Link> {x.title} <span className={"pill " + (x.score >= 0.8 ? "green" : "amber")}>{Math.round(x.score * 100)}%</span>{x.why && <div className="mini">{x.why}</div>}</span>
                      {edit && <><form action={linkToLog}><input type="hidden" name="id" value={h.id} /><input type="hidden" name="log_id" value={x.id} /><button className="btn">Link</button></form>
                        <form action={dismissMatch}><input type="hidden" name="kind" value="hazard" /><input type="hidden" name="subject" value={h.id} /><input type="hidden" name="other" value={x.id} /><button className="btn" title="Not the same hazard">✕</button></form></>}
                    </div>))}
                  {edit && <div className="flex gap-2 mt-1"><form action={promoteToLog}><input type="hidden" name="id" value={h.id} /><button className="btn">+ Add to the log</button></form><form action={keepLocal}><input type="hidden" name="id" value={h.id} /><button className="btn">Keep local (temporary)</button></form></div>}
                </td>
              </tr>); })}
            {!hs.length && <tr><td colSpan={4} className="p-6 text-slate6">Every hazard of the MOCs and risk assessments is linked to the log or kept local.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="ch"><span className="eyebrow">Possible duplicates in the hazard log</span><span className="mini">merge by closing one and linking its reports — SAM only suggests</span></div>
        <table className="tbl"><tbody>
          {dups.flatMap((d) => d.suggestions.filter((x) => { const k = [d.subject_id, x.id].sort().join(); if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => { const a = dName.get(d.subject_id); return (
            <tr key={d.subject_id + x.id}>
              <td><Link className="underline mono" href={`/safe/risk/${d.subject_id}`}>{a?.ref}</Link> {a?.title}</td>
              <td style={{ width: 40 }} className="mini">≈</td>
              <td><Link className="underline mono" href={`/safe/risk/${x.id}`}>{x.ref}</Link> {x.title}{x.why && <div className="mini">{x.why}</div>}</td>
              <td style={{ width: 70 }}><span className={"pill " + (x.score >= 0.8 ? "green" : "amber")}>{Math.round(x.score * 100)}%</span></td>
              <td style={{ width: 130 }}>{edit && <form action={dismissMatch}><input type="hidden" name="kind" value="duplicate" /><input type="hidden" name="subject" value={d.subject_id} /><input type="hidden" name="other" value={x.id} /><button className="btn">Not a duplicate</button></form>}</td>
            </tr>); }))}
          {!dups.length && <tr><td className="p-4 mini">No duplicate flagged{edit ? " — run the check after an import" : ""}.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
