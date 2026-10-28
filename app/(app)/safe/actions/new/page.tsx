import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import NewActionForm from "@/components/NewActionForm";
import { mayManageActions } from "@/lib/actions";

/** Raise an action, prefilled from where it comes from (a SAM suggestion on a report, a planned mitigation of a hazard, an assessment). */
export default async function NewAction({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!mayManageActions(s)) redirect("/safe/actions");
  const p = await searchParams;
  const entity = p.entity && s.entities.includes(p.entity) ? p.entity : s.entity !== "ALL" ? s.entity : s.entities[0];
  const back = p.report ? `/safe/reports/${p.report}` : p.hazard ? `/safe/risk/${p.hazard}` : p.assessment ? `/safe/risk/a/${p.assessment}` : "/safe/actions";
  return (
    <>
      <PageHeader eyebrow="Safety · Actions" title="New action" sub="Who does what by when — the owner gets it in the Inbox, marks it done with the evidence, the safety desk verifies." right={<Link className="btn" href={back}>Back</Link>} />
      <section className="card"><div className="cb">
        <NewActionForm entity={entity} source={p.source ?? (p.report ? "report" : p.hazard ? "hazard" : p.assessment ? "assessment" : "other")} title={p.title} description={p.description} owner_role={p.owner_role} report_id={p.report} hazard_id={p.hazard} mitigation_id={p.mitigation} assessment_id={p.assessment} />
      </div></section>
    </>
  );
}
