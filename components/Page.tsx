export function PageHeader({ eyebrow, title, sub, right, tag }: { eyebrow?: string; title: string; sub?: string; right?: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="pagehead flex items-start gap-4 mb-5">
      <div className="flex-1 min-w-0" style={{ minWidth: 280 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-bold tracking-tight mt-1">{title}</h1>
        {tag && <div className="mt-1.5">{tag}</div>}
        {sub && <p className="text-slate6 mt-1">{sub}</p>}
      </div>
      {right && <div className="ph-right flex gap-2 shrink-0 flex-wrap justify-end">{right}</div>}
    </div>
  );
}
export function Metric({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "amber" | "red" | "green" }) {
  return (
    <div className={"metric" + (tone ? " " + tone : "")}>
      <div className="eyebrow">{label}</div>
      <div className="val">{value}</div>
      {hint && <div className="mini">{hint}</div>}
    </div>
  );
}
