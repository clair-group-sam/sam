import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENT } from "@/lib/nav";
import { PageHeader, Metric } from "@/components/Page";
import SourceMark from "@/components/SourceMark";
import { isSafetyDesk } from "@/lib/safety";
import { AUTHORITY, STAGE, due30, due3m, due72, stageOf, type Stage } from "@/lib/mor";
import { eccairsConfig, eccairsEnv } from "@/lib/eccairs";
import { recordFollowup } from "./actions";

type R = { id: string; entity: string; headline: string; headline_en: string | null; received_at: string; event_date: string | null; source: string | null; external_no: string | null; mor_ref: string | null; mor_filed_at: string | null; mor_authority: string | null; mor_followup_at: string | null; mor_followup_ref: string | null; mor_final_at: string | null; mor_final_ref: string | null; status: string; report_analysis: { mor_status: string | null; confirmed_at: string | null } | { mor_status: string | null; confirmed_at: string | null }[] | null };
const d = (x: Date | string | null) => (x ? (typeof x === "string" ? x : x.toISOString()).slice(0, 10) : "—");
const TABS: [string, string][] = [["", "To do"], ["sam", "Filed from S.A.M."], ["imported", "Imported (mirror)"], ["all", "All"]];

/** Safety › MOR / ECCAIRS: mandatory occurrence reports — 72 h to file from receipt in S.A.M., 30-day and final (3-month) reports to the authority; imported reports mirrored as sent / not sent to ECCAIRS. */
export default async function Mor({ searchParams }: { searchParams: Promise<{ t?: string; y?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams; const scope = s.entity === "ALL" ? s.entities : [s.entity]; const now = Date.now();
  const { data } = await supabaseAdmin().from("reports").select("id,entity,headline,headline_en,received_at,event_date,source,external_no,mor_ref,mor_filed_at,mor_authority,mor_followup_at,mor_followup_ref,mor_final_at,mor_final_ref,status,report_analysis(mor_status,confirmed_at)").in("entity", scope).order("received_at", { ascending: false }).limit(3000);
  const all = ((data ?? []) as unknown as R[]).filter((r) => !/^\s*test\b/i.test(r.headline)).map((r) => { const a = Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis; return { ...r, a }; });
  // in the register: S.A.M. reports classified as mandatory (or filed), and every imported report (mirror of the source tool / ECCAIRS)
  const reg = all.filter((r) => (r.source ?? "sam") !== "sam" || r.mor_filed_at || (r.a?.confirmed_at && r.a.mor_status === "mandatory")).map((r) => ({ ...r, st: stageOf(r, now) as Stage }));
  const todo = reg.filter((r) => ["to_file", "late", "followup", "final"].includes(r.st));
  const rows = sp.t === "sam" ? reg.filter((r) => (r.source ?? "sam") === "sam") : sp.t === "imported" ? reg.filter((r) => (r.source ?? "sam") !== "sam") : sp.t === "all" ? reg : todo;
  const y = sp.y ?? String(new Date().getUTCFullYear());
  const imp = reg.filter((r) => (r.source ?? "sam") !== "sam" && r.received_at.startsWith(y));
  const desk = isSafetyDesk(s);
  const dueOf = (r: (typeof reg)[number]) => r.st === "to_file" || r.st === "late" ? due72(r.received_at) : r.st === "followup" ? due30(r.mor_filed_at!) : r.st === "final" ? due3m(r.mor_filed_at!) : null;
  return (
    <>
      <PageHeader eyebrow="Safety · Reporting to the authority" title="MOR / ECCAIRS" sub="Mandatory occurrence reports: filed within 72 h of receipt in S.A.M. (376/2014 art. 4(8)), then the 30-day and final (3-month) reports to the authority (art. 13(4)). Imported reports show what ECCAIRS holds: sent or not sent." />
      <div className="grid grid-cols-5 gap-4 mb-5">
        <Metric label="To file (72 h)" value={reg.filter((r) => r.st === "to_file").length} tone={reg.some((r) => r.st === "to_file") ? "amber" : undefined} />
        <Metric label="Past 72 h" value={reg.filter((r) => r.st === "late").length} tone={reg.some((r) => r.st === "late") ? "red" : undefined} />
        <Metric label="30-day reports due" value={reg.filter((r) => r.st === "followup").length} tone={reg.some((r) => r.st === "followup" && now > due30(r.mor_filed_at!).getTime()) ? "red" : undefined} />
        <Metric label="Final reports due" value={reg.filter((r) => r.st === "final").length} />
        <Metric label={`Imported ${y} · sent to ECCAIRS`} value={`${imp.filter((r) => r.st === "sent_imported").length} / ${imp.length}`} hint="mirror of ECCAIRS" />
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">{TABS.map(([k, l]) => <Link key={k} href={`/safe/mor${k ? `?t=${k}` : ""}`} className={"btn" + ((sp.t ?? "") === k ? " on" : "")}>{l} <span className="pill">{k === "" ? todo.length : k === "sam" ? reg.filter((r) => (r.source ?? "sam") === "sam").length : k === "imported" ? reg.filter((r) => (r.source ?? "sam") !== "sam").length : reg.length}</span></Link>)}</div>
      <section className="card mb-5">
        <table className="tbl">
          <thead><tr><th style={{ width: 130 }}>Report</th><th>Occurrence</th><th style={{ width: 130 }}>Authority</th><th style={{ width: 180 }}>ECCAIRS</th><th style={{ width: 110 }}>Next due</th><th style={{ width: 200 }}>Status</th></tr></thead>
          <tbody>
            {rows.slice(0, 400).map((r) => { const due = dueOf(r); const late = due && now > due.getTime(); return (
              <tr key={r.id}>
                <td className="mono"><Link className="underline" href={`/safe/reports/${r.id}`}>{r.id}</Link><SourceMark source={r.source} id={r.external_no} />{scope.length > 1 && <div><span className={"ent " + r.entity}>{r.entity}</span></div>}</td>
                <td><Link href={`/safe/reports/${r.id}`}><b>{r.headline_en || r.headline}</b></Link><div className="mini">occurred {d(r.event_date)} · received {d(r.received_at)}</div></td>
                <td className="mini">{r.mor_authority ?? AUTHORITY[r.entity]?.name ?? "—"}</td>
                <td className="mini">{r.mor_ref ? <span className="mono">{r.mor_ref.replace(/^ECCAIRS /, "")}</span> : "—"}{r.mor_filed_at && <div>filed {d(r.mor_filed_at)}</div>}{r.mor_followup_at && <div>30-day {d(r.mor_followup_at)}</div>}{r.mor_final_at && <div>final {d(r.mor_final_at)}</div>}</td>
                <td className={"mono" + (late ? " red" : "")}>{due ? d(due) : "—"}</td>
                <td><span className={"pill " + STAGE[r.st][1]}>{STAGE[r.st][0]}</span>
                  {desk && (r.st === "followup" || r.st === "final") && <form action={recordFollowup} className="flex gap-1 mt-1"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value={r.st === "final" ? "final" : "followup"} /><input name="ref" className="inp mono" placeholder="ref (optional)" style={{ marginTop: 0, width: 110 }} /><button className="btn">{r.st === "final" ? "Final sent" : "30-day sent"}</button></form>}
                  {(r.st === "to_file" || r.st === "late") && <div className="mini mt-1"><Link className="underline" href={`/safe/reports/${r.id}`}>file it from the report</Link></div>}</td>
              </tr>); })}
            {!rows.length && <tr><td colSpan={6} className="p-6 mini">{sp.t ? "Nothing here." : "Nothing to do — no MOR to file, no follow-up due."}</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">ECCAIRS 2 — machine-to-machine link</span><span className="mini">EASA E2 API Guide for Organisations v1.1</span></div>
        <table className="tbl"><tbody>{scope.map((e) => { const ok = !!eccairsConfig(e); const env = eccairsEnv(e); return (
          <tr key={e}><td style={{ width: 80 }}><span className={"ent " + e}>{e}</span></td><td><b>{ENT[e]?.name ?? e}</b><div className="mini">{AUTHORITY[e]?.account} · {AUTHORITY[e]?.route}</div></td>
            <td style={{ width: 260 }}>{ok ? <span className="pill green">Connected — {env}</span> : <span className="pill">Not connected — reports filed in the E2 portal</span>}</td></tr>); })}</tbody></table>
        <div className="cb mini">To connect: (1) sandbox M2M user from EASA (ECCAIRS2@easa.europa.eu) and a fixed outgoing IP whitelisted by EASA; (2) UAT user — first machine-to-machine reports checked by the regulator; (3) production user. Each user is an e-mail account created by the IT for this purpose. Until then, reports are filed in the E2 portal and the reference is recorded on the report.</div>
      </section>
    </>
  );
}
