import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { listManuals } from "@/lib/docs";
import WmImport from "@/components/WmImport";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { teamsConfigured, teamsInstallConfigured } from "@/lib/teams";
import { teamsTestCard } from "./actions";
import RiskImportKey from "@/components/RiskImportKey";
import { headers } from "next/headers";

export default async function Integrations() {
  const s = await getSession();
  if (!s) redirect("/login");
  const manuals = (await listManuals(s)).map((r) => ({ id: r.manual.id, entity: r.manual.entity, code: r.manual.code, title: r.manual.title, path: r.manual.path }));
  const cmm = s.roles.includes("CMM") || s.roles.includes("SUPERADMIN");
  // TMS-01 · Teams bot: state for this person and the last test
  const db = supabaseAdmin();
  const { data: conv } = s.person ? await db.from("teams_conversations").select("installed_at,installed_by").eq("person_id", s.person.id).maybeSingle() : { data: null };
  const { data: lastTest } = s.person ? await db.from("audit_log").select("at,after").eq("object_type", "teams").eq("object_id", s.person.id).order("id", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const teamsState = !teamsConfigured() ? ["amber", "Not configured"] : conv ? ["green", "Connected"] : ["", "Ready"];
  const test = lastTest as { at: string; after: { status?: string } } | null;
  const h = await headers(); const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return (
    <>
      <PageHeader eyebrow="Settings · Integrations" title="Integrations" sub="Microsoft 365 (Entra ID, Teams, Outlook), Web Manuals import bridge, FlightLogger, Leon, Claude." />
      <div className="grid grid-cols-2 gap-4 mb-5">
        <section className="card"><div className="ch"><span className="eyebrow">Microsoft Entra ID</span><span className="pill green">Connected</span></div><div className="cb mini">Sign-in through Supabase Auth (OIDC). Scope from Entra groups → Settings › Entra groups sync.</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Outlook · compliance@clair-group.com</span><span className="pill amber">To test</span></div><div className="cb mini">Microsoft Graph, application permission Mail.Send limited to the Compliance mailbox (Exchange RBAC).</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Teams bot « S.A.M. »</span><span className={"pill " + teamsState[0]}>{teamsState[1]}</span></div>
          <div className="cb mini">Cards in your personal chat for what needs you (tasks, dossiers, readings), with Done / Not yet buttons written back in S.A.M. {conv ? `Your chat with the bot is open (${(conv as { installed_by: string }).installed_by === "graph" ? "installed by S.A.M." : "you opened it"}).` : teamsInstallConfigured() ? "S.A.M. will open the chat for you at the first card." : "Open the S.A.M. app once in Teams, or ask IT for TEAMS_APP_ID so S.A.M. installs it for everyone."}
            <form action={teamsTestCard} className="mt-2 flex items-center gap-2"><button className="btn" type="submit" disabled={!teamsConfigured()}>Send me a test card</button>{test && <span>last: {test.after?.status} · {test.at.slice(0, 16).replace("T", " ")}</span>}</form></div></section>
        <section className="card"><div className="ch"><span className="eyebrow">FlightLogger · Leon · Claude</span><span className="pill">Later</span></div><div className="cb mini">Activity data for the safety report pre-fill; AI agents (AI-01). Keys live in Vercel only.</div></section>
      </div>
      <section className="card">
        <div className="ch"><span className="eyebrow">Web Manuals → S.A.M. import bridge</span><span className="mini">read-only on the Web Manuals side · nothing is published there</span></div>
        <div className="cb">
          <p className="mb-3">Export a manual revision from Web Manuals with the S.A.M. export script (pages, images, table of contents), then drop the file here. Images go to the private storage; chapters replace the revision content; pages revised in that revision are flagged for “What changed”.</p>
          {cmm ? <WmImport manuals={manuals} entities={s.group ? ["ASFFR", "ASJFR", "ASJMT", "ASTFR"] : s.entities} /> : <p className="mini">Compliance department only.</p>}
        </div>
      </section>
      <section className="card mt-4">
        <div className="ch"><span className="eyebrow">Risk register import · Centrik / FlightLogger</span><span className="mini">read-only on the source side · re-running updates what was imported</span></div>
        <div className="cb">
          <p className="mb-3">Hazard log entries (HZ), MOCs and RAs with their hazards, consequences, current / planned mitigations, pre / post ratings, sign-off and decision are read in the source tool by the S.A.M. export script (scripts/centrik-risk-export.js) and posted here with a one-time key.</p>
          {cmm ? <RiskImportKey origin={origin} /> : <p className="mini">Compliance department only.</p>}
        </div>
      </section>
    </>
  );
}
