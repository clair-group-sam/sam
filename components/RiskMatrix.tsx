import { LIKELIHOODS, SEVERITIES, riskIndex, tolerability, tolTone } from "@/lib/risk-shared";
import { setRating } from "@/app/(app)/safe/risk/actions";

/** ICAO 5×5 matrix; each cell is a button that sets the rating (initial or residual). Read-only when `editable` is false. */
export function RiskMatrix({ id, which, lik, sev, editable }: { id: string; which: "before" | "after"; lik: number | null; sev: string | null; editable: boolean }) {
  return (
    <table className="rmx">
      <thead><tr><th />{SEVERITIES.map((s) => <th key={s.id} title={s.hint}>{s.id}<span>{s.label}</span></th>)}</tr></thead>
      <tbody>{LIKELIHOODS.map((l) => (
        <tr key={l.id}><th title={l.hint}>{l.id}<span>{l.label}</span></th>
          {SEVERITIES.map((s) => { const t = tolerability(l.id, s.id); const on = lik === l.id && sev === s.id; return (
            <td key={s.id} className={tolTone(t)}>
              {editable ? <form action={setRating}><input type="hidden" name="id" value={id} /><input type="hidden" name="which" value={which} /><input type="hidden" name="lik" value={l.id} /><input type="hidden" name="sev" value={s.id} /><button className={on ? "on" : ""} title={`${riskIndex(l.id, s.id)} · ${t}`}>{riskIndex(l.id, s.id)}</button></form>
                : <span className={"cell" + (on ? " on" : "")}>{riskIndex(l.id, s.id)}</span>}
            </td>); })}
        </tr>))}</tbody>
    </table>
  );
}

export function RiskPill({ lik, sev, prefix }: { lik: number | null; sev: string | null; prefix?: string }) {
  const t = tolerability(lik, sev);
  return t ? <span className={"pill " + tolTone(t)} title={t}>{prefix ? prefix + " " : ""}{riskIndex(lik, sev)}</span> : <span className="mini">{prefix ? prefix + " " : ""}—</span>;
}
