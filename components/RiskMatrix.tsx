import { LIKELIHOODS, SEVERITIES, riskIndex, riskLabel, schemeOf, tolerability, tolTone } from "@/lib/risk-shared";
import { setRating } from "@/app/(app)/safe/risk/actions";

/** 5×5 matrix of the entity's MSM; each cell sets the rating (pre or post mitigation). Read-only when `editable` is false. */
export function RiskMatrix({ id, entity, which, lik, sev, editable }: { id: string; entity: string; which: "before" | "after"; lik: number | null; sev: string | null; editable: boolean }) {
  const sch = schemeOf(entity);
  return (
    <table className="rmx">
      <thead><tr><th />{SEVERITIES.map((s) => <th key={s.id} title={s.hint}>{s.id}<span>{s.label}</span></th>)}</tr></thead>
      <tbody>{LIKELIHOODS.map((l) => (
        <tr key={l.id}><th title={l.hint}>{l.id}<span>{l.label}</span></th>
          {SEVERITIES.map((s) => { const t = tolerability(l.id, s.id, sch); const on = lik === l.id && sev === s.id; const txt = sch === "centrik" ? String(riskLabel(l.id, s.id, sch)?.split(" · ")[1]) : riskIndex(l.id, s.id); return (
            <td key={s.id} className={tolTone(t)}>
              {editable ? <form action={setRating}><input type="hidden" name="id" value={id} /><input type="hidden" name="which" value={which} /><input type="hidden" name="lik" value={l.id} /><input type="hidden" name="sev" value={s.id} /><button className={on ? "on" : ""} title={`${riskLabel(l.id, s.id, sch)} · ${t}`}>{txt}</button></form>
                : <span className={"cell" + (on ? " on" : "")} title={`${riskLabel(l.id, s.id, sch)} · ${t}`}>{txt}</span>}
            </td>); })}
        </tr>))}</tbody>
    </table>
  );
}

export function RiskPill({ lik, sev, entity, prefix }: { lik: number | null; sev: string | null; entity: string; prefix?: string }) {
  const sch = schemeOf(entity); const t = tolerability(lik, sev, sch);
  return t ? <span className={"pill " + tolTone(t)} title={t}>{prefix ? prefix + " " : ""}{riskLabel(lik, sev, sch)}</span> : <span className="mini">{prefix ? prefix + " " : ""}—</span>;
}
