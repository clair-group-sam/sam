"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* DUE-01 · the deadlines calendar: one lane per entity (or per post), one dot per dated commitment, a vertical line for today.
 * Red = past, amber = within 15 days, green = later; a hollow dot = the authority's turn. Hover or focus shows what and who; click opens. */
export type TimelineItem = { key: string; lane: string; date: string; days: number; state: "late" | "soon" | "later"; ref: string; title: string; todo: string; who: string | null; ball: "us" | "authority" | null; kind: string; href: string };
const COLOR = { late: "var(--state-red)", soon: "var(--amber)", later: "var(--green)" } as const;
const ms = (d: string) => new Date(d + "T00:00:00Z").getTime();
const fmt = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const fmtY = (d: string) => fmt(d) + "/" + d.slice(0, 4);

export default function DeadlineTimeline({ items, lanes, today, from, to, laneLabels }: { items: TimelineItem[]; lanes: string[]; today: string; from: string; to: string; laneLabels?: Record<string, string> }) {
  const box = useRef<HTMLDivElement>(null); const router = useRouter();
  const [w, setW] = useState(900); const [tip, setTip] = useState<{ it: TimelineItem; x: number; y: number } | null>(null);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth || 900)); ro.observe(el); setW(el.clientWidth || 900); return () => ro.disconnect(); }, []);
  const m = { t: 26, r: 18, b: 30, l: 96 };
  const x0 = ms(from), x1 = ms(to); const X = (d: string) => m.l + ((ms(d) - x0) / Math.max(1, x1 - x0)) * (w - m.l - m.r);
  // stack the dots of a lane that would overlap (same lane, closer than 13 px)
  const placed = useMemo(() => { const out: (TimelineItem & { cx: number; row: number })[] = []; const byLane = new Map<string, number[][]>();
    for (const it of [...items].sort((a, b) => a.date.localeCompare(b.date))) { const cx = X(it.date); const rows = byLane.get(it.lane) ?? []; let r = 0; while (rows[r]?.some((px) => Math.abs(px - cx) < 13)) r++; (rows[r] ??= []).push(cx); byLane.set(it.lane, rows); out.push({ ...it, cx, row: r }); }
    return { out, depth: new Map([...byLane].map(([k, v]) => [k, v.length])) }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, w, from, to]);
  const laneH = (l: string) => Math.max(34, (placed.depth.get(l) ?? 1) * 14 + 16);
  const tops = new Map<string, number>(); let y = m.t; for (const l of lanes) { tops.set(l, y); y += laneH(l); } const H = y + m.b;
  const months: string[] = []; { const d = new Date(from + "T00:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (d.getTime() <= x1) { months.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + 1); } }
  const step = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor((w - m.l) / 70))));
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Deadlines from ${fmtY(from)} to ${fmtY(to)}: ${items.length} items, ${items.filter((i) => i.state === "late").length} past`}>
        <rect x={m.l} y={m.t} width={Math.max(0, X(today) - m.l)} height={H - m.t - m.b} fill="var(--terra-s)" opacity={0.45} />
        {months.map((d, i) => <g key={d}><line x1={X(d)} x2={X(d)} y1={m.t} y2={H - m.b} stroke="var(--line)" />{i % step === 0 && <text x={X(d) + 3} y={H - m.b + 16} fontSize={12} fill="var(--slate6)">{new Date(d).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}{d.slice(5, 7) === "01" ? ` ${d.slice(0, 4)}` : ""}</text>}</g>)}
        {lanes.map((l) => <g key={l}><line x1={m.l} x2={w - m.r} y1={tops.get(l)! + laneH(l)} y2={tops.get(l)! + laneH(l)} stroke="var(--line)" /><text x={8} y={tops.get(l)! + laneH(l) / 2 + 4} fontSize={13} fontWeight={600} fill="var(--navy)">{laneLabels?.[l] ?? l}</text></g>)}
        <line x1={X(today)} x2={X(today)} y1={m.t - 8} y2={H - m.b} stroke="var(--navy)" strokeDasharray="4 3" />
        <text x={X(today) + 4} y={m.t - 10} fontSize={12} fontWeight={600} fill="var(--navy)">today, {fmt(today)}</text>
        {placed.out.map((it) => { const cy = tops.get(it.lane)! + 15 + it.row * 14; const hollow = it.ball === "authority";
          return <circle key={it.key} cx={it.cx} cy={cy} r={5.5} fill={hollow ? "var(--white)" : COLOR[it.state]} stroke={COLOR[it.state]} strokeWidth={hollow ? 2.5 : 1} tabIndex={0} role="link" aria-label={`${it.ref} ${it.title}, due ${fmtY(it.date)}`} style={{ cursor: "pointer", outline: "none" }}
            onPointerEnter={() => setTip({ it, x: it.cx, y: cy })} onPointerLeave={() => setTip(null)} onFocus={() => setTip({ it, x: it.cx, y: cy })} onBlur={() => setTip(null)}
            onClick={() => router.push(it.href)} onKeyDown={(e) => { if (e.key === "Enter") router.push(it.href); }} />; })}
      </svg>
      {tip && <div role="tooltip" style={{ position: "absolute", left: Math.min(Math.max(0, tip.x + 10), Math.max(0, w - 300)), top: tip.y + 12, width: 290, zIndex: 5, pointerEvents: "none", background: "var(--white)", border: "1px solid var(--line2)", borderRadius: "var(--r)", boxShadow: "var(--sh)", padding: "8px 10px", fontSize: 13 }}>
        <div><b>{tip.it.ref}</b> <span className="mini">{tip.it.kind}</span></div>
        <div>{tip.it.title.slice(0, 120)}</div>
        <div className="mini">Due {fmtY(tip.it.date)}, {tip.it.days < 0 ? `${-tip.it.days} days past` : tip.it.days === 0 ? "today" : `in ${tip.it.days} days`}{tip.it.ball === "authority" ? ", the authority's turn" : ""}</div>
        <div className="mini">{tip.it.todo}{tip.it.who ? `, ${tip.it.who}` : ""}</div>
      </div>}
      <div className="mini" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
        {([["late", "Past"], ["soon", "Within 15 days"], ["later", "Later"]] as const).map(([k, l]) => <span key={k}><svg width="12" height="12" style={{ verticalAlign: -1, marginRight: 5 }}><circle cx="6" cy="6" r="5" fill={COLOR[k]} /></svg>{l}</span>)}
        <span><svg width="12" height="12" style={{ verticalAlign: -1, marginRight: 5 }}><circle cx="6" cy="6" r="4" fill="var(--white)" stroke="var(--slate6)" strokeWidth="2" /></svg>The authority&apos;s turn</span>
      </div>
    </div>
  );
}
