import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import ProjectPlanner from "@/components/ProjectPlanner";

export const maxDuration = 300; // the research (web searches included) can take a couple of minutes

/** Projects › Plan with S.A.M.: for a project never done before. S.A.M. researches what it takes and proposes phases and tasks. */
export default async function PlanProject({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "user") redirect("/proj/boards");
  const sp = await searchParams;
  const ents = s.group ? [...ENTS4] : s.entities;
  const entity = sp.entity && ents.includes(sp.entity) ? sp.entity : s.entity !== "ALL" && ents.includes(s.entity) ? s.entity : ents[0];
  return (
    <>
      <PageHeader eyebrow="Projects" title="Plan with S.A.M." sub="For a project you have never run. Describe it; S.A.M. looks at what it already holds (posts, manuals, application types, templates, lessons learned), searches official sources, and proposes the phases and tasks. You keep what is right, then the project is created." right={<Link href="/proj/boards/new" className="btn">‹ New project</Link>} />
      <ProjectPlanner entity={entity} entities={ents.map((e) => [e, ENT[e]?.name ?? e])} />
    </>
  );
}
