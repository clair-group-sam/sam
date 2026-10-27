import Link from "next/link";
import { similarStudies, templatesFor, type Base, type Question } from "@/lib/risk-start";
import { applyBase, chooseBase, resetBase } from "@/app/(app)/safe/risk/start-actions";

type A = { id: string; entity: string; kind: string; name: string; description: string | null; prefill: { base?: Base; questions?: Question[]; applied?: boolean; blank?: boolean } | null };

/** New RA / MOC: start from a similar past study or a template (most used first), or blank; then SAM's few factual questions. */
export default async function RiskStart({ a }: { a: A }) {
  const p = a.prefill;
  if (p?.applied) return null;
  if (p?.base) return (
    <section className="card mb-4 hz-proposed">
      <div className="ch"><span className="eyebrow">Start from {p.base.label}</span><span className="mini">a few facts so SAM adapts it to this case</span></div>
      <form action={applyBase} className="cb grid gap-3"><input type="hidden" name="id" value={a.id} />
        {(p.questions ?? []).map((q) => (
          <label key={q.id} className="grid gap-1"><span>{q.label}</span>
            <span className="flex gap-2 items-center"><input name={q.id} className="inp flex-1" style={{ marginTop: 0 }} placeholder={q.hint ?? ""} /><label className="mini flex gap-1 items-center"><input type="checkbox" name={`${q.id}_dk`} /> I don&apos;t know</label></span></label>))}
        <div className="flex gap-2 items-center"><button className="btn primary">🤝 Prepare the draft</button><span className="mini">takes up to a minute — every hazard then arrives “proposed”, with what changed from the base, to review and keep one by one</span></div>
      </form>
      <form action={resetBase} className="cb pt-0"><input type="hidden" name="id" value={a.id} /><button className="linkbtn">Choose another starting point</button></form>
    </section>
  );
  const [similar, tpls] = await Promise.all([similarStudies(a.entity, a.kind, `${a.name} ${a.description ?? ""}`, a.id), templatesFor(a.entity, a.kind)]);
  const opt = (kind: string, id: string, title: React.ReactNode, sub: string) => (
    <form key={kind + id} action={chooseBase} className="flex gap-2 items-center py-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="base_kind" value={kind} /><input type="hidden" name="base_id" value={id} />
      <span className="flex-1">{title}<div className="mini">{sub}</div></span><button className="btn">Start from this</button></form>);
  return (
    <section className="card mb-4 hz-proposed">
      <div className="ch"><span className="eyebrow">Start from…</span><span className="mini">a similar past study or a template — SAM asks what differs, you keep each hazard</span></div>
      <div className="cb grid gap-3">
        {similar.length > 0 && <div><div className="mini mb-1"><b>Similar past studies</b> (closest first)</div>{similar.map((x) => opt("study", x.id, <><Link className="underline mono" href={`/safe/risk/a/${x.id}`}>{x.number}</Link> {x.name}</>, `${x.hazards} hazards · ${x.conducted_on ?? "—"}${x.uses ? ` · used ${x.uses}× as a base` : ""}`))}</div>}
        {tpls.length > 0 && <div><div className="mini mb-1"><b>Templates</b> (most used first)</div>{tpls.map((t) => opt("template", t.id, <b>{t.name}</b>, `${t.hazards.length} hazards · ${t.questions.length} questions${t.uses ? ` · used ${t.uses}×` : ""}${t.entity ? "" : " · group"}`))}</div>}
        {!similar.length && !tpls.length && <p className="mini">No similar study and no template for this kind yet — <Link className="underline" href="/safe/risk/templates">templates</Link>.</p>}
        <form action={chooseBase}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="base_kind" value="blank" /><button className="btn">Start blank</button> <span className="mini">add hazards yourself, or ask SAM to propose some</span></form>
      </div>
    </section>
  );
}
