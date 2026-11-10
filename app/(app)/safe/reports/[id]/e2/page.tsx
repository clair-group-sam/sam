import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";
import { isSafetyDesk } from "@/lib/safety";
import { eccairsConfig, eccairsEnv } from "@/lib/eccairs";
import { buildTaxonomyCodes, e2Context, proposeFields, type AnalysisForE2, type ReportForE2 } from "@/lib/eccairs-map";
import { sendToE2 } from "./actions";

/* ECC-02 · Review before sending to ECCAIRS 2: each attribute with S.A.M.'s proposal and where it comes from; lists from the cached
 * taxonomy; the JSON that will leave; DRAFT (ours only) or SENT (the authority receives it, the MOR is filed). */
export default async function E2Review({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params; const { err } = await searchParams;
  const s = await getSession(); if (!s) redirect("/login"); if (!isSafetyDesk(s)) redirect("/safe/mine");
  const db = supabaseAdmin();
  const { data } = await db.from("reports").select("*").eq("id", id).maybeSingle();
  const r = data as (ReportForE2 & { status: string; mor_filed_at: string | null; e2_status: string | null; e2_version: string | null; e2_sent_at: string | null }) | null;
  if (!r || !s.entities.includes(r.entity)) notFound();
  const cfg = eccairsConfig(r.entity); const env = eccairsEnv(r.entity);
  let prepError: string | null = null;
  const { data: an } = await db.from("report_analysis").select("mor_draft,adrep,mor_status").eq("report_id", id).maybeSingle();
  let ctx: Awaited<ReturnType<typeof e2Context>> = { taxonomy: null, attrs: [], values: [], maps: [] };
  try { ctx = await e2Context(db, r.entity); } catch (e) { prepError = `taxonomy: ${(e as Error).message}`; }
  const { data: ac } = r.aircraft ? await db.from("aircraft").select("registration,type_code,model,msn").ilike("registration", r.aircraft.trim()).limit(1).maybeSingle() : { data: null };
  const { data: subs } = await db.from("eccairs_submissions").select("at,kind,requested_status,ok,e2_id,e2_version,e2_status,error").eq("report_id", id).order("at", { ascending: false }).limit(10);
  const a = an as AnalysisForE2;
  let fields: ReturnType<typeof proposeFields> = [];
  try { fields = ctx.taxonomy ? proposeFields(r, a, ctx, { registry: ac as { registration: string; type_code: string | null; model: string | null; msn: string | null } | null }) : []; } catch (e) { prepError = (e as Error).message + "\n" + ((e as Error).stack ?? "").split("\n").slice(0, 4).join("\n"); }
  const { codes, missing } = buildTaxonomyCodes(fields);
  const vals = (listId: number | null | undefined) => (listId ? ctx.values.filter((v) => v.value_list_id === listId) : []);
  const history = (subs ?? []) as { at: string; kind: string; requested_status: string | null; ok: boolean; e2_id: string | null; e2_version: string | null; e2_status: string | null; error: string | null }[];
  return (
    <>
      <PageHeader eyebrow={`Safety, Report ${r.id}, ${ENT[r.entity]?.name ?? r.entity}, ECCAIRS 2`} title={r.e2_id ? `${r.e2_id}, ${r.e2_status ?? "—"} v${r.e2_version ?? "—"}` : "Report to ECCAIRS 2"}
        sub={`${env ?? "not connected"} · ${ctx.taxonomy ? `${ctx.taxonomy.name} ${ctx.taxonomy.version}, loaded ${ctx.taxonomy.loaded_at.slice(0, 10)}` : "taxonomy not loaded"} · S.A.M. proposes, you decide; nothing leaves without the button below.`}
        right={<Link className="btn" href={`/safe/reports/${r.id}`}>Back to the report</Link>} />
      {!cfg && <section className="card mb-4"><div className="cb">ECCAIRS is not connected for {r.entity} (environment variables). The report is filed in the <a className="underline" href="https://e2.aviationreporting.eu/home" target="_blank" rel="noreferrer">E2 portal</a> and its reference recorded on the report.</div></section>}
      {err && <section className="card mb-4"><div className="cb"><span className="pill red">refused</span> <span className="mini" style={{ whiteSpace: "pre-wrap" }}>{err}</span></div></section>}
      {prepError && <section className="card mb-4"><div className="cb"><b>S.A.M. could not build the proposal:</b><pre className="mini" style={{ whiteSpace: "pre-wrap" }}>{prepError}</pre></div></section>}
      {cfg && !ctx.taxonomy && <section className="card mb-4"><div className="cb">The taxonomy of the authority is not loaded yet: <Link className="underline" href="/safe/mor/e2">Safety › MOR / ECCAIRS › Load the taxonomy</Link>.</div></section>}
      {cfg && ctx.taxonomy && (
        <form action={sendToE2}>
          <input type="hidden" name="id" value={r.id} />
          <section className="card mb-4"><div className="ch"><span className="eyebrow">The report as it will be sent</span><span className="mini">{fields.filter((f) => f.value && (!Array.isArray(f.value) || f.value.length)).length} / {fields.length} attributes filled{missing.length ? ` · missing: ${missing.join(", ")}` : ""}</span></div>
            <div className="cb" style={{ padding: 0 }}><table className="tbl"><thead><tr><th>Attribute</th><th>Value</th><th>Proposed from</th></tr></thead><tbody>
              {fields.map((f) => <tr key={f.key}>
                <td><b>{f.label}</b>{f.required && <span className="late"> *</span>}<div className="mini mono">{f.entity}.{f.attribute}</div>{f.hint && <div className="mini">{f.hint}</div>}</td>
                <td style={{ minWidth: 320 }}>
                  {f.kind === "text" && (f.key === "narrative" ? <textarea name={`f_${f.key}`} className="inp" rows={8} defaultValue={(f.value as string) ?? ""} /> : <input name={`f_${f.key}`} className="inp" defaultValue={(f.value as string) ?? ""} />)}
                  {f.kind === "date" && <input type="date" name={`f_${f.key}`} className="inp" defaultValue={(f.value as string) ?? ""} />}
                  {f.kind === "number" && <input type="number" name={`f_${f.key}`} className="inp" defaultValue={(f.value as string) ?? ""} />}
                  {f.kind === "list" && (vals(f.listId).length ? <select name={`f_${f.key}`} className="inp" defaultValue={(f.value as string) ?? ""}><option value="">—</option>{vals(f.listId).map((v) => <option key={v.value_id} value={v.value_id}>{v.level && v.level > 1 ? "· ".repeat(v.level - 1) : ""}{v.description}</option>)}</select>
                    : <><input name={`f_${f.key}`} className="inp mono" defaultValue={(f.value as string) ?? ""} placeholder="E2 value id" /><div className="mini">List not cached — the value id comes from the correspondences (Safety › MOR / ECCAIRS).</div></>)}
                  {f.kind === "lists" && (vals(f.listId).length ? <select name={`f_${f.key}`} className="inp" multiple size={Math.min(8, Math.max(3, vals(f.listId).length))} defaultValue={f.value as string[]}>{vals(f.listId).map((v) => <option key={v.value_id} value={v.value_id}>{v.level && v.level > 1 ? "· ".repeat(v.level - 1) : ""}{v.description}</option>)}</select>
                    : <input name={`f_${f.key}`} className="inp mono" defaultValue={(f.value as string[]).join(" ")} placeholder="E2 value ids" />)}
                </td>
                <td className="mini">{f.from ?? ""}</td></tr>)}
            </tbody></table></div></section>
          <section className="card mb-4"><div className="ch"><span className="eyebrow">Send</span><span className="mini">environment: {env}</span></div>
            <div className="cb">
              <p className="mini mb-2">DRAFT stays in our organisation's space in E2 (nobody at the authority sees it). SENT reaches the competent authority and files the MOR: the 72 h clock stops, the 30-day and 3-month reports are scheduled. {r.e2_id ? `This report already exists in E2 as ${r.e2_id}: the attributes above replace the ones sent before (a new minor version).` : ""}</p>
              <div className="flex gap-3 items-center flex-wrap">
                <button className="btn" name="status" value="DRAFT">{r.e2_id ? "Update the draft in E2" : "Save as DRAFT in E2"}</button>
                <label className="mini flex items-center gap-1"><input type="checkbox" name="confirm" /> I checked the report; it is de-identified and complete.</label>
                <button className="btn primary" name="status" value="SENT" disabled={env === "production" && r.status === "closed"}>{r.e2_status === "SENT" ? "Send the update to the authority" : "Send to the authority (SENT)"}</button>
              </div>
            </div></section>
          <details className="card mb-4"><summary className="ch" style={{ cursor: "pointer" }}><span className="eyebrow">JSON that leaves (taxonomyCodes)</span></summary><pre className="cb mini" style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{JSON.stringify(codes, null, 2)}</pre></details>
        </form>)}
      {history.length > 0 && <section className="card"><div className="ch"><span className="eyebrow">Exchanges with E2</span></div><div className="cb" style={{ padding: 0 }}><table className="tbl"><tbody>{history.map((h, i) => <tr key={i}><td className="mini">{h.at.slice(0, 16).replace("T", " ")}</td><td>{h.kind}{h.requested_status ? ` → ${h.requested_status}` : ""}</td><td>{h.ok ? <span className="pill green">{h.e2_id} v{h.e2_version} {h.e2_status}</span> : <span className="pill red">refused</span>}{h.error && <div className="mini">{h.error}</div>}</td></tr>)}</tbody></table></div></section>}
    </>
  );
}
