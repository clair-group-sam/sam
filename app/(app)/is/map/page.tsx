import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { isData } from "../data";

const W = 980, ROW = 46, PAD = 28, BOX = 210;
const CRIT: Record<string, string> = { high: "var(--state-red)", medium: "var(--amber)", low: "var(--field)" };

/* Part-IS · Information flow map: every interface as an arrow from its source to its destination; colour = criticality, dashed = no IS clause. */
export default async function FlowMap() {
  const s = await getSession(); if (!s) redirect("/login");
  const { systems, flows } = await isData(s);
  const names = new Set(systems.map((x) => x.name));
  const sources = [...new Set(flows.map((f) => f.from_system))].sort();
  const targets = [...new Set(flows.map((f) => f.to_system))].sort();
  const H = PAD * 2 + Math.max(sources.length, targets.length, 1) * ROW;
  const y = (list: string[], n: string) => PAD + list.indexOf(n) * ROW + ROW / 2 + (Math.max(sources.length, targets.length) - list.length) * ROW / 2;
  const xL = PAD, xR = W - PAD - BOX;
  return (
    <>
      <PageHeader eyebrow="Part-IS, Information flow map" title="Information flow map" sub="Sources on the left, destinations on the right. Red, amber, grey: high, medium, low criticality. A dashed arrow has no Part-IS clause recorded in its contract." right={<Link className="btn" href="/is/flows">Edit the interfaces</Link>} />
      <section className="card"><div className="cb" style={{ overflowX: "auto" }}>
        {!flows.length ? <p className="mini">No interface recorded yet. Add them in <Link className="underline" href="/is/flows">Interfaces & contracts</Link>.</p> : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720, maxWidth: W }} role="img" aria-label="Information flow map">
            <defs>{Object.entries(CRIT).map(([k, c]) => <marker key={k} id={`ar-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill={c} /></marker>)}</defs>
            {flows.map((f) => { const y1 = y(sources, f.from_system), y2 = y(targets, f.to_system); const x1 = xL + BOX, x2 = xR; const mx = (x1 + x2) / 2; return (
              <g key={f.id}><path d={`M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2 - 2} ${y2}`} fill="none" stroke={CRIT[f.criticality] ?? "var(--field)"} strokeWidth={1.8} strokeDasharray={f.is_clause ? undefined : "6 5"} markerEnd={`url(#ar-${f.criticality})`} />
                <title>{`${f.from_system} to ${f.to_system}: ${f.data ?? ""}${f.means ? ` (${f.means})` : ""}`}</title></g>); })}
            {sources.map((n) => <g key={"s" + n}><rect x={xL} y={y(sources, n) - 16} width={BOX} height={32} rx={6} fill={names.has(n) ? "var(--white)" : "var(--gray05)"} stroke="var(--line2)" /><text x={xL + 12} y={y(sources, n) + 5} fontSize="13" fill="var(--navy)" fontWeight={600}>{n.length > 26 ? n.slice(0, 25) + "…" : n}</text></g>)}
            {targets.map((n) => <g key={"t" + n}><rect x={xR} y={y(targets, n) - 16} width={BOX} height={32} rx={6} fill={names.has(n) ? "var(--white)" : "var(--gray05)"} stroke="var(--line2)" /><text x={xR + 12} y={y(targets, n) + 5} fontSize="13" fill="var(--navy)" fontWeight={600}>{n.length > 26 ? n.slice(0, 25) + "…" : n}</text></g>)}
          </svg>)}
        <p className="mini mt-2">White boxes are systems of the register; grey boxes are external parties or systems not registered yet.</p>
      </div></section>
    </>
  );
}
