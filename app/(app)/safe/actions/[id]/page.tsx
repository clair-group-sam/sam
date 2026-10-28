import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { ACTION_KINDS, ACTION_SOURCES, ACTION_STATUS, isLate, isOwner, mayManageActions, mayVerifyActions, type Action } from "@/lib/actions";
import { addEvidence, cancelAction, checkEffectiveness, markDone, startAction, updateAction, verifyAction } from "../actions";

type Ev = { id: string; name: string; path: string | null; size: number | null; note: string | null; added_by: string | null; added_at: string };
type J = { id: number; at: string; kind: string; note: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** One safety action: what, who, when; its evidence; done by the owner → verified by the safety desk → effectiveness; journal (append-only). */
export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("actions").select("*").eq("id", id).maybeSingle();
  const a = data as Action | null;
  if (!a || !s.entities.includes(a.entity)) notFound();
  const [{ data: ev }, { data: jr }, { data: ppl }, { data: hz }, { data: ra }, { data: fu }] = await Promise.all([
    db.from("action_evidence").select("*").eq("action_id", id).order("added_at"),
    db.from("action_events").select("id,at,kind,note").eq("action_id", id).order("at"),
    db.from("people").select("id,display_name").contains("entities", [a.entity]).order("display_name").limit(400),
    a.hazard_id ? db.from("hazards").select("id,ref,title").eq("id", a.hazard_id).maybeSingle() : Promise.resolve({ data: null }),
    a.assessment_id ? db.from("risk_assessments").select("id,number,name").eq("id", a.assessment_id).maybeSingle() : Promise.resolve({ data: null }),
    a.follow_up_id ? db.from("actions").select("id,number").eq("id", a.follow_up_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const evidence = (ev ?? []) as Ev[]; const journal = (jr ?? []) as J[]; const people = (ppl ?? []) as { id: string; display_name: string }[];
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]));
  const keys = evidence.filter((e) => e.path?.startsWith("evidence/")).map((e) => e.path!.slice(9));
  const { data: urls } = keys.length ? await db.storage.from("evidence").createSignedUrls(keys, 900) : { data: [] };
  const urlOf = new Map(((urls ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [`evidence/${u.path}`, u.signedUrl]));
  const h = hz as { id: string; ref: string; title: string } | null; const r = ra as { id: string; number: string; name: string } | null; const f = fu as { id: string; number: string } | null;
  const owner = isOwner(s, a); const manage = mayManageActions(s); const verify = mayVerifyActions(s);
  const live = ["open", "in_progress"].includes(a.status);
  const today = new Date().toISOString().slice(0, 10);
  const effDue = a.status === "verified" && !a.effectiveness;
  const in3m = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader eyebrow={`Safety · Actions · ${ENT[a.entity]?.name ?? a.entity}`} title={`${a.number} — ${a.title}`}
        tag={<span className="flex gap-2 items-center"><span className={"pill " + (ACTION_STATUS[a.status]?.[1] ?? "")}>{ACTION_STATUS[a.status]?.[0]}</span>{isLate(a, today) && <span className="pill red">overdue</span>}<span className="pill">{ACTION_KINDS[a.kind]}</span>{a.effectiveness && <span className={"pill " + (a.effectiveness === "effective" ? "green" : "red")}>{a.effectiveness === "effective" ? "effective" : "not effective"}</span>}</span>}
        sub={`Owner ${a.owner_person ? nameOf.get(a.owner_person) ?? "—" : a.owner_role ?? "—"} · due ${a.due ?? "—"} · from ${ACTION_SOURCES[a.source_kind]}`}
        right={<Link className="btn" href="/safe/actions">All actions</Link>} />
      <div className="repgrid2">
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">The action</span></div>
            <div className="cb grid gap-2">
              {a.description && <p style={{ whiteSpace: "pre-wrap" }}>{a.description}</p>}
              <p className="mini">Raised from: {a.report_id ? <Link className="underline" href={`/safe/reports/${a.report_id}`}>safety report {a.report_id}</Link> : null}{h ? <> <Link className="underline" href={`/safe/risk/${h.id}`}>{h.ref} {h.title}</Link></> : null}{r ? <> <Link className="underline" href={`/safe/risk/a/${r.id}`}>{r.number} {r.name}</Link></> : null}{!a.report_id && !h && !r ? ACTION_SOURCES[a.source_kind] : null}</p>
              {f && <p className="mini">Not effective → follow-up <Link className="underline mono" href={`/safe/actions/${f.id}`}>{f.number}</Link></p>}
            </div>
          </section>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Evidence</span><span className="mini">{evidence.length}</span></div>
            <table className="tbl"><tbody>
              {evidence.map((e) => <tr key={e.id}><td>{e.path && urlOf.get(e.path) ? <a className="underline" href={urlOf.get(e.path)} target="_blank" rel="noreferrer">{e.name}</a> : <b>{e.name}</b>}{!e.path && e.name !== "Note" && <span className="mini"> · kept on the server</span>}{e.note && <div className="mini">{e.note}</div>}</td><td className="mini" style={{ width: 170 }}>{e.added_by ? nameOf.get(e.added_by) ?? "" : ""} · {when(e.added_at)}</td></tr>)}
              {!evidence.length && <tr><td className="p-4 mini">No evidence yet — a file, the name of a document kept on the server, or a note.</td></tr>}
            </tbody></table>
            {(owner || manage) && !["verified", "cancelled"].includes(a.status) && (
              <form action={addEvidence} className="cb grid gap-2" style={{ gridTemplateColumns: "1fr 1fr auto" }}><input type="hidden" name="id" value={a.id} />
                <input type="file" name="file" className="inp" style={{ marginTop: 0 }} /><input name="evidence_name" className="inp" style={{ marginTop: 0 }} placeholder="or the document's name (on the server)" />
                <button className="btn">Add</button><input name="evidence_note" className="inp" style={{ marginTop: 0, gridColumn: "1 / span 3" }} placeholder="Note (what it shows)" /></form>)}
          </section>
          <section className="card">
            <div className="ch"><span className="eyebrow">Journal</span><span className="mini">append-only</span></div>
            <div className="cb"><ul className="journal">{journal.map((j) => <li key={j.id}><span className="mini mono mr-2">{when(j.at)}</span><b>{j.kind.replace(/_/g, " ")}</b> — {j.note}</li>)}</ul></div>
          </section>
        </div>
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Next step</span></div>
            <div className="cb grid gap-3">
              {a.status === "open" && (owner || manage) && <form action={startAction}><input type="hidden" name="id" value={a.id} /><button className="btn">Start — in progress</button></form>}
              {live && (owner || manage) && (
                <form action={markDone} className="grid gap-2"><input type="hidden" name="id" value={a.id} />
                  <span className="mini"><b>Mark it done</b> — what was done, with the evidence (or add it on the left first)</span>
                  <textarea name="done_note" className="inp" rows={3} required placeholder="What was done, when, by whom" />
                  <input type="file" name="file" className="inp" /><input name="evidence_name" className="inp" placeholder="or the document's name (on the server)" />
                  <button className="btn primary">Done — send to the safety desk</button></form>)}
              {live && !owner && !manage && <p className="mini">Waiting for the owner.</p>}
              {a.status === "done" && (verify ? (
                <form action={verifyAction} className="grid gap-2"><input type="hidden" name="id" value={a.id} />
                  <p className="mini">Done by {a.done_by ? nameOf.get(a.done_by) ?? "" : ""} · {a.done_at?.slice(0, 10)} — {a.done_note}</p>
                  <textarea name="verified_note" className="inp" rows={2} placeholder="Verification (what you checked) — or what is missing" />
                  <label><span className="mini">Check effectiveness on</span><input type="date" name="effectiveness_due" className="inp" defaultValue={in3m} /></label>
                  <select name="verdict" className="inp" defaultValue="accept"><option value="accept">Verified — close the action</option><option value="back">Not complete — send back to the owner</option></select>
                  <button className="btn primary">Confirm</button></form>
              ) : <p className="mini">Done — waiting for the safety desk&apos;s verification.</p>)}
              {a.status === "verified" && <p className="mini">✓ Verified by {a.verified_by ? nameOf.get(a.verified_by) ?? "" : ""} · {a.verified_at?.slice(0, 10)}{a.verified_note ? ` — ${a.verified_note}` : ""}</p>}
              {effDue && (verify ? (
                <form action={checkEffectiveness} className="grid gap-2"><input type="hidden" name="id" value={a.id} />
                  <span className="mini"><b>Effectiveness</b>{a.effectiveness_due ? ` — planned on ${a.effectiveness_due}` : ""}: did the action remove or reduce the problem (new reports, audits, SPI)?</span>
                  <select name="effectiveness" className="inp" defaultValue="effective"><option value="effective">Effective</option><option value="not_effective">Not effective — open a follow-up action</option></select>
                  <textarea name="effectiveness_note" className="inp" rows={2} placeholder="What shows it (required if not effective)" />
                  <button className="btn">Record</button></form>
              ) : <p className="mini">Effectiveness to check{a.effectiveness_due ? ` on ${a.effectiveness_due}` : ""}.</p>)}
              {a.effectiveness && <p className="mini">{a.effectiveness === "effective" ? "✓ Effective" : "✕ Not effective"} · {a.effectiveness_at?.slice(0, 10)}{a.effectiveness_note ? ` — ${a.effectiveness_note}` : ""}</p>}
              {a.status === "cancelled" && <p className="mini">Cancelled.</p>}
            </div>
          </section>
          {manage && !["verified", "cancelled"].includes(a.status) && (
            <section className="card mb-4">
              <div className="ch"><span className="eyebrow">Set-up</span></div>
              <form action={updateAction} className="cb grid gap-2"><input type="hidden" name="id" value={a.id} />
                <label><span className="mini">Action</span><input name="title" className="inp" defaultValue={a.title} /></label>
                <label><span className="mini">Details</span><textarea name="description" className="inp" rows={3} defaultValue={a.description ?? ""} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="mini">Owner — post</span><input name="owner_role" className="inp mono" defaultValue={a.owner_role ?? ""} /></label>
                  <label><span className="mini">or person</span><select name="owner_person" className="inp" defaultValue={a.owner_person ?? ""}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
                  <label><span className="mini">Due</span><input type="date" name="due" className="inp" defaultValue={a.due ?? ""} /></label>
                  <label><span className="mini">Type</span><select name="kind" className="inp" defaultValue={a.kind}>{Object.entries(ACTION_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                </div>
                <div className="flex justify-end"><button className="btn">Save</button></div>
              </form>
            </section>)}
          {verify && !["verified", "cancelled"].includes(a.status) && (
            <details className="card"><summary className="ch cursor-pointer"><span className="eyebrow">Cancel this action</span></summary>
              <form action={cancelAction} className="cb grid gap-2"><input type="hidden" name="id" value={a.id} /><input name="note" className="inp" required placeholder="Why (e.g. duplicate of ACT-…, no longer applicable)" /><button className="btn">Cancel the action</button></form></details>)}
        </div>
      </div>
    </>
  );
}
