import { PageHeader } from "@/components/Page";
import { STEP_LABEL } from "@/lib/docs";
import { TRANSITIONS } from "@/lib/revisions";
import { registersSession } from "../guard";

const BY: Record<string, string> = { owner: "The nominated person who owns the manual (or deputy)", cmm: "Compliance (CMM and team)", owner_or_cmm: "The owner NP or Compliance" };

/* Registers · Who signs what: the rules S.A.M. applies, read from the code that enforces them (DOC-06, DOC-09). */
export default async function WhoSignsWhat() {
  await registersSession();
  return (
    <>
      <PageHeader eyebrow="Registers, Who signs what" title="Who signs what" sub="The rules S.A.M. enforces on every manual revision. They come from the same table the editor uses, so this page cannot drift from what the software does." />
      <section className="card mb-4"><div className="ch"><span className="eyebrow">Revision steps</span></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>From</th><th>To</th><th>Done by</th><th>Rule</th></tr></thead><tbody>
          {TRANSITIONS.map((t, i) => <tr key={i}><td>{STEP_LABEL[t.from] ?? t.from}</td><td><b>{STEP_LABEL[t.to] ?? t.to}</b></td><td>{BY[t.by]}</td><td className="mini">{t.note ?? ""}</td></tr>)}
        </tbody></table></div></section>
      <section className="card"><div className="ch"><span className="eyebrow">Signatures on the manual</span></div><div className="cb" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Document</th><th>Signed by</th><th>Basis</th></tr></thead><tbody>
          <tr><td><b>MSM</b> (management system manual)</td><td>Accountable Manager and CMM</td><td className="mini">ORO.GEN.200, MSM §0.2</td></tr>
          <tr><td><b>Manuals that need signatures</b> (OM, CAME, CAE, TM)</td><td>Owner nominated person and CMM</td><td className="mini">DOC-09, set per manual (nature)</td></tr>
          <tr><td><b>Internal documents</b> (policies, guides)</td><td>No signature: published by the author after the review</td><td className="mini">DOC-11</td></tr>
          <tr><td><b>Authority applications</b> (METEOR, TM-CAD)</td><td>Prepared by Compliance, submitted by a person, never by S.A.M.</td><td className="mini">DOC-05, DOC-06</td></tr>
          <tr><td><b>Risk acceptance</b></td><td>The post set by the risk matrix (SM, AM for intolerable)</td><td className="mini">MSM §3, SAF-02</td></tr>
          <tr><td><b>Finding closure</b></td><td>Requested by the NP, accepted by Compliance</td><td className="mini">FND-01, FND-03</td></tr>
        </tbody></table></div></section>
    </>
  );
}
