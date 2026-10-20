import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ENT, findModule, findSub, modLabel, subLabel, subsFor } from "@/lib/nav";
import { PageHeader } from "@/components/Page";

const STEP: Record<string, [number, string]> = {
  docs: [3, "Documents — library, manual page, reading & acknowledgement, certificates & validities"],
  home: [4, "Home — real Inbox, My to-do list, Morning coffee"],
  safe: [5, "Safety — report (SAF-01) then analysis on the SM side"],
  comp: [6, "Compliance — findings, actions, change requests"],
};

export default async function GenericPage({ params }: { params: Promise<{ mod: string; sub: string }> }) {
  const { mod, sub } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const m = findModule(mod); const item = findSub(mod, sub);
  if (!m || !item) notFound();
  const allowed = subsFor(s.role, mod).some((x) => x.id === sub);
  if (!allowed) notFound();
  const step = STEP[mod];
  const ent = s.entity === "ALL" ? "all entities in your scope" : `${ENT[s.entity]?.name ?? s.entity} (${s.entity})`;
  return (
    <>
      <PageHeader eyebrow={modLabel(s.role, m)} title={subLabel(s.role, mod, item)} sub={`Scope: ${ent}`} />
      <section className="card">
        <div className="ch"><span className="eyebrow">Beta build-up</span></div>
        <div className="cb">
          <p>This screen exists in the prototype and will be built {step ? <>in <b>step {step[0]}</b> — {step[1]}.</> : <>after the core modules (steps 3 to 6).</>}</p>
          <p className="mini">Navigation, roles and scope are live: what you see in the rail and in this menu is exactly what a <b>{s.role === "cmm" ? "CMM / SM" : s.role === "am" ? "Accountable Manager" : s.role === "np" ? "nominated person" : "crew / staff member"}</b> gets.</p>
        </div>
      </section>
    </>
  );
}
