import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { ZONES } from "@/lib/registers";
import { isData, onePerRef, ATT, type Sys, type Flow } from "../data";

/* Part-IS · Map, three views of the same registers (from the Cartographie Part-IS V7.1, 22/07/2026):
 * Departments: Clair Group support functions above the Part-IS boundary, the entity's departments below; colour = attention level, dashed = contract or IS clauses to confirm.
 * Responsibility: who holds the contract (entity, Group, authority) by sector, rings L1 critical to L3 lower risk.
 * Interfaces: every interface as an arrow from its source to its destination. */
const COL: Record<string, string> = { critical: "var(--state-red)", serious: "var(--amber)", warning: "var(--slate6)" };
const ZGEO: Record<string, [number, number, number, number]> = {
  g_compta: [28, 92, 402, 110], g_hr: [442, 92, 402, 110], g_it: [856, 92, 396, 170], g_mkt: [28, 214, 402, 110], g_own: [442, 214, 402, 110], g_gen: [28, 336, 402, 110],
  trans: [16, 542, 1248, 118], fo: [16, 676, 400, 172], camo: [432, 676, 400, 172], go: [864, 676, 400, 172], training: [16, 864, 400, 172], caa: [432, 864, 400, 172], asf: [864, 864, 400, 172], pending: [16, 1052, 1248, 112],
};
const ZL = Object.fromEntries(ZONES);
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

function Departments({ systems }: { systems: Sys[] }) {
  const by = new Map<string, Sys[]>(); for (const x of systems) { const z = x.zone && ZGEO[x.zone] ? x.zone : "trans"; by.set(z, [...(by.get(z) ?? []), x]); }
  return (
    <svg viewBox="0 0 1280 1180" width="100%" style={{ minWidth: 900 }} role="img" aria-label="Systems by department, with the Part-IS boundary">
      <rect x={16} y={46} width={1248} height={432} rx={10} fill="var(--blue05)" stroke="var(--line2)" />
      <text x={30} y={70} fontSize="14" fontWeight={700} fill="var(--navy)">Clair Group, CGSMT / CGPFR: support functions</text>
      <text x={30} y={86} fontSize="11.5" fill="var(--slate6)">Not Part-IS certified: every interface with an entity is controlled by contract (IS.I.OR.235)</text>
      <line x1={16} x2={1264} y1={510} y2={510} stroke="var(--state-red)" strokeWidth={2} strokeDasharray="10 6" />
      <text x={640} y={503} textAnchor="middle" fontSize="12" fontWeight={700} fill="var(--state-red)">Part-IS boundary</text>
      <text x={640} y={528} textAnchor="middle" fontSize="11" fill="var(--slate6)">below: organisations subject to Part-IS (EU 2023/203)</text>
      {Object.entries(ZGEO).map(([z, [x, y, w, h]]) => { const list = by.get(z) ?? []; if (!list.length && z === "pending") return null; const cols = Math.max(1, Math.floor((w - 16) / 132)); const bw = (w - 16 - (cols - 1) * 8) / cols; return (
        <g key={z}>
          <rect x={x} y={y} width={w} height={h} rx={8} fill={z === "pending" ? "var(--amber-s)" : "var(--white)"} stroke="var(--line2)" />
          <text x={x + 10} y={y + 17} fontSize="11.5" fontWeight={700} fill="var(--navy)">{ZL[z] ?? z}</text>
          {list.map((s, i) => { const bx = x + 8 + (i % cols) * (bw + 8), by2 = y + 26 + Math.floor(i / cols) * 40; const c = s.attention ? COL[s.attention] : "var(--line2)"; return (
            <a key={s.id} href={`/is/systems?open=${s.id}#edit`}>
              <rect x={bx} y={by2} width={bw} height={34} rx={6} fill={s.attention === "critical" ? "var(--terra-s)" : s.attention === "serious" ? "var(--amber-s)" : "var(--white)"} stroke={c} strokeWidth={s.attention ? 1.6 : 1} strokeDasharray={s.contract === "tbc" ? "5 3" : undefined} />
              <text x={bx + 8} y={by2 + 14} fontSize="11.5" fontWeight={600} fill="var(--navy)">{cut(s.name, Math.floor(bw / 7))}</text>
              <text x={bx + 8} y={by2 + 27} fontSize="10" fill="var(--slate6)">{cut(s.short ?? s.dept ?? "", Math.floor(bw / 6))}</text>
              <title>{`${s.name}: ${s.purpose ?? ""}${s.attention ? `. ${ATT[s.attention][1]}` : ""}${s.contract === "tbc" ? ". Contract holder or IS clauses to confirm" : ""}`}</title>
            </a>); })}
        </g>); })}
    </svg>
  );
}

const SECT: Record<string, { a0: number; a1: number; title: string; sub: string; fill: string }> = {
  own: { a0: -90, a1: 90, title: "Entity responsibility", sub: "own contracts, IS clauses to carry (IS.I.OR.235)", fill: "var(--cyan-ink)" },
  grp: { a0: 180, a1: 270, title: "Clair Group or another entity", sub: "not subject to Part-IS: contractual control", fill: "var(--purple)" },
  auth: { a0: 90, a1: 180, title: "Authorities, State", sub: "imposed channels (TM-CAD, DGAC, EU, AIFE)", fill: "var(--indigo-ink)" },
};
const RR: Record<number, number> = { 1: 170, 2: 235, 3: 300 };
function Rings({ systems }: { systems: Sys[] }) {
  const CX = 520, CY = 400; const rad = (a: number) => (Math.PI * a) / 180;
  const pts: { s: Sys; x: number; y: number; a: number }[] = [];
  for (const k of Object.keys(SECT)) for (const r of [1, 2, 3]) {
    const list = systems.filter((s) => s.resp === k && (s.ring ?? 2) === r && s.status !== "awaiting"); const S = SECT[k];
    list.forEach((s, i) => { const a = S.a0 + ((i + 1) * (S.a1 - S.a0)) / (list.length + 1); pts.push({ s, a, x: CX + RR[r] * Math.cos(rad(a)), y: CY + RR[r] * Math.sin(rad(a)) }); });
  }
  const arc = (a0: number, a1: number, ri: number, ro: number) => `M${CX + ri * Math.cos(rad(a0))},${CY + ri * Math.sin(rad(a0))} L${CX + ro * Math.cos(rad(a0))},${CY + ro * Math.sin(rad(a0))} A${ro},${ro} 0 0 1 ${CX + ro * Math.cos(rad(a1))},${CY + ro * Math.sin(rad(a1))} L${CX + ri * Math.cos(rad(a1))},${CY + ri * Math.sin(rad(a1))} A${ri},${ri} 0 0 0 ${CX + ri * Math.cos(rad(a0))},${CY + ri * Math.sin(rad(a0))} Z`;
  return (
    <svg viewBox="0 0 1040 800" width="100%" style={{ minWidth: 760, maxWidth: 1040 }} role="img" aria-label="Systems by responsibility and criticality ring">
      {Object.entries(SECT).map(([k, S]) => <path key={k} d={arc(S.a0, S.a1, 60, 340)} fill={S.fill} fillOpacity={0.07} stroke="var(--line2)" />)}
      {[1, 2, 3].map((r) => <g key={r}><circle cx={CX} cy={CY} r={RR[r]} fill="none" stroke="var(--line2)" /><text x={CX + 6} y={CY - RR[r] + 14} fontSize="11" fill="var(--slate6)">L{r}</text></g>)}
      <circle cx={CX} cy={CY} r={56} fill="var(--white)" stroke="var(--line2)" /><text x={CX} y={CY + 4} textAnchor="middle" fontSize="12.5" fontWeight={700} fill="var(--navy)">Operations</text>
      <text x={1020} y={34} textAnchor="end" fontSize="13" fontWeight={700} fill="var(--cyan-ink)">{SECT.own.title}</text><text x={1020} y={50} textAnchor="end" fontSize="11" fill="var(--slate6)">{SECT.own.sub}</text>
      <text x={20} y={34} fontSize="13" fontWeight={700} fill="var(--purple)">{SECT.grp.title}</text><text x={20} y={50} fontSize="11" fill="var(--slate6)">{SECT.grp.sub}</text>
      <text x={20} y={770} fontSize="13" fontWeight={700} fill="var(--indigo-ink)">{SECT.auth.title}</text><text x={20} y={786} fontSize="11" fill="var(--slate6)">{SECT.auth.sub}</text>
      <text x={1020} y={786} textAnchor="end" fontSize="11" fill="var(--slate6)">L1 critical, L2 standard, L3 lower risk. Hollow dot: contract or IS clauses to confirm.</text>
      {pts.map(({ s, x, y, a }) => { const right = Math.cos(rad(a)) >= 0; const c = s.attention ? COL[s.attention] : "var(--navy)"; return (
        <a key={s.id} href={`/is/systems?open=${s.id}#edit`}>
          <circle cx={x} cy={y} r={7} fill={s.contract === "tbc" ? "var(--white)" : c} stroke={c} strokeWidth={2} />
          <text x={x + (right ? 11 : -11)} y={y + 4} textAnchor={right ? "start" : "end"} fontSize="11.5" fontWeight={600} fill="var(--navy)">{cut(s.name, 22)}</text>
          <title>{`${s.name}: ${s.purpose ?? ""}`}</title>
        </a>); })}
    </svg>
  );
}

const W = 980, ROW = 46, PAD = 28, BOX = 210;
const CRIT: Record<string, string> = { high: "var(--state-red)", medium: "var(--amber)", low: "var(--field)" };
function Interfaces({ systems, flows }: { systems: Sys[]; flows: Flow[] }) {
  const names = new Set(systems.map((x) => x.name));
  const sources = [...new Set(flows.map((f) => f.from_system))].sort();
  const targets = [...new Set(flows.map((f) => f.to_system))].sort();
  const H = PAD * 2 + Math.max(sources.length, targets.length, 1) * ROW;
  const y = (list: string[], n: string) => PAD + list.indexOf(n) * ROW + ROW / 2 + (Math.max(sources.length, targets.length) - list.length) * ROW / 2;
  const xL = PAD, xR = W - PAD - BOX;
  if (!flows.length) return <p className="mini">No interface recorded yet. Add them in <Link className="underline" href="/is/flows">Interfaces & contracts</Link>.</p>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720, maxWidth: W }} role="img" aria-label="Information flow map">
      <defs>{Object.entries(CRIT).map(([k, c]) => <marker key={k} id={`ar-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill={c} /></marker>)}</defs>
      {flows.map((f) => { const y1 = y(sources, f.from_system), y2 = y(targets, f.to_system); const x1 = xL + BOX, x2 = xR; const mx = (x1 + x2) / 2; return (
        <g key={f.id}><path d={`M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2 - 2} ${y2}`} fill="none" stroke={CRIT[f.criticality] ?? "var(--field)"} strokeWidth={1.8} strokeDasharray={f.is_clause ? undefined : "6 5"} markerEnd={`url(#ar-${f.criticality})`} />
          <title>{`${f.from_system} to ${f.to_system}: ${f.data ?? ""}${f.means ? ` (${f.means})` : ""}`}</title></g>); })}
      {sources.map((n) => <g key={"s" + n}><rect x={xL} y={y(sources, n) - 16} width={BOX} height={32} rx={6} fill={names.has(n) ? "var(--white)" : "var(--gray05)"} stroke="var(--line2)" /><text x={xL + 12} y={y(sources, n) + 5} fontSize="13" fill="var(--navy)" fontWeight={600}>{cut(n, 26)}</text></g>)}
      {targets.map((n) => <g key={"t" + n}><rect x={xR} y={y(targets, n) - 16} width={BOX} height={32} rx={6} fill={names.has(n) ? "var(--white)" : "var(--gray05)"} stroke="var(--line2)" /><text x={xR + 12} y={y(targets, n) + 5} fontSize="13" fill="var(--navy)" fontWeight={600}>{cut(n, 26)}</text></g>)}
    </svg>
  );
}

export default async function IsMap({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const v = (await searchParams).v ?? "dept";
  const d = await isData(s);
  const systems = s.entity === "ALL" ? onePerRef(d.systems) : d.systems;
  const flows = s.entity === "ALL" ? d.flows.filter((f, i, a) => a.findIndex((g) => g.from_system === f.from_system && g.to_system === f.to_system) === i) : d.flows;
  const tab = (k: string, l: string) => <Link className={v === k ? "on" : ""} href={`/is/map?v=${k}`}>{l}</Link>;
  const SUB: Record<string, string> = {
    dept: "Clair Group support functions above the Part-IS boundary, the departments subject to Part-IS below. Red, amber: critical, to address. A dashed box has its contract holder or IS clauses still to confirm. Each box opens its line in the register.",
    rings: "Who holds each system: the entity, Clair Group or another entity, or the State. Inner ring L1 is critical for flight safety, L3 lower risk. A hollow dot has its contract or IS clauses still to confirm.",
    flows: "Sources on the left, destinations on the right. Red, amber, grey: high, medium, low criticality. A dashed arrow has no Part-IS clause recorded in its contract.",
  };
  return (
    <>
      <PageHeader eyebrow="Part-IS, Map" title="Information systems map" sub={SUB[v] ?? SUB.dept} right={<div className="flex gap-2 items-center"><div className="seg">{tab("dept", "Departments")}{tab("rings", "Responsibility")}{tab("flows", "Interfaces")}</div><Link className="btn" href={v === "flows" ? "/is/flows" : "/is/systems"}>Edit</Link></div>} />
      <section className="card"><div className="cb" style={{ overflowX: "auto" }}>
        {!systems.length && v !== "flows" ? <p className="mini">No system recorded yet. Add them in <Link className="underline" href="/is/systems">Systems register</Link>.</p>
          : v === "rings" ? <Rings systems={systems} /> : v === "flows" ? <Interfaces systems={systems} flows={flows} /> : <Departments systems={systems} />}
        <p className="mini mt-2">Built from the Cartographie Part-IS V7.1 (22/07/2026), basis of the PRO-IS-01 annexes (IS.I.OR.205(a)). OEM portal addresses are kept off this map (CSM decision).</p>
      </div></section>
    </>
  );
}
