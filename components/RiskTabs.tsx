import Link from "next/link";

/** Safety › risk: the hazard log (lasting hazards, current rating) and the dated studies that feed it (MOC, one-off RA). */
export function RiskTabs({ on, toMatch }: { on: "log" | "moc" | "ra" | "match" | "tpl"; toMatch?: number }) {
  const tabs: [typeof on, string, string][] = [["log", "/safe/risk", "Hazard log"], ["moc", "/safe/moc", "Management of change"], ["ra", "/safe/ra", "Risk assessments"], ["match", "/safe/risk/match", `To match with the log${toMatch ? ` · ${toMatch}` : ""}`], ["tpl", "/safe/risk/templates", "Templates"]];
  return <div className="flex gap-2 mb-4 flex-wrap">{tabs.map(([k, href, l]) => <Link key={k} href={href} className={"btn" + (on === k ? " on" : "")}>{l}</Link>)}</div>;
}

