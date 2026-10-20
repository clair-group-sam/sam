import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { listManuals } from "@/lib/docs";
import WmImport from "@/components/WmImport";

export default async function Integrations() {
  const s = await getSession();
  if (!s) redirect("/login");
  const manuals = (await listManuals(s)).map((r) => ({ id: r.manual.id, entity: r.manual.entity, code: r.manual.code, title: r.manual.title, path: r.manual.path }));
  const cmm = s.roles.includes("CMM") || s.roles.includes("SUPERADMIN");
  return (
    <>
      <PageHeader eyebrow="Settings · Integrations" title="Integrations" sub="Microsoft 365 (Entra ID, Teams, Outlook), Web Manuals import bridge, FlightLogger, Leon, Claude." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <section className="card"><div className="ch"><span className="eyebrow">Microsoft Entra ID</span><span className="pill green">Connected</span></div><div className="cb mini">Sign-in through Supabase Auth (OIDC). Scope from Entra groups → Settings › Entra groups sync.</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Outlook · compliance@clair-group.com</span><span className="pill amber">To test</span></div><div className="cb mini">Microsoft Graph, application permission Mail.Send limited to the Compliance mailbox (Exchange RBAC).</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">FlightLogger · Leon · Claude</span><span className="pill">Later</span></div><div className="cb mini">Activity data for the safety report pre-fill; AI agents (AI-01). Keys live in Vercel only.</div></section>
      </div>
      <section className="card">
        <div className="ch"><span className="eyebrow">Web Manuals → S.A.M. import bridge</span><span className="mini">read-only on the Web Manuals side · nothing is published there</span></div>
        <div className="cb">
          <p className="mb-3">Export a manual revision from Web Manuals with the S.A.M. export script (pages, images, table of contents), then drop the file here. Images go to the private storage; chapters replace the revision content; pages revised in that revision are flagged for “What changed”.</p>
          {cmm ? <WmImport manuals={manuals} entities={s.group ? ["ASF", "ASJ", "AJD", "TEC"] : s.entities} /> : <p className="mini">Compliance department only.</p>}
        </div>
      </section>
    </>
  );
}
