import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { MOC_CATEGORIES, MOC_STATUS, mayApproveMoc, mayEditRisk, tolerability } from "@/lib/risk";
import { RiskPill } from "@/components/RiskMatrix";
import { createHazard, discardHazard, keepHazard, mocStep, proposeHazards, updateMoc } from "../../risk/actions";

export const maxDuration = 60;
type Moc = { id: string; entity: string; ref: string; title: string; description: string | null; category: string; status: string; owner_role: string | null; target_date: string | null; project_id: string | null; authority_file_id: string | null; decision: string | null; approved_at: string | null };
type H = { id: string; ref: string; title: string; consequence: string | null; proposed: boolean; lik_before: number | null; sev_before: string | null; lik_after: number | null; sev_after: string | null; hazard_mitigations: { text: string; existing: boolean; owner_role: string | null; done_at: string | null }[] };
type E = { id: number; at: string; kind: string; note: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Safety › MOC: the change, its risk assessment (hazards rated before / after, SAM can propose them), SM approval, implementation, closure. */
export default async function MocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = await db.from("mocs").select("*").eq("id", id).maybeSingle();
  const m = data as Moc | null;
  if (!m || !s.entities.includes(m.entity)) notFound();
  const [{ data: hz }, { data: ev }, { data: pj }] = await Promise.all([
    db.from("hazards").select("id,ref,title,consequence,proposed,lik_before,sev_before,lik_after,sev_after,hazard_mitigations(text,existing,owner_role,done_at)").eq("moc_id", id).order("created_at"),
    db.from("risk_events").select("id,at,kind,note").eq("moc_id", id).order("at"),
    m.project_id ? db.from("projects").select("id,title").eq("id", m.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const hazards = (hz ?? []) as unknown as H[]; const events = (ev ?? []) as E[]; const project = pj as { id: string; title: string } | null;
  const kept = hazards.filter((h) => !h.proposed);
  const blockers = [!kept.length && "no hazard kept yet", hazards.some((h) => h.proposed) && "proposed hazards to keep or discard", kept.some((h) => !h.lik_after) && "hazards without a residual rating", kept.some((h) => tolerability(h.lik_after, h.sev_after) === "intolerable") && "a hazard stays intolerable"].filter(Boolean) as string[];
  const edit = mayEditRisk(s) && ["draft", "assessment"].includes(m.status);
  return (
    <>
      <PageHeader eyebrow={`Safety · MOC · ${m.ref}`} title={m.title}
        tag={<span className="pill">{MOC_STATUS[m.status]?.[0] ?? m.status}</span>}
        sub={`${m.entity} · ${MOC_CATEGORIES[m.category] ?? m.category} · owner ${m.owner_role ?? "—"}${m.target_date ? ` · target ${m.target_date}` : ""}`}
        right={<>{project && <Link className="btn" href={`/proj/boards/${project.id}`}>Project</Link>}{m.authority_file_id && <Link className="btn" href={`/proj/auth/${m.authority_file_id}`}>Authority file</Link>}<Link className="btn" href="/safe/moc">All MOCs</Link></>} />
      <div className="repgrid2">
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Risk assessment</span><span className="mini">{kept.length} hazard{kept.length === 1 ? "" : "s"}{hazards.length - kept.length ? ` · ${hazards.length - kept.length} proposed by SAM` : ""}</span></div>
            <table className="tbl"><tbody>
              {hazards.map((h) => (
                <tr key={h.id} className={h.proposed ? "hz-proposed" : ""}>
                  <td style={{ width: 110 }} className="mono"><Link className="underline" href={`/safe/risk/${h.id}`}>{h.ref}</Link>{h.proposed && <div className="mini">proposed</div>}</td>
                  <td><Link href={`/safe/risk/${h.id}`}><b>{h.title}</b></Link>{h.consequence && <div className="mini">{h.consequence}</div>}
                    {h.hazard_mitigations.length > 0 && <ul className="mini mt-1">{h.hazard_mitigations.map((x, i) => <li key={i}>{x.existing ? "✓ in place" : x.done_at ? "✓ done" : "→"} {x.text}{x.owner_role ? ` (${x.owner_role})` : ""}</li>)}</ul>}</td>
                  <td style={{ width: 110 }}><RiskPill lik={h.lik_before} sev={h.sev_before} /> → <RiskPill lik={h.lik_after} sev={h.sev_after} /></td>
                  <td style={{ width: 150 }} className="text-right">{h.proposed && edit && <span className="flex gap-1 justify-end"><form action={keepHazard}><input type="hidden" name="id" value={h.id} /><button className="btn">Keep</button></form><form action={discardHazard}><input type="hidden" name="id" value={h.id} /><button className="btn">✕</button></form></span>}</td>
                </tr>))}
              {!hazards.length && <tr><td className="p-4 mini">No hazard yet. Add them below, or let SAM propose a first list from the description of the change.</td></tr>}
            </tbody></table>
            {edit && (
              <div className="cb">
                <form action={createHazard} className="flex gap-2 mb-3"><input type="hidden" name="entity" value={m.entity} /><input type="hidden" name="moc_id" value={m.id} /><input type="hidden" name="stay" value="1" />
                  <input name="title" className="inp flex-1" placeholder="Add a hazard of this change" required style={{ marginTop: 0 }} /><button className="btn">Add</button></form>
                <form action={proposeHazards}><input type="hidden" name="id" value={m.id} /><button className="btn">🤝 Ask SAM to propose hazards</button> <span className="mini">rated before / after with mitigations and owners — each stays “proposed” until you keep it</span></form>
              </div>
            )}
          </section>
          <section className="card">
            <div className="ch"><span className="eyebrow">Journal</span></div>
            <div className="cb"><ul className="journal">{events.map((e) => <li key={e.id}><span className="mini mono mr-2">{when(e.at)}</span><b>{e.kind}</b> — {e.note}</li>)}</ul></div>
          </section>
        </div>
        <div>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">The change</span></div>
            <form action={updateMoc} className="cb grid gap-2"><input type="hidden" name="id" value={m.id} />
              <label><span className="mini">Title</span><input name="title" className="inp" defaultValue={m.title} disabled={!edit} /></label>
              <label><span className="mini">What changes, why, from when, who is affected</span><textarea name="description" className="inp" rows={6} defaultValue={m.description ?? ""} disabled={!edit} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="mini">Category</span><select name="category" className="inp" defaultValue={m.category} disabled={!edit}>{Object.entries(MOC_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span className="mini">Target date</span><input type="date" name="target_date" className="inp" defaultValue={m.target_date ?? ""} disabled={!edit} /></label>
              </div>
              {edit && <div className="flex justify-end"><button className="btn">Save</button></div>}
            </form>
          </section>
          <section className="card">
            <div className="ch"><span className="eyebrow">Decision</span></div>
            <div className="cb">
              {["draft", "assessment"].includes(m.status) && (mayApproveMoc(s) ? (
                blockers.length ? <p className="mini">Approval possible once: {blockers.join(" · ")}.</p> : (
                  <form action={mocStep} className="grid gap-2"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="to" value="approved" />
                    <input name="decision" className="inp" placeholder="Conditions / comment (optional)" /><button className="btn primary">Approve the change (SM)</button></form>)
              ) : <p className="mini">The Safety Manager approves the change once the risk assessment is complete.</p>)}
              {m.status === "approved" && <><p className="mb-2">Approved {m.approved_at ? when(m.approved_at) : ""}{m.decision ? ` — ${m.decision}` : ""}.</p><form action={mocStep}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="to" value="implemented" /><button className="btn primary">Mark as implemented</button></form></>}
              {m.status === "implemented" && <form action={mocStep}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="to" value="closed" /><button className="btn primary">Close the MOC</button></form>}
              {["draft", "assessment", "approved"].includes(m.status) && mayEditRisk(s) && <form action={mocStep} className="mt-3"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="to" value="cancelled" /><button className="mini underline">Cancel this MOC</button></form>}
              {["closed", "cancelled"].includes(m.status) && <p className="mini">{MOC_STATUS[m.status][0]}.</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
