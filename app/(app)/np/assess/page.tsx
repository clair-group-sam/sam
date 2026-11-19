import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { today } from "@/lib/authority";
import { ASSESS_ENTITIES, FORMS, OUTCOME, isDesk, isForm, maySee, mayStartOwn, progress, selfProgress, type Assessment } from "@/lib/competency";
import { createAssessment } from "./actions";

type Sp = { entity?: string; new?: string; own?: string; name?: string; position?: string; fn?: string; err?: string };
const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "—");
const norm = (x: string | null) => (x ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** The form a post starts on: the airworthiness posts take ENR-COMP-02, the others ENR-COMP-01. It can be changed. */
const formOfPost = (code: string) => (/^(NPCA|CAM|CAMO|ARS|CAE|AE)/.test(code.toUpperCase()) ? "CAMO" : "OPS");
const fnOfPost = (code: string) => { const c = code.toUpperCase().replace(/^D(?=CMM|SM)/, ""); return ({ NPCA: "CAM", CAM: "CAM", CMM: "CMM", SM: "SM", ARS: "ARS", NPFO: "NPFO", NPCT: "NPCT", NPGO: "NPGO" } as Record<string, string>)[c] ?? ""; };

/* NP-03 · NP management › Competency assessments: the house forms ENR-COMP-01 (OPS) and ENR-COMP-02 (CAMO).
 * Astonjet France and Astonjet Malta. The person pre-fills, Compliance (MSM 1.5.2) validates and signs. */
export default async function Assessments({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams; const t0 = today();
  const ents = (s.group ? ENTS4 : s.entities).filter((e) => ASSESS_ENTITIES.includes(e));
  const picked = sp.entity ?? (s.entity !== "ALL" ? s.entity : null);
  if (!ents.length || (picked && !ents.includes(picked))) {
    return (<><PageHeader eyebrow="NP management, Competency assessments" title="Competency assessments" sub={`Competency assessments (ENR-COMP-01, ENR-COMP-02) are in use at Astonjet France and Astonjet Malta only. ${picked ? (ENT[picked]?.name ?? picked) + " has none: its manual does not call for one." : ""}`} />
      {ents.length > 0 && <div className="chips flex items-center gap-2">{ents.map((e) => <Link key={e} href={`/np/assess?entity=${e}`} className={"ent " + e}>{e}</Link>)}</div>}</>);
  }
  const scope = picked ? [picked] : ents;
  const one = scope.length === 1 ? scope[0] : null;
  const desk = isDesk(s); const own = mayStartOwn(s); const me = s.person?.id ?? "-";
  const db = supabaseAdmin();
  const [{ data: rows }, { data: posts }, { data: ppl }] = await Promise.all([
    db.from("competency_assessments").select("*").in("entity", scope).order("assessed_on", { ascending: false, nullsFirst: true }).limit(2000),
    desk ? db.from("np_posts").select("entity,code,title,holder_name,deputy_name,ord").in("entity", scope).order("ord") : Promise.resolve({ data: [] }),
    desk ? db.from("people").select("id,display_name,job_title,entities,home_entity").order("display_name").limit(1500) : Promise.resolve({ data: [] }),
  ]);
  const all = ((rows ?? []) as Assessment[]).filter((a) => maySee(s, a));
  const signed = all.filter((a) => a.status === "signed"); const toValidate = all.filter((a) => a.status === "submitted"); const withPerson = all.filter((a) => a.status === "draft");
  // the assessment in force for a person on a form: the latest signed one
  const latest = new Map<string, Assessment>();
  for (const a of [...signed].sort((x, y) => (y.assessed_on ?? "").localeCompare(x.assessed_on ?? ""))) { const k = `${a.entity}|${a.form}|${norm(a.person_name)}`; if (!latest.has(k)) latest.set(k, a); }
  const inForce = [...latest.values()];
  const dueSoon = inForce.filter((a) => a.next_due && a.next_due <= new Date(Date.parse(t0) + 90 * 86_400_000).toISOString().slice(0, 10));
  const late = dueSoon.filter((a) => a.next_due! < t0);
  type Post = { entity: string; code: string; title: string; holder_name: string | null; deputy_name: string | null };
  const holders = ((posts ?? []) as Post[]).filter((p) => p.code.toUpperCase() !== "AM").flatMap((p) => [p.holder_name ? { entity: p.entity, code: p.code, title: p.title, name: p.holder_name, deputy: false } : null, p.deputy_name ? { entity: p.entity, code: p.code, title: p.title, name: p.deputy_name, deputy: true } : null]).filter(Boolean) as { entity: string; code: string; title: string; name: string; deputy: boolean }[];
  const lastOf = (e: string, name: string) => inForce.filter((a) => a.entity === e && norm(a.person_name) === norm(name)).sort((x, y) => (y.assessed_on ?? "").localeCompare(x.assessed_on ?? ""))[0] ?? null;
  const openOf = (e: string, name: string) => all.find((a) => a.status !== "signed" && a.entity === e && norm(a.person_name) === norm(name)) ?? null;
  const never = holders.filter((h) => !lastOf(h.entity, h.name));
  const people = ((ppl ?? []) as { id: string; display_name: string; job_title: string | null; entities: string[] | null; home_entity: string | null }[]);
  const newForm = sp.new && isForm(sp.new) ? sp.new : null; const newEnt = one ?? scope[0];
  const ownNew = !desk || sp.own === "1";
  const F = newForm && (desk || own) ? FORMS[newForm] : null; const preFn = (sp.fn ?? "").split(",");
  const preName = sp.name ?? ""; const prePerson = people.find((p) => norm(p.display_name) === norm(preName));
  const state = (a: Assessment) => { const o = a.outcome ? OUTCOME[a.outcome] : null;
    if (a.status === "signed") return <span className={"pill " + (o?.[1] ?? "")}>{o?.[0] ?? "—"}</span>;
    if (a.status === "submitted") return <span className="pill amber">pre-filled, to validate by Compliance</span>;
    const sp2 = selfProgress(a); const p = progress(a);
    return a.person_id ? <span className="pill">with {a.person_id === me ? "you" : "the person"}, {sp2.done}/{sp2.n} pre-filled</span> : <span className="pill amber">draft, {p.done}/{p.n} points</span>; };

  return (
    <>
      <PageHeader eyebrow="NP management, Competency assessments" title={`Competency assessments${one ? ", " + (ENT[one]?.name ?? one) : ""}`}
        sub="ENR-COMP-01 (OPS) and ENR-COMP-02 (CAMO). The person pre-fills the sheet; the Compliance Monitoring Manager grades each point 1 to 4, decides and signs (MSM 1.5.2). A sheet is seen by Compliance and by the person assessed."
        right={one ? <>{desk && <><Link className="btn primary" href={`/np/assess?entity=${one}&new=OPS`}>+ OPS assessment</Link><Link className="btn primary" href={`/np/assess?entity=${one}&new=CAMO`}>+ CAMO assessment</Link></>}
          {own && <><Link className="btn" href={`/np/assess?entity=${one}&new=OPS&own=1`}>Pre-fill mine (OPS)</Link><Link className="btn" href={`/np/assess?entity=${one}&new=CAMO&own=1`}>Pre-fill mine (CAMO)</Link></>}</> : undefined} />
      {scope.length > 1 && <div className="chips mb-4 flex items-center gap-2">{scope.map((e) => <Link key={e} href={`/np/assess?entity=${e}`} className={"ent " + e}>{e}</Link>)}<span className="mini">pick an entity to open a sheet</span></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Metric label="To validate" value={toValidate.length} hint="pre-filled, waiting for Compliance" tone={toValidate.length ? "amber" : "none"} />
        <Metric label="Being pre-filled" value={withPerson.length} hint="with the person" tone={withPerson.length ? "info" : "none"} />
        <Metric label="In force" value={inForce.length} hint={dueSoon.length ? `${dueSoon.length} due within 90 days${late.length ? ", " + late.length + " late" : ""}` : "latest signed sheet per person and form"} tone={late.length ? "red" : dueSoon.length ? "amber" : inForce.length ? "green" : "none"} />
        {desk ? <Metric label="Post holders never assessed" value={never.length} hint={`of ${holders.length} holders and deputies`} tone={never.length ? "amber" : "green"} /> : <Metric label="Signed" value={signed.length} hint="your sheets" tone="info" />}
      </div>

      {F && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">{ownNew ? "My assessment" : "New assessment"}, {F.ref}</span><span className="mini">{F.edition}{F.basis ? ", " + F.basis : ""}</span></div>
          <form action={createAssessment} className="cb">
            <input type="hidden" name="form" value={F.key} /><input type="hidden" name="entity" value={newEnt} />{ownNew && <input type="hidden" name="own" value="1" />}
            {sp.err && <p className="mini red mb-2">{ownNew ? "Tick at least one function." : "Name the person and tick at least one function."}</p>}
            <div className="flex flex-wrap gap-3 items-end">
              {!ownNew && <><label style={{ width: 280 }}><span className="mini">Person (S.A.M. account: they can pre-fill)</span><select name="person_id" className="inp" defaultValue={prePerson?.id ?? ""}><option value="">— not in the list —</option>{people.filter((p) => p.id !== me && (p.home_entity === newEnt || (p.entities ?? []).includes(newEnt))).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
                <label style={{ width: 240 }}><span className="mini">or name, when the person has no account yet</span><input name="person_name" className="inp" placeholder="First LAST" defaultValue={prePerson ? "" : preName} /></label></>}
              <label style={{ width: 260 }}><span className="mini">Position</span><input name="position" className="inp" defaultValue={sp.position ?? ""} placeholder="as on the form" /></label>
              {!ownNew && <label style={{ width: 160 }}><span className="mini">Date of assessment</span><input name="assessed_on" type="date" className="inp" /></label>}
              <label style={{ width: 200 }}><span className="mini">Assessment</span><select name="kind" className="inp" defaultValue="recurrent"><option value="initial">Initial (hiring, new position)</option><option value="recurrent">Recurrent</option></select></label>
            </div>
            <div className="mt-3"><span className="mini">Functions assessed (the columns of the form): the points of the sheet follow from them</span>
              <div className="flex flex-wrap gap-4 mt-1">{F.functions.map((f) => <label key={f.code} className="flex items-center gap-2"><input type="checkbox" name="functions" value={f.code} defaultChecked={preFn.includes(f.code)} />{f.label}</label>)}</div>
            </div>
            <div className="mt-4 flex gap-2 items-center"><button className="btn primary" type="submit">Open the sheet</button><Link className="btn" href={`/np/assess?entity=${newEnt}`}>Cancel</Link>
              <span className="mini">{ownNew ? "You pre-fill it and send it to Compliance, which validates and signs." : "The person finds the sheet here and pre-fills it; you validate and sign."}</span></div>
          </form>
        </section>
      )}

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Assessments</span><span className="mini">{all.length}</span></div>
        <table className="tbl">
          <thead><tr>{!one && <th>Entity</th>}<th>Person</th><th>Form</th><th>Functions</th><th>Assessed on</th><th>Assessor</th><th>Fit for position</th><th>Next due</th><th /></tr></thead>
          <tbody>
            {all.map((a) => { const superseded = a.status === "signed" && !inForce.includes(a); const mineToFill = a.status === "draft" && a.person_id === me;
              return (
                <tr key={a.id} style={superseded ? { opacity: 0.6 } : undefined}>
                  {!one && <td><span className={"ent " + a.entity}>{a.entity}</span></td>}
                  <td><Link className="font-semibold underline" href={`/np/assess/${a.id}`}>{a.person_name}</Link><div className="mini">{a.position ?? ""}</div></td>
                  <td className="mono">{a.form_ref}<div className="mini">{a.kind}</div></td>
                  <td>{a.functions.join(", ")}</td>
                  <td className="mono">{fr(a.assessed_on)}</td>
                  <td>{a.assessor_name ?? <span className="mini">Compliance</span>}</td>
                  <td>{state(a)}{superseded && <div className="mini">replaced by a later sheet</div>}</td>
                  <td className="mono">{a.status === "signed" && !superseded ? <span className={a.next_due && a.next_due < t0 ? "red" : ""}>{fr(a.next_due)}</span> : ""}</td>
                  <td className="text-right"><Link className={mineToFill || (desk && a.status === "submitted") ? "btn" : "mini underline"} href={`/np/assess/${a.id}`}>{mineToFill ? "Pre-fill" : desk && a.status === "submitted" ? "Validate" : "Open"}</Link></td>
                </tr>); })}
            {!all.length && <tr><td colSpan={9} className="p-5 text-slate6">No assessment yet{one ? (desk ? ": open one with the buttons above, or from a post holder below." : own ? ": pre-fill yours with the buttons above." : ".") : "."}</td></tr>}
          </tbody>
        </table>
      </section>

      {desk && holders.length > 0 && (
        <section className="card">
          <div className="ch"><span className="eyebrow">Post holders and deputies</span><span className="mini">from Posts &amp; org chart: what S.A.M. holds for each</span></div>
          <table className="tbl">
            <thead><tr>{!one && <th>Entity</th>}<th>Post</th><th>Holder</th><th>Last assessment</th><th>Fit for position</th><th>Next due</th><th /></tr></thead>
            <tbody>{holders.map((h, i) => { const a = lastOf(h.entity, h.name); const d = openOf(h.entity, h.name); const o = a?.outcome ? OUTCOME[a.outcome] : null; const form = formOfPost(h.code);
              return (
                <tr key={i}>
                  {!one && <td><span className={"ent " + h.entity}>{h.entity}</span></td>}
                  <td className="mono">{h.code}{h.deputy ? " (deputy)" : ""}<div className="mini" style={{ fontFamily: "inherit" }}>{h.title}</div></td>
                  <td><b>{h.name}</b></td>
                  <td className="mono">{a ? <Link className="underline" href={`/np/assess/${a.id}`}>{fr(a.assessed_on)}</Link> : <span className="pill amber">none in S.A.M.</span>}</td>
                  <td>{o ? <span className={"pill " + o[1]}>{o[0]}</span> : ""}</td>
                  <td className="mono">{a ? <span className={a.next_due && a.next_due < t0 ? "red" : ""}>{fr(a.next_due)}</span> : ""}</td>
                  <td className="text-right">{d ? <Link className="btn" href={`/np/assess/${d.id}`}>{d.status === "submitted" ? "Validate" : "Open the sheet"}</Link> : <Link className="btn" href={`/np/assess?entity=${h.entity}&new=${form}&name=${encodeURIComponent(h.name)}&position=${encodeURIComponent(h.title + (h.deputy ? ", deputy" : ""))}&fn=${fnOfPost(h.code)}`}>Start</Link>}</td>
                </tr>); })}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
