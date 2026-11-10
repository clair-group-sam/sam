import Link from "next/link";

/* 10/11 · Compliance › Surveillance plan (Guillaume, option 1): one menu entry, four tabs — the programme, the audits as they run,
 * the recurring compliance checks, the subcontractors under control. Same place to answer « what do we check, when, is it done ». */
const TABS: [string, string, string][] = [["prog", "Programme", "/comp/prog"], ["audits", "Audits", "/comp/audits"], ["checks", "Compliance checks", "/comp/checks"], ["subs", "Subcontractors", "/comp/subs"]];
export function SurvTabs({ on, counts }: { on: "prog" | "audits" | "checks" | "subs"; counts?: Partial<Record<string, number | string>> }) {
  return <nav className="survtabs mb-4" aria-label="Surveillance plan">{TABS.map(([k, l, h]) => <Link key={k} href={h} className={k === on ? "on" : ""} aria-current={k === on ? "page" : undefined}>{l}{counts?.[k] !== undefined && <span className="mini"> {counts[k]}</span>}</Link>)}</nav>;
}
