export function PageHeader({ eyebrow, title, sub, right, tag, stacked }: { eyebrow?: string; title: string; sub?: string; right?: React.ReactNode; tag?: React.ReactNode; stacked?: boolean }) {
  // stacked: the actions sit under the title (long titles, many actions) instead of beside it
  return (
    <div className={"pagehead flex items-start gap-4 mb-5" + (stacked ? " stacked" : "")}>
      <div className="flex-1 min-w-0" style={{ minWidth: 280 }}>
        {/* DA v3 (06/11): no small line above the title; the menu already says where you are. `eyebrow` is kept for the tab title only. */}
        <h1 className="text-[28px] leading-tight font-bold tracking-tight" data-section={eyebrow}>{title}</h1>
        {tag && <div className="mt-1.5">{tag}</div>}
        {sub && <p className="text-slate6 mt-1">{sub}</p>}
      </div>
      {right && <div className="ph-right flex gap-2 shrink-0 flex-wrap justify-end">{right}</div>}
    </div>
  );
}
// DA v3 (06/11): every figure card carries a 3 px state rule on top. red = late, amber = to watch, green = nothing pending,
// cyan-ink = information (default), pale = empty (a zero without a tone).
export function Metric({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "amber" | "red" | "green" | "info" | "none" }) {
  const t = tone ?? (value === 0 || value === "0" ? "none" : undefined);
  return (
    <div className={"metric" + (t ? " " + t : "")}>
      <div className="eyebrow">{label}</div>
      <div className="val">{value}</div>
      {hint && <div className="mini">{hint}</div>}
    </div>
  );
}
