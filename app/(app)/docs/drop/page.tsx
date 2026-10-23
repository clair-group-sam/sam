import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { mayCreateManual } from "@/lib/create";
import { CERT_KINDS } from "@/lib/cert";
import DropDocument from "@/components/DropDocument";

export const maxDuration = 60; // reading a PDF takes SAM a few seconds

/** Documents › Drop a document: SAM reads an insurance, approval, aircraft document… and proposes where it belongs. */
export default async function Drop() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!(await mayCreateManual(s))) return (<><PageHeader eyebrow="Documents · Drop a document" title="Not available" /><section className="card"><div className="cb">Filing documents is reserved for Compliance, the accountable manager, nominated persons, their deputies and the people Compliance names.</div></section></>);
  const ents = (s.group ? ENTS4 : s.entities).map((e) => ({ code: e, name: ENT[e]?.name ?? e }));
  return (
    <>
      <PageHeader eyebrow="Documents · Certificates & Validities" title="Drop a document" sub="Insurance, approval, authority letter, aircraft document… SAM reads it and proposes where it goes; you confirm or choose another place."
        right={<Link href="/docs/files" className="btn">‹ Certificates & Validities</Link>} />
      <DropDocument entities={ents} kinds={CERT_KINDS} />
    </>
  );
}
