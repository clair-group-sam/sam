import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";

/* References · References & glossary: the texts S.A.M. leans on, screen by screen, and the acronyms it uses. Reference only. */
const REFS: { ref: string; what: string; where: string; href?: string }[] = [
  { ref: "Regulation (EU) 2018/1139", what: "Basic Regulation: EASA, the competent authorities, the essential requirements.", where: "Everywhere" },
  { ref: "Regulation (EU) No 965/2012, ORO.GEN.200 and ORO.GEN.210", what: "Management system of an air operator (safety and compliance monitoring), accountable manager and nominated persons.", where: "Compliance, Safety, NP management (Astonjet, Astonjet Ltd)", href: "/reg/ear" },
  { ref: "Regulation (EU) No 1178/2011, ORA.GEN.200 and ORA.GEN.210", what: "Management system of a training organisation (ATO) and of an FSTD operator.", where: "Compliance, Safety, NP management (Astonfly)", href: "/reg/ear" },
  { ref: "Regulation (EU) No 1321/2014, Part-CAMO and Part-145", what: "Continuing airworthiness management (CAMO.A.200, .305) and maintenance organisation (145.A.30, .200).", where: "NP management, Compliance (Astonjet Ltd CAMO, Astontec)", href: "/reg/ear" },
  { ref: "Regulation (EU) No 376/2014 and 2015/1018", what: "Occurrence reporting: mandatory reporting within 72 hours (art. 4(8)), follow-up at 30 days and final report at 3 months (art. 13(4)), protection of the reporter (art. 16); 2015/1018 lists the occurrences to report.", where: "Safety › Reports, MOR / ECCAIRS", href: "/safe/mor" },
  { ref: "Regulation (EU) 2023/203, Part-IS", what: "Information security risks with a potential impact on aviation safety (IS.I.OR / IS.D.OR).", where: "Part-IS module, PRO-IS-01", href: "/is/over" },
  { ref: "ICAO Annex 19 and Doc 9859 (SMM)", what: "Safety management: the four components, the SRB / SAG, safety performance indicators, the risk matrix.", where: "Safety › Overview, Committees, Hazard log" },
  { ref: "ICAO ADREP and CICTT taxonomies", what: "Occurrence categories (BIRD, RE, SCF-NP…), event types and phases of flight used in ECCAIRS 2.", where: "Safety › Reports (analysis), MOR / ECCAIRS correspondences", href: "/safe/mor/e2" },
  { ref: "ARMS, Event Risk Classification (ERC)", what: "Risk of an event already happened: most credible accident outcome × effectiveness of the remaining barriers.", where: "Safety › Reports (analysis)", href: "/safe/reports" },
  { ref: "MSM / CAE of each entity (§ quoted under each screen)", what: "The management system manual: SRB §4.5, SAG §4.6, compliance review §2.6, records §1.6.5, changes §1.6; the CAE for Astontec.", where: "Under the title of the screens concerned", href: "/docs/lib" },
  { ref: "ENR-CM-06, compliance and safety indicators", what: "C1…C11 and the SPI, their targets and alert thresholds, per entity.", where: "Compliance › Indicators, Safety › Overview", href: "/comp/kpi" },
  { ref: "ENR-OPS-01 / ENR-ATO-01, audit programme", what: "The audit plan in force of each entity: modules, cycle, subcontractors, compliance checks.", where: "Compliance › Audit programme", href: "/comp/prog" },
];
const GLOSS: [string, string][] = [
  ["AM", "Accountable Manager"], ["AMC / GM", "Acceptable Means of Compliance / Guidance Material (EASA)"], ["AMP", "Aircraft Maintenance Programme"], ["AOC", "Air Operator Certificate"], ["ATO", "Approved Training Organisation"],
  ["CAE", "Manuel des spécifications de l'organisme d'entretien (Part-145 exposition, Astontec)"], ["CAME", "Continuing Airworthiness Management Exposition"], ["CAMO", "Continuing Airworthiness Management Organisation"], ["CMM", "Compliance Monitoring Manager"],
  ["CODIR", "Comité de direction (Astonfly holds its safety review board there)"], ["CRS", "Certificate of Release to Service"], ["DSAC", "Direction de la sécurité de l'aviation civile (DGAC, France)"], ["E2 / ECCAIRS 2", "European occurrence reporting platform (EASA), where MOR are filed"],
  ["EAR", "Easy Access Rules (EASA consolidated regulations)"], ["ERC", "Event Risk Classification (ARMS)"], ["ERP", "Emergency Response Plan"], ["FSO", "Flight Safety Officer"], ["FSTD", "Flight Simulation Training Device"],
  ["GOM", "Ground Operations Manual"], ["ISM", "Information Security Manager (Part-IS)"], ["KPI / SPI", "Key / Safety Performance Indicator"], ["MEL", "Minimum Equipment List"], ["MOC", "Management of Change"], ["MOR", "Mandatory Occurrence Report (376/2014)"],
  ["MSM", "Management System Manual"], ["NP", "Nominated Person (NPFO flight operations, NPCT crew training, NPGO ground operations, NPCA continuing airworthiness, NPMT maintenance)"], ["OM", "Operations Manual (parts A, B, C, D)"], ["OSAC", "Organisme pour la sécurité de l'aviation civile (Part-145 / CAMO oversight, France)"],
  ["Part-IS", "Information security management system (Regulation 2023/203)"], ["RA", "Risk Assessment"], ["SAG", "Safety Action Group"], ["SM", "Safety Manager"], ["SRB", "Safety Review Board"], ["TM-CAD", "Transport Malta, Civil Aviation Directorate"],
];
export default async function Glossary() {
  const s = await getSession(); if (!s) redirect("/login");
  return (
    <>
      <PageHeader eyebrow="References, References & glossary" title="References & glossary" sub="The texts S.A.M. applies, where they show in the screens, and the acronyms used in the interface." />
      <section className="card mb-4"><div className="ch"><b>References</b></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Text</th><th>What it governs here</th><th>Where in S.A.M.</th></tr></thead><tbody>
          {REFS.map((r) => <tr key={r.ref}><td><b>{r.ref}</b></td><td className="mini" style={{ maxWidth: 520 }}>{r.what}</td><td className="mini">{r.href ? <Link className="underline" href={r.href}>{r.where}</Link> : r.where}</td></tr>)}
        </tbody></table></div></section>
      <section className="card"><div className="ch"><b>Glossary</b><span className="mini">{GLOSS.length} terms</span></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><tbody>{GLOSS.map(([k, v]) => <tr key={k}><td style={{ width: 160 }}><b>{k}</b></td><td className="mini">{v}</td></tr>)}</tbody></table></div></section>
    </>
  );
}
