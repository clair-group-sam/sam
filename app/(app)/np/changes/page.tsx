import Link from "next/link";
import { fr as frd } from "@/lib/dates";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { postsOf } from "@/lib/np";
import { STAGE_LABEL, STAGE_TONE, today, type Stage } from "@/lib/authority";
import { applyChange, cancelChange, createChange, linkApplication, markAccepted, openApplication } from "./actions";

type Sp = { entity?: string; err?: string; new?: string; post?: string };
type Change = { id: string; entity: string; post_code: string; post_title: string | null; seat: "holder" | "deputy"; from_name: string | null; to_name: string | null; effective_on: string | null; reason: string | null;
  acceptance: "required" | "not_required"; authority_file_id: string | null; status: "open" | "applied" | "cancelled"; applied_as: string | null; applied_at: string | null; cancel_note: string | null; created_at: string };
type FileRow = { id: string; title: string; stage: Stage; portal_ref: string | null; submitted_at: string | null; np_post_code: string | null; type_code: string };
const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "—");
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
const ACCEPTED: Stage[] = ["approved", "published", "closed"];
const AS: Record<string, [string, string]> = { accepted: ["accepted by the authority", "green"], pending: ["acceptance pending", "amber"], not_required: ["no acceptance required", ""] };
/** Notice to the authority before a planned change of nominated person, as the regulation reads (Easy Access Rules in S.A.M., 19/11/2026):
 *  AMC1 ORO.GEN.130(b) 20 days · AMC1 CAMO.A.130(b) 20 working days · AMC1 ORA.GEN.130(b) 10 days ·
 *  CAO.A.105(a)(2) before the change takes place, no number of days. Unforeseen changes: at the earliest opportunity. */
type Notice = { days: number; working: boolean; ref: string; text: string };
const AIRWORTHINESS = /^(D?NPCA|CAM|CAMO|ARS)/;
function noticeFor(entity: string, post: string): Notice | null {
  if (entity === "ASJMT" && AIRWORTHINESS.test(post.toUpperCase())) return { days: 20, working: true, ref: "AMC1 CAMO.A.130(b)", text: "20 working days" };
  if (entity === "ASJMT" || entity === "ASJFR") return { days: 20, working: false, ref: "AMC1 ORO.GEN.130(b)", text: "20 days" };
  if (entity === "ASFFR") return { days: 10, working: false, ref: "AMC1 ORA.GEN.130(b)", text: "10 days" };
  if (entity === "ASTFR") return { days: 0, working: false, ref: "CAO.A.105(a)(2)", text: "before the change takes place" };
  return null;
}
const RULES: Record<string, string> = {
  ASJMT: "AMC1 ORO.GEN.130(b): at least 20 days before; airworthiness posts, AMC1 CAMO.A.130(b): at least 20 working days before",
  ASJFR: "AMC1 ORO.GEN.130(b): at least 20 days before", ASFFR: "AMC1 ORA.GEN.130(b): at least 10 days before", ASTFR: "CAO.A.105(a)(2): notified before the change takes place",
};
/** Monday to Friday between two dates (public holidays are not counted out). */
function workingDays(from: string, to: string): number { let n = 0; const d = new Date(from + "T00:00:00Z"); const end = Date.parse(to + "T00:00:00Z"); const step = d.getTime() <= end ? 1 : -1;
  while (d.getTime() !== end) { if (step > 0) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; d.setUTCDate(d.getUTCDate() + 1); } else { d.setUTCDate(d.getUTCDate() - 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; } } return n; }

/* NP-02 · NP management › Changes & approvals: changes of holder or deputy, their CAA application, and the day they take effect. */
export default async function Changes({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams; const t0 = today();
  const ents = s.group ? ENTS4 : s.entities;
  const db = supabaseAdmin();
  let entity = sp.entity && ents.includes(sp.entity) ? sp.entity : s.entity !== "ALL" && ents.includes(s.entity) ? s.entity : "";
  if (!entity) { const { data: wp } = await db.from("np_posts").select("entity").in("entity", ents); const has = new Set(((wp ?? []) as { entity: string }[]).map((x) => x.entity)); entity = ents.find((e) => has.has(e)) ?? ents[0]; }
  const cmm = isCmm(s);
  const [posts, { data: ch }, { data: fl }, { data: ppl }] = await Promise.all([
    postsOf(db, entity),
    db.from("np_changes").select("*").eq("entity", entity).order("created_at", { ascending: false }).limit(500),
    db.from("authority_files").select("id,title,stage,portal_ref,submitted_at,np_post_code,type_code").eq("entity", entity).eq("type_code", "NP").order("created_at", { ascending: false }).limit(200),
    cmm ? db.from("people").select("id,display_name,entities,home_entity").order("display_name").limit(1500) : Promise.resolve({ data: [] }),
  ]);
  const changes = (ch ?? []) as Change[]; const files = (fl ?? []) as FileRow[];
  const fileOf = (c: Change) => files.find((f) => f.id === c.authority_file_id) ?? null;
  const open = changes.filter((c) => c.status === "open").sort((a, b) => (a.effective_on ?? "9").localeCompare(b.effective_on ?? "9"));
  const done = changes.filter((c) => c.status !== "open");
  const ready = (c: Change) => c.acceptance === "not_required" || (!!fileOf(c) && ACCEPTED.includes(fileOf(c)!.stage));
  const atAuthority = open.filter((c) => { const f = fileOf(c); return f && ["submitted", "remarks"].includes(f.stage); });
  const toApply = open.filter((c) => ready(c));
  const pendingPosts = posts.filter((p) => p.status === "pending");
  const people = ((ppl ?? []) as { id: string; display_name: string; entities: string[] | null; home_entity: string | null }[]).filter((p) => p.home_entity === entity || (p.entities ?? []).includes(entity));
  const linked = new Set(changes.map((c) => c.authority_file_id).filter(Boolean));
  const freeFiles = files.filter((f) => !linked.has(f.id) && !["closed"].includes(f.stage));
  const rule = RULES[entity];

  return (
    <>
      <PageHeader eyebrow="NP management, Changes & approvals" title={`Changes & approvals, ${ENT[entity]?.name ?? entity}`}
        sub="A change of holder or deputy is prepared here, followed with its CAA application, and applied to the post on the day it takes effect. Until then, Posts & org chart stays as it is." />
      {ents.length > 1 && s.entity === "ALL" && <div className="chips mb-4 flex items-center gap-2">{ents.map((e) => <Link key={e} href={`/np/changes?entity=${e}`} className={"ent " + e + (e === entity ? " on" : "")}>{e}</Link>)}</div>}
      {sp.err === "same" && <p className="mini red mb-3">The new name is the one already on the post: nothing to change.</p>}
      {sp.err === "file" && <p className="mini red mb-3">The CAA application could not be opened (the type “NP” is not offered for this entity): open it from Projects › CAA applications and link it here.</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Metric label="Changes in progress" value={open.length} tone={open.length ? "info" : "none"} hint="prepared, not applied" />
        <Metric label="With the authority" value={atAuthority.length} tone={atAuthority.length ? "amber" : "none"} hint="application submitted" />
        <Metric label="Ready to apply" value={toApply.length} tone={toApply.length ? "amber" : "none"} hint="accepted, or no acceptance required" />
        <Metric label="Posts with acceptance pending" value={pendingPosts.length} tone={pendingPosts.length ? "amber" : "green"} hint={pendingPosts.map((p) => p.code).join(", ") || "every post accepted"} />
      </div>

      {cmm && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">Prepare a change</span>{rule && <span className="mini">Planned change, notice to the authority. {rule}</span>}</div>
          {posts.length ? (
            <form action={createChange} className="cb">
              <input type="hidden" name="entity" value={entity} />
              <div className="flex flex-wrap gap-3 items-end">
                <label style={{ width: 300 }}><span className="mini">Post</span><select name="post_code" className="inp" defaultValue={sp.post ?? ""} required>{posts.map((p) => <option key={p.code} value={p.code}>{p.code}, {p.holder_name ?? "vacant"}{p.deputy_name ? ` (deputy ${p.deputy_name})` : ""}</option>)}</select></label>
                <label style={{ width: 130 }}><span className="mini">Seat</span><select name="seat" className="inp" defaultValue="holder"><option value="holder">Holder</option><option value="deputy">Deputy</option></select></label>
                <label style={{ width: 240 }}><span className="mini">New person (S.A.M. account)</span><select name="to_person" className="inp" defaultValue=""><option value="">— not in the list —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
                <label style={{ width: 220 }}><span className="mini">or name (empty: the seat becomes vacant)</span><input name="to_name" className="inp" placeholder="First LAST" /></label>
                <label style={{ width: 160 }}><span className="mini">Takes effect on</span><input name="effective_on" type="date" className="inp" required /></label>
                <label style={{ width: 220 }}><span className="mini">Acceptance by the authority</span><select name="acceptance" className="inp" defaultValue="required"><option value="required">required (Form 4 / Form 2)</option><option value="not_required">not required</option></select></label>
              </div>
              <label className="block mt-3"><span className="mini">Reason</span><input name="reason" className="inp" placeholder="departure, reorganisation, new deputy…" /></label>
              <div className="mt-3"><button className="btn primary" type="submit">Prepare the change</button></div>
            </form>
          ) : <div className="cb mini">No post defined for {ENT[entity]?.name ?? entity}: create them in <Link className="underline" href={`/np/over?entity=${entity}`}>Posts &amp; org chart</Link>.</div>}
        </section>
      )}

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">In progress</span><span className="mini">{open.length}</span></div>
        <table className="tbl">
          <thead><tr><th>Post</th><th>Change</th><th>Takes effect</th><th>CAA application</th>{cmm && <th />}</tr></thead>
          <tbody>
            {open.map((c) => { const f = fileOf(c); const d = c.effective_on ? days(c.effective_on, t0) : null; const submitted = frd(f?.submitted_at) ?? null;
              const nt = noticeFor(entity, c.post_code); const lead = (from: string) => (nt?.working ? workingDays(from, c.effective_on!) : days(c.effective_on!, from));
              const short = !!nt && c.acceptance === "required" && !!c.effective_on && (nt.days ? lead(submitted ?? t0) < nt.days : !submitted && d !== null && d <= 0);
              return (
                <tr key={c.id}>
                  <td className="mono">{c.post_code}{c.seat === "deputy" ? " (deputy)" : ""}<div className="mini" style={{ fontFamily: "inherit" }}>{c.post_title}</div></td>
                  <td>{c.from_name ?? "vacant"} → <b>{c.to_name ?? "vacant"}</b>{c.reason && <div className="mini">{c.reason}</div>}</td>
                  <td className="mono">{fr(c.effective_on)}<div className={"mini" + (d !== null && d < 0 ? " red" : "")}>{d === null ? "" : d < 0 ? `${-d} d ago, not applied` : d === 0 ? "today" : `in ${d} d`}</div></td>
                  <td>{c.acceptance === "not_required" ? <span className="pill">no acceptance required</span>
                    : f ? <><Link className="underline" href={`/proj/auth/${f.id}`}>{f.portal_ref ?? f.title}</Link> <span className={"pill " + STAGE_TONE[f.stage]}>{STAGE_LABEL[f.stage]}</span>{submitted && <div className="mini">submitted {fr(submitted)}{c.effective_on ? `, ${days(c.effective_on, submitted)} d before` : ""}</div>}</>
                    : <span className="pill amber">no application yet</span>}
                    {short && nt && <div className="mini red">{nt.days ? `${Math.max(lead(submitted ?? t0), 0)} ${nt.working ? "working days" : "days"} of notice, ${nt.ref} asks for at least ${nt.text}` : `not notified yet: ${nt.ref}, ${nt.text}`}</div>}
                    {cmm && c.acceptance === "required" && !f && <div className="flex flex-wrap gap-2 mt-2 items-center">
                      <form action={openApplication}><input type="hidden" name="id" value={c.id} /><button className="btn" type="submit">Open the CAA application</button></form>
                      {freeFiles.length > 0 && <form action={linkApplication} className="flex gap-1 items-center"><input type="hidden" name="id" value={c.id} /><select name="file_id" className="inp" style={{ marginTop: 0, width: 220 }}>{freeFiles.map((x) => <option key={x.id} value={x.id}>{x.portal_ref ?? x.title}</option>)}</select><button className="btn" type="submit">Link</button></form>}
                    </div>}</td>
                  {cmm && <td className="text-right" style={{ width: 250 }}>
                    <form action={applyChange} className="mb-1"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="as" value={ready(c) ? "accepted" : "pending"} />
                      <button className={"btn" + (ready(c) ? " primary" : "")} type="submit">{ready(c) ? "Apply to the post" : "Apply now, acceptance pending"}</button></form>
                    <form action={cancelChange}><input type="hidden" name="id" value={c.id} /><button className="mini underline" type="submit">Cancel the change</button></form>
                  </td>}
                </tr>); })}
            {!open.length && <tr><td colSpan={5} className="p-5 text-slate6">No change in progress.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Approvals today</span><span className="mini">from Posts &amp; org chart</span></div>
        <table className="tbl">
          <thead><tr><th>Post</th><th>Holder</th><th>Deputy</th><th>Authority</th><th>Since</th><th>CAA applications of the post</th></tr></thead>
          <tbody>{posts.map((p) => { const pf = files.filter((f) => f.np_post_code === p.code); const a = AS[p.status] ?? [p.status, ""];
            return (<tr key={p.id}><td className="mono">{p.code}<div className="mini" style={{ fontFamily: "inherit" }}>{p.title}</div></td><td><b>{p.holder_name ?? "vacant"}</b></td><td>{p.deputy_name ?? <span className="mini">—</span>}</td>
              <td><span className={"pill " + a[1]}>{a[0]}</span></td><td className="mono">{fr(p.since)}</td>
              <td>{pf.length ? pf.slice(0, 3).map((f) => <div key={f.id}><Link className="underline" href={`/proj/auth/${f.id}`}>{f.portal_ref ?? f.title}</Link> <span className={"pill " + STAGE_TONE[f.stage]}>{STAGE_LABEL[f.stage]}</span></div>) : <span className="mini">—</span>}</td></tr>); })}
            {!posts.length && <tr><td colSpan={6} className="p-5 text-slate6">No post yet.</td></tr>}</tbody>
        </table>
      </section>

      {done.length > 0 && (
        <section className="card">
          <div className="ch"><span className="eyebrow">History</span><span className="mini">{done.length}</span></div>
          <table className="tbl">
            <thead><tr><th>Post</th><th>Change</th><th>Effective</th><th>Outcome</th>{cmm && <th />}</tr></thead>
            <tbody>{done.map((c) => { const f = fileOf(c); const a = AS[c.applied_as ?? ""];
              const still = c.status === "applied" && c.seat === "holder" && c.applied_as === "pending" && posts.find((p) => p.code === c.post_code)?.holder_name === c.to_name;
              return (<tr key={c.id}><td className="mono">{c.post_code}{c.seat === "deputy" ? " (deputy)" : ""}</td><td>{c.from_name ?? "vacant"} → <b>{c.to_name ?? "vacant"}</b>{c.reason && <div className="mini">{c.reason}</div>}</td><td className="mono">{fr(c.effective_on)}</td>
                <td>{c.status === "cancelled" ? <><span className="pill">cancelled</span>{c.cancel_note && <div className="mini">{c.cancel_note}</div>}</> : <><span className={"pill " + (a?.[1] ?? "green")}>applied {fr(c.applied_at)}{a ? ", " + a[0] : ""}</span>{f && <div className="mini"><Link className="underline" href={`/proj/auth/${f.id}`}>{f.portal_ref ?? f.title}</Link></div>}</>}</td>
                {cmm && <td className="text-right">{still && <form action={markAccepted}><input type="hidden" name="id" value={c.id} /><button className="btn" type="submit">Acceptance received</button></form>}</td>}</tr>); })}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
