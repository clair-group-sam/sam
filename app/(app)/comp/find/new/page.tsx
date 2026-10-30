import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { LEVEL_LABEL, SOURCE_LABEL } from "@/lib/findings";
import { createFinding } from "../actions";

/** Compliance raises a finding: what was found, against what, who answers, by when. */
export default async function NewFinding() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== "cmm") redirect("/comp/find");
  const entity = s.entity === "ALL" ? null : s.entity;
  const ents = entity ? [entity] : (s.group ? ENTS4 : s.entities);
  const { data } = await supabaseAdmin().from("people").select("id,display_name,entities").order("display_name").limit(400);
  const people = ((data ?? []) as { id: string; display_name: string; entities: string[] }[]).filter((p) => !entity || p.entities.includes(entity));
  const t0 = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader eyebrow="Compliance · Findings" title="Raise a finding" sub="The nominated person receives it in the Inbox and on Teams, with the date the answer is due." />
      <section className="card">
        <div className="cb">
          <form action={createFinding} className="grid gap-3 grid-cols-4">
            <label><span className="mini">Entity</span>{entity ? <><input type="hidden" name="entity" value={entity} /><div className="inp" style={{ background: "var(--paper)" }}>{ENT[entity]?.name ?? entity}</div></> : <select name="entity" className="inp" required defaultValue="">{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e} ({e})</option>)}</select>}</label>
            <label><span className="mini">Source</span><select name="source" className="inp" defaultValue="authority">{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label><span className="mini">Authority / auditor</span><input name="authority" className="inp" placeholder="TM-CAD, OSAC, DSAC, internal" /></label>
            <label><span className="mini">Audit / finding reference</span><input name="audit_ref" className="inp" placeholder="AUD-2026-03 · F-2" /></label>
            <label className="col-span-3"><span className="mini">Title</span><input name="title" className="inp" required placeholder="One line: what is not compliant" /></label>
            <label><span className="mini">Level</span><select name="level" className="inp" defaultValue="2">{Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="col-span-2"><span className="mini">Requirement</span><input name="requirement" className="inp mono" placeholder="ORO.GEN.200(a)(3), CAMO.A.305, ORA.GEN.200…" /></label>
            <label><span className="mini">Raised on</span><input type="date" name="notified" className="inp" defaultValue={t0} /></label>
            <label><span className="mini">Answer due</span><input type="date" name="due" className="inp" defaultValue={in30} /></label>
            <label className="col-span-4"><span className="mini">The finding, as written by the auditor</span><textarea name="description" className="inp" rows={5} placeholder="Paste the finding text: evidence, what was expected, what was found." /></label>
            <label><span className="mini">Answered by — post</span><input name="owner_role" className="inp mono" placeholder="NPFO, NPCA, HT, CFI, MAM…" /></label>
            <label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue=""><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
            <div className="col-span-2 flex justify-end items-end"><button className="btn primary" type="submit">Raise the finding</button></div>
          </form>
        </div>
      </section>
    </>
  );
}
