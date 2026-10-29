import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { REPORTS_ELSEWHERE } from "@/lib/entity-codes";
import ReportForm from "@/components/ReportForm";

export const maxDuration = 60;

/** Safety › New report (SAF-01) — every profile, crew included. Astonfly reports in FlightLogger (SAF-07): the page sends them there. */
export default async function NewReport() {
  const s = await getSession();
  if (!s) redirect("/login");
  const elsewhere = s.entities.filter((c) => REPORTS_ELSEWHERE[c]);
  const entities = s.entities.filter((c) => !REPORTS_ELSEWHERE[c]).map((c) => ({ code: c, name: ENT[c]?.name ?? c }));
  const pick = s.entity !== "ALL" && s.entities.includes(s.entity) ? s.entity : (s.person?.home_entity && s.entities.includes(s.person.home_entity) ? s.person.home_entity : s.entities[0] ?? "");
  const def = entities.some((e) => e.code === pick) ? pick : entities[0]?.code ?? "";
  const first = REPORTS_ELSEWHERE[pick] ? pick : null;
  const Elsewhere = () => <>{elsewhere.map((c) => (
    <section key={c} className="card mb-4"><div className="ch"><span className="eyebrow">{ENT[c]?.name ?? c}</span></div>
      <div className="cb flex justify-between items-center gap-4"><span>{ENT[c]?.name ?? c} reports are sent in {REPORTS_ELSEWHERE[c].tool}, as today. The safety desk retrieves them in S.A.M. for analysis and follow-up.</span>
        <a className="btn primary" href={REPORTS_ELSEWHERE[c].url} target="_blank" rel="noreferrer">Report in {REPORTS_ELSEWHERE[c].tool} ↗</a></div></section>))}</>;
  return (
    <>
      <PageHeader eyebrow="Safety · Report an event" title="New safety report" sub="Occurrence, hazard or anything that could affect safety. Takes 3 minutes." />
      {first && <Elsewhere />}
      {entities.length ? <ReportForm entities={entities} defaultEntity={def} /> : !elsewhere.length && <section className="card"><div className="cb">Your account has no entity yet — ask Compliance to add you.</div></section>}
      {!first && <Elsewhere />}
    </>
  );
}
