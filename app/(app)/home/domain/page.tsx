import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, basePost } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { ballOf, STAGE_LABEL, STAGE_TONE, today, type Stage } from "@/lib/authority";
import { OPEN_STATUSES, STATUS_LABEL, CMM_TURN } from "@/lib/findings";
import { loadDeadlines, DUE_KIND } from "@/lib/deadlines";
import { myInbox } from "@/lib/inbox";
import { ASSESS_ENTITIES } from "@/lib/competency";

const fr = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "—");
const NOT_POSTS = ["USER", "SUPERADMIN", "CREW", "EXT"];

/* HOME-02 · Home › My domain: what belongs to the posts I hold (or deputise) — findings, safety actions, CAA applications, manuals,
 * and the dates that come with them. One entity at a time; everything is a link to the page where the work is done. */
export default async function MyDomain() {
  const s = await getSession(); if (!s) redirect("/login");
  const ents = s.entity === "ALL" ? ENTS4.filter((e) => s.group || s.entities.includes(e)) : [s.entity];
  const posts = [...new Set(s.roles.map(basePost).filter((r) => !NOT_POSTS.includes(r)))];
  const mine = (role: string | null | undefined) => !!role && posts.includes(basePost(role));
  const me = s.person?.id ?? "-"; const t0 = today(); const db = supabaseAdmin();
  const [{ data: fnd }, { data: act }, { data: fil }, { data: man }, dues, inbox, { data: asm }] = await Promise.all([
    db.from("findings").select("id,entity,number,title,status,due,level,owner_role,owner_person").in("entity", ents).in("status", OPEN_STATUSES).limit(2000),
    db.from("safety_actions").select("id,entity,number,title,status,due,owner_role").in("entity", ents).in("status", ["open", "in_progress"]).limit(2000),
    db.from("authority_files").select("id,entity,title,stage,target_date,portal_ref,owner_role,next_task,ball_override").in("entity", ents).not("stage", "in", "(closed,standby)").limit(1000),
    db.from("manuals").select("id,entity,code,title,owner_role").in("entity", ents).limit(2000),
    loadDeadlines(db, ents, { to: new Date(Date.parse(t0) + 90 * 86_400_000).toISOString().slice(0, 10) }),
    myInbox(s),
    ents.some((e) => ASSESS_ENTITIES.includes(e)) ? db.from("competency_assessments").select("id,entity,status,next_due,assessed_on").eq("person_id", me).order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
  ]);
  type F = { id: string; entity: string; number: string; title: string; status: string; due: string | null; level: string; owner_role: string | null; owner_person: string | null };
  type A = { id: string; entity: string; number: string; title: string; status: string; due: string | null; owner_role: string | null };
  type C = { id: string; entity: string; title: string; stage: Stage; target_date: string | null; portal_ref: string | null; owner_role: string | null; next_task: string | null; ball_override: "us" | "authority" | null };
  type M = { id: string; entity: string; code: string; title: string; owner_role: string };
  const findings = ((fnd ?? []) as F[]).filter((f) => (f.owner_person ? f.owner_person === me : mine(f.owner_role))).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  const actions = ((act ?? []) as A[]).filter((a) => mine(a.owner_role)).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  const files = ((fil ?? []) as C[]).filter((f) => mine(f.owner_role)).sort((a, b) => (a.target_date ?? "9").localeCompare(b.target_date ?? "9"));
  const manuals = ((man ?? []) as M[]).filter((m) => mine(m.owner_role));
  const { data: rv } = manuals.length ? await db.from("revisions").select("id,manual_id,rev,step").in("manual_id", manuals.map((m) => m.id)).not("step", "in", "(published,repository)") : { data: [] };
  const drafts = (rv ?? []) as { id: string; manual_id: string; rev: string; step: string }[];
  const myDues = dues.filter((d) => mine(d.who)); const late = myDues.filter((d) => d.state === "late");
  const myTurn = findings.filter((f) => !CMM_TURN.includes(f.status) && f.status !== "accepted");
  const sheet = ((asm ?? []) as { id: string; entity: string; status: string; next_due: string | null }[]).find((a) => ents.includes(a.entity)) ?? null;
  const multi = ents.length > 1; const entCell = (e: string) => multi ? <td style={{ width: 70 }}><span className={"ent " + e}>{e}</span></td> : null;

  return (
    <>
      <PageHeader eyebrow="Home, My domain" title="My domain" sub={posts.length ? `What belongs to ${posts.join(", ")}${multi ? "" : ", " + (ENT[ents[0]]?.name ?? ents[0])}: findings, safety actions, CAA applications, manuals, and their dates.` : "No post is attached to your account yet: ask Compliance to add it in Users."}
        right={<><Link className="btn" href="/home/tasks">Inbox ({inbox.length})</Link><Link className="btn primary" href="/safe/new">+ Safety report</Link></>} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Metric label="Late" value={late.length} tone={late.length ? "red" : "green"} hint={late.length ? "dates of my domain already passed" : "nothing late"} />
        <Metric label="Findings" value={findings.length} tone={myTurn.length ? "amber" : findings.length ? "info" : "none"} hint={myTurn.length ? `${myTurn.length} waiting for my answer` : "none waiting for me"} />
        <Metric label="Safety actions" value={actions.length} tone={actions.some((a) => a.due && a.due < t0) ? "red" : actions.length ? "info" : "none"} hint="open, mine" />
        <Metric label="CAA applications" value={files.length} tone={files.some((f) => ballOf(f) === "us") ? "amber" : files.length ? "info" : "none"} hint={`${files.filter((f) => ballOf(f) === "us").length} with us, ${files.filter((f) => ballOf(f) === "authority").length} with the authority`} />
        <Metric label="My manuals" value={manuals.length} tone={drafts.length ? "amber" : manuals.length ? "info" : "none"} hint={drafts.length ? `${drafts.length} revision${drafts.length === 1 ? "" : "s"} in progress` : "no revision in progress"} />
      </div>

      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Dates of my domain, next 90 days</span><Link className="mini underline" href="/dash/due">every deadline</Link></div>
        <table className="tbl"><tbody>
          {myDues.slice(0, 15).map((d) => <tr key={d.key}>{entCell(d.entity)}<td className="mono" style={{ width: 110 }}>{fr(d.date)}<div className={"mini" + (d.state === "late" ? " red" : "")}>{d.days < 0 ? `${-d.days} d late` : d.days === 0 ? "today" : `in ${d.days} d`}</div></td>
            <td style={{ width: 170 }}><span className="pill">{DUE_KIND[d.kind].label}</span></td><td><Link className="underline" href={d.href}><b>{d.ref}</b> {d.title}</Link><div className="mini">{d.todo}</div></td></tr>)}
          {!myDues.length && <tr><td className="p-5 text-slate6">No date in the next 90 days for {posts.join(", ") || "your posts"}.</td></tr>}
        </tbody></table>
        {myDues.length > 15 && <div className="cb mini">{myDues.length - 15} more in <Link className="underline" href="/dash/due">Deadlines</Link>.</div>}
      </section>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <section className="card">
          <div className="ch"><span className="eyebrow">My findings</span><Link className="mini underline" href="/comp/find">all findings</Link></div>
          <table className="tbl"><tbody>
            {findings.slice(0, 10).map((f) => <tr key={f.id}><td className="mono" style={{ width: 150 }}><Link className="underline" href={`/comp/find/${f.id}`}>{f.number}</Link><div className="mini">level {f.level}</div></td><td>{f.title}<div className="mini">{STATUS_LABEL[f.status] ?? f.status}</div></td><td className={"mono" + (f.due && f.due < t0 ? " red" : "")} style={{ width: 100 }}>{fr(f.due)}</td></tr>)}
            {!findings.length && <tr><td className="p-5 text-slate6">No open finding on your posts.</td></tr>}
          </tbody></table>
        </section>
        <section className="card">
          <div className="ch"><span className="eyebrow">My safety actions</span><Link className="mini underline" href="/safe/actions">all actions</Link></div>
          <table className="tbl"><tbody>
            {actions.slice(0, 10).map((a) => <tr key={a.id}><td className="mono" style={{ width: 150 }}><Link className="underline" href="/safe/actions">{a.number}</Link></td><td>{a.title}<div className="mini">{a.status.replace(/_/g, " ")}</div></td><td className={"mono" + (a.due && a.due < t0 ? " red" : "")} style={{ width: 100 }}>{fr(a.due)}</td></tr>)}
            {!actions.length && <tr><td className="p-5 text-slate6">No open safety action on your posts.</td></tr>}
          </tbody></table>
        </section>
        <section className="card">
          <div className="ch"><span className="eyebrow">My CAA applications</span><Link className="mini underline" href="/proj/auth">all applications</Link></div>
          <table className="tbl"><tbody>
            {files.slice(0, 10).map((f) => <tr key={f.id}><td><Link className="underline" href={`/proj/auth/${f.id}`}><b>{f.portal_ref ?? "no reference yet"}</b></Link> {f.title}<div className="mini">{f.next_task ?? (ballOf(f) === "authority" ? "waiting for the authority" : "")}</div></td><td style={{ width: 170 }}><span className={"pill " + STAGE_TONE[f.stage]}>{STAGE_LABEL[f.stage]}</span></td><td className={"mono" + (f.target_date && f.target_date < t0 ? " red" : "")} style={{ width: 100 }}>{fr(f.target_date)}</td></tr>)}
            {!files.length && <tr><td className="p-5 text-slate6">No application in progress on your posts.</td></tr>}
          </tbody></table>
        </section>
        <section className="card">
          <div className="ch"><span className="eyebrow">My manuals</span><Link className="mini underline" href="/docs/mine">My manuals</Link></div>
          <table className="tbl"><tbody>
            {manuals.slice(0, 12).map((m) => { const d = drafts.filter((x) => x.manual_id === m.id); return <tr key={m.id}><td className="mono" style={{ width: 150 }}><Link className="underline" href={`/docs/manual/${m.id}`}>{m.code}</Link></td><td>{m.title}</td>
              <td style={{ width: 210 }}>{d.length ? d.map((x) => <Link key={x.id} className="pill amber" href={`/docs/editor/${x.id}`}>Rev {x.rev}, {x.step.replace(/_/g, " ")}</Link>) : <span className="mini">published, no revision open</span>}</td></tr>; })}
            {!manuals.length && <tr><td className="p-5 text-slate6">No manual is owned by your posts.</td></tr>}
          </tbody></table>
        </section>
      </div>

      {ents.some((e) => ASSESS_ENTITIES.includes(e)) && (
        <section className="card"><div className="cb flex flex-wrap items-center gap-3"><span className="eyebrow">My competency assessment</span>
          {sheet ? <><span className={"pill " + (sheet.status === "signed" ? (sheet.next_due && sheet.next_due < t0 ? "red" : "green") : "amber")}>{sheet.status === "signed" ? `valid until ${fr(sheet.next_due)}` : sheet.status === "submitted" ? "sent to Compliance" : "to pre-fill"}</span><Link className="btn" href={`/np/assess/${sheet.id}`}>{sheet.status === "draft" ? "Pre-fill" : "Open"}</Link></>
            : <><span className="mini">None in S.A.M. yet.</span><Link className="btn" href="/np/assess">Competency assessments</Link></>}</div></section>
      )}
    </>
  );
}
