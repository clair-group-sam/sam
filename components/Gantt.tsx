import Link from "next/link";
import { addDays, daysBetween, fr, today } from "@/lib/authority";
import type { Phase, Projection, Task } from "@/lib/projects";

/** Project timeline: one bar per task from its projected start to its projected end, grouped by phase; today, target and late in colour. */
export default function Gantt({ projectId, phases, tasks, proj, startedAt, target }: { projectId: string; phases: Phase[]; tasks: Task[]; proj: Map<string, Projection>; startedAt: string; target: string | null }) {
  const t0 = today();
  const shown = tasks.filter((t) => t.status !== "not_needed");
  if (!shown.length) return <p className="mini">No task to draw.</p>;
  let min = startedAt, max = startedAt;
  for (const t of shown) { const p = proj.get(t.id)!; if (p.start < min) min = p.start; if (p.end > max) max = p.end; }
  if (t0 < min) min = t0; if (t0 > max) max = t0; if (target && target > max) max = target;
  max = addDays(max, 3); min = addDays(min, -1);
  const span = Math.max(1, daysBetween(min, max) ?? 1);
  const x = (d: string) => `${(100 * (daysBetween(min, d) ?? 0)) / span}%`;
  const w = (a: string, b: string) => `${Math.max(0.6, (100 * Math.max(1, daysBetween(a, b) ?? 1)) / span)}%`;
  // month ticks
  const ticks: { d: string; label: string }[] = [];
  for (let d = min.slice(0, 7) + "-01"; d <= max; d = addDays(d.slice(0, 7) + "-28", 5).slice(0, 7) + "-01") if (d >= min) ticks.push({ d, label: new Date(d).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) });
  return (
    <div className="gantt">
      <div className="grow head"><div className="glabel" /><div className="gbars">{ticks.map((k) => <span key={k.d} className="gtick" style={{ left: x(k.d) }}>{k.label}</span>)}<span className="gtoday" style={{ left: x(t0) }} title={`today ${fr(t0)}`} />{target && <span className="gtarget" style={{ left: x(target) }} title={`target ${fr(target)}`} />}</div></div>
      {phases.map((ph) => {
        const pt = shown.filter((t) => t.phase_id === ph.id);
        if (!pt.length) return null;
        return (
          <div key={ph.id}>
            <div className="grow phase"><div className="glabel eyebrow">{ph.label}</div><div className="gbars" /></div>
            {pt.map((t) => { const p = proj.get(t.id)!; const cls = t.status === "done" ? "done" : p.late ? "late" : t.status === "blocked" ? "blocked" : t.status === "waiting" ? "waiting" : p.openDeps.length ? "next" : "ready"; return (
              <div key={t.id} className="grow">
                <div className="glabel" title={t.title}><Link href={`/proj/boards/${projectId}?show=all#t-${t.id}`}>{p.critical && t.status !== "done" ? "⚡ " : ""}{t.title}</Link><span className="mini">{t.owner_role ?? ""}</span></div>
                <div className="gbars"><span className="gtoday" style={{ left: x(t0) }} />{target && <span className="gtarget" style={{ left: x(target) }} />}<span className={"gbar " + cls} style={{ left: x(p.start), width: w(p.start, p.end) }} title={`${fr(p.start)} → ${fr(p.end)}${t.days ? ` · ${t.days} d` : ""}`}>{(daysBetween(p.start, p.end) ?? 0) >= Math.ceil(span / 25) ? `${fr(p.start).slice(0, 5)} → ${fr(p.end).slice(0, 5)}` : ""}</span></div>
              </div>); })}
          </div>);
      })}
      <div className="mini mt-2 flex gap-3 flex-wrap"><span><i className="gkey done" /> done</span><span><i className="gkey ready" /> ready / in progress</span><span><i className="gkey next" /> waits for a dependency</span><span><i className="gkey waiting" /> at the authority</span><span><i className="gkey blocked" /> blocked</span><span><i className="gkey late" /> late</span><span>│ today</span>{target && <span style={{ color: "var(--terra)" }}>┆ target</span>}</div>
    </div>
  );
}
