import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import ReportForm from "@/components/ReportForm";

export const maxDuration = 60;

/** Safety › New report (SAF-01) — every profile, crew included. */
export default async function NewReport() {
  const s = await getSession();
  if (!s) redirect("/login");
  const entities = s.entities.map((c) => ({ code: c, name: ENT[c]?.name ?? c }));
  const def = s.entity !== "ALL" && s.entities.includes(s.entity) ? s.entity : (s.person?.home_entity && s.entities.includes(s.person.home_entity) ? s.person.home_entity : s.entities[0] ?? "");
  return (
    <>
      <PageHeader eyebrow="Safety · Report an event" title="New safety report" sub="Occurrence, hazard or anything that could affect safety. Takes 3 minutes." />
      {entities.length ? <ReportForm entities={entities} defaultEntity={def} /> : <section className="card"><div className="cb">Your account has no entity yet — ask Compliance to add you.</div></section>}
    </>
  );
}
