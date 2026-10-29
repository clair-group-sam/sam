// Small SVG charts for safety performance (server-rendered, no library).
const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
export const monthShort = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });

/** Stacked monthly bars (e.g. reports: MOR / other) with an optional line on a second scale (e.g. rate per 1000 BH). */
export function MonthBars({ months, stacks, line, height = 170 }: { months: string[]; stacks: { label: string; values: number[]; color: string }[]; line?: { label: string; values: (number | null)[]; color: string; target?: number | null }; height?: number }) {
  const W = 760, H = height, L = 30, R = line ? 40 : 10, T = 14, B = 26;
  const tot = months.map((_, i) => stacks.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const max = Math.max(4, ...tot); const step = (W - L - R) / months.length; const bw = Math.min(26, step * 0.62);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const lmax = line ? Math.max(1, ...(line.values.filter((v) => v != null) as number[]), line.target ?? 0) * 1.15 : 1;
  const ly = (v: number) => T + (H - T - B) * (1 - v / lmax);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: Math.round(height * 1.6), display: "block" }} role="img" aria-label={stacks.map((s) => s.label).join(", ")}>{/* FB-043 · never taller than ~1.6× its design height, whatever the screen width */}
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={L - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--slate5)">{t}</text></g>)}
      {months.map((m, i) => {
        let acc = 0; const x = L + i * step + (step - bw) / 2;
        return (
          <g key={m}>
            {stacks.map((s) => { const v = s.values[i] ?? 0; const r = <rect key={s.label} x={x} width={bw} y={y(acc + v)} height={Math.max(0, y(acc) - y(acc + v))} rx="2" fill={s.color}><title>{`${monthShort(m)} ${m.slice(0, 4)} — ${s.label}: ${v}`}</title></rect>; acc += v; return r; })}
            {tot[i] > 0 && <text x={x + bw / 2} y={y(tot[i]) - 3} fontSize="9.5" textAnchor="middle" fill="var(--slate6)">{tot[i]}</text>}
            <text x={x + bw / 2} y={H - 10} fontSize="9.5" textAnchor="middle" fill="var(--slate5)">{m.endsWith("-01") ? m.slice(2, 4) + "·" + MON[0] : MON[Number(m.slice(5)) - 1]}</text>
          </g>);
      })}
      {line && <>
        {line.target != null && <line x1={L} x2={W - R} y1={ly(line.target)} y2={ly(line.target)} stroke={line.color} strokeDasharray="4 4" opacity=".6" />}
        <polyline fill="none" stroke={line.color} strokeWidth="2" points={line.values.map((v, i) => (v == null ? null : `${L + i * step + step / 2},${ly(v)}`)).filter(Boolean).join(" ")} />
        {line.values.map((v, i) => v == null ? null : <circle key={i} cx={L + i * step + step / 2} cy={ly(v)} r="2.6" fill={line.color}><title>{`${monthShort(months[i])} — ${line.label}: ${v.toFixed(1)}`}</title></circle>)}
        {/* FB-043 · the line label lives in the card legend; inside the chart it was clipped at the right edge */}
      </>}
    </svg>
  );
}

const TONE: Record<string, string> = { ok: "var(--green)", improve: "var(--amber)", far: "var(--terra)" };
/** Twelve month cells of an SPI: coloured when the month is judged against the target, grey otherwise. */
export function MonthCells({ values, verdicts, labels }: { values: (string | null)[]; verdicts: (string | null)[]; labels: string[] }) {
  return (
    <div className="spicells">
      {values.map((v, i) => {
        const t = verdicts[i]; const c = t && TONE[t];
        return <span key={i} title={`${labels[i]}: ${v ?? "no data"}`} className={"spicell" + (v == null ? " empty" : "")} style={c ? { background: c, color: "#fff", borderColor: c } : undefined}>{v ?? ""}</span>;
      })}
    </div>
  );
}

/** Line of the months of one SPI against its target (detail page). */
export function SpiLine({ months, values, target, alert, unit }: { months: string[]; values: (number | null)[]; target: number | null; alert: number | null; unit: string }) {
  const W = 760, H = 200, L = 40, R = 14, T = 14, B = 26;
  const vals = values.filter((v) => v != null) as number[];
  const max = Math.max(1, ...vals, target ?? 0, alert ?? 0) * 1.15; const step = (W - L - R) / months.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / max); const x = (i: number) => L + i * step + step / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly values against the target">
      {[0, max / 2, max].map((t, k) => <g key={k}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={L - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--slate5)">{t >= 10 ? Math.round(t) : t.toFixed(1)}</text></g>)}
      {target != null && <><line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="var(--green)" strokeDasharray="5 4" /><text x={W - R} y={y(target) - 4} fontSize="10" textAnchor="end" fill="#1d7a3a">target {target}{unit}</text></>}
      {alert != null && <><line x1={L} x2={W - R} y1={y(alert)} y2={y(alert)} stroke="var(--terra)" strokeDasharray="2 4" /><text x={W - R} y={y(alert) - 4} fontSize="10" textAnchor="end" fill="var(--terra)">alert {alert}{unit}</text></>}
      <polyline fill="none" stroke="var(--navy)" strokeWidth="2" points={values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ")} />
      {values.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--navy)"><title>{`${monthShort(months[i])}: ${v.toFixed(2)}${unit}`}</title></circle>)}
      {months.map((m, i) => <text key={m} x={x(i)} y={H - 9} fontSize="10" textAnchor="middle" fill="var(--slate5)">{monthShort(m)}</text>)}
    </svg>
  );
}
