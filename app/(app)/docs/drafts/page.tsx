import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { STEPS, STEP_LABEL, listManuals } from "@/lib/docs";

export default async function Drafts() {
  const s = await getSession();
  if (!s) redirect("/login");
  const rows = (await listManuals(s)).flatMap((r) => r.workings.map((w) => ({ manual: r.manual, working: w })));
  return (
    <>
      <PageHeader eyebrow="Documents · Drafts in progress" title="Drafts in progress" sub="One draft per manual; the whole manual moves through the steps (DOC-09)." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <section className="card"><div className="ch"><span className="eyebrow">The steps</span></div><div className="cb mini">{STEPS.map((st) => STEP_LABEL[st]).join(" → ")}</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Who does what</span></div><div className="cb mini">Author drafts · NP approves the content · Compliance checks against the requirements · signatures when required (NP + CMM; MSM by the AM + CMM) · Compliance runs the CAA application and publishes.</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Reading</span></div><div className="cb mini">Reading is not a step: it is tracked per reader on the manual page (Readers tab) and in Communication › Read tracking.</div></section>
      </div>
      <section className="card">
        <table className="tbl"><thead><tr><th>Entity</th><th>Manual</th><th>Draft</th><th>Step</th><th>Started</th></tr></thead>
          <tbody>
            {rows.map(({ manual, working }) => (
              <tr key={working.id}><td><span className={"ent " + manual.entity}>{manual.entity}</span></td>
                <td><Link href={working.step === "draft" || working.step === "approved_np" ? `/docs/editor/${working.id}` : `/docs/manual/${manual.id}?rev=${working.id}`}><b>{manual.code} — {manual.title}</b></Link></td>
                <td className="mono">Iss {working.issue} Rev {working.rev}</td><td><span className="pill amber">{STEP_LABEL[working.step]}</span></td><td className="mono">{working.created_at.slice(0, 10)}</td></tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-6 text-slate6">No draft in progress. The revision editor (Write / Publish) arrives with the first revision written in S.A.M.</td></tr>}
          </tbody></table>
      </section>
    </>
  );
}
