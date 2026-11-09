import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ANNEXES, annexData } from "@/lib/is-annex";

/* References · PRO-IS-01 annexes: generated from the Part-IS registers, printed on demand. The procedure refers to this page. */
export default async function Annexes() {
  const s = await getSession(); if (!s) redirect("/login");
  const db = supabaseAdmin();
  const all = await Promise.all(Object.keys(ANNEXES).map(async (k) => ({ k, ...(await annexData(db, k)) })));
  return (
    <>
      <PageHeader eyebrow="References, PRO-IS-01 annexes" title="PRO-IS-01 annexes" sub="The list of systems and interfaces of each Part-IS perimeter (IS.I.OR.205), generated from the Systems register, Interfaces & contracts and the IS risk assessment. Print it when the procedure or the authority needs a copy: it is always the current state." />
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))" }}>
        {all.map(({ k, A, systems, awaiting, flows }) => (
          <section key={k} className="card"><div className="ch"><b>{A.title}</b><Link className="btn primary sm" href={`/print/is-annex/${k}`} target="_blank">Print the annex</Link></div>
            <div className="cb">
              <p className="mini mb-3">{A.basis}</p>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Systems" value={systems.length} hint={`${systems.filter((x) => x.level === "critical").length} critical`} />
                <Metric label="Without IS risk assessment" value={systems.filter((x) => x.level === "critical" && !x.risks.length).length} tone={systems.some((x) => x.level === "critical" && !x.risks.length) ? "red" : undefined} hint="critical systems" />
                <Metric label="Contracts to confirm" value={systems.filter((x) => x.contractState === "tbc" && x.resp !== "auth").length} tone={systems.some((x) => x.contractState === "tbc" && x.resp !== "auth") ? "amber" : undefined} hint="holder or Part-IS clauses" />
                <Metric label="Interfaces, departments without reply" value={`${flows.length}, ${awaiting.length}`} />
              </div>
            </div></section>))}
      </div>
    </>
  );
}
