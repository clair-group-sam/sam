import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader, Metric } from "@/components/Page";
import { STATUS, ercTone, isSafetyDesk, morClock } from "@/lib/safety";

type Row = { source?: string; external_no?: string | null; report_type?: string | null; source_erc?: number | null; id: string; entity: string; headline: string; headline_en: string | null; received_at: string; status: string; aircraft: string | null; anonymous: boolean; mor_filed_at: string | null; report_analysis: { erc_value: number | null; mor_status: string | null; confirmed_at: string | null; adrep: string[] } | { erc_value: number | null; mor_status: string | null; confirmed_at: string | null; adrep: string[] }[] | null };

/** Safety › Reports (SM / FSO / Compliance): every report of the scope, MOR clocks first. */
export default async function Reports({ searchParams }: { searchParams: Promise<{ st?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!isSafetyDesk(s)) redirect("/safe/mine");
  const { st } = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const { data } = await supabaseAdmin().from("reports").select("id,entity,headline,headline_en,received_at,status,aircraft,anonymous,mor_filed_at,source,external_no,report_type,source_erc,report_analysis(erc_value,mor_status,confirmed_at,adrep)").in("entity", scope).order("received_at", { ascending: false }).limit(300);
  const all = ((data ?? []) as unknown as Row[]).map((r) => { const a = Array.isArray(r.report_analysis) ? r.report_analysis[0] : r.report_analysis; return { ...r, a, clock: morClock(r.received_at, r.mor_filed_at, a?.confirmed_at ? a.mor_status : null) }; });
  const open = all.filter((r) => r.status !== "closed");
  const clocks = open.filter((r) => r.clock.state === "running" || r.clock.state === "late");
  const rows = st === "closed" ? all.filter((r) => r.status === "closed") : st === "all" ? all : open;
  rows.sort((x, y) => Number(y.clock.state === "running" || y.clock.state === "late") - Number(x.clock.state === "running" || x.clock.state === "late") || y.received_at.localeCompare(x.received_at));
  return (
    <>
      <PageHeader eyebrow="Safety · Reports" title="Safety reports" sub="MOR clocks first · the 72 h run from receipt in S.A.M." right={<Link href="/safe/new" className="btn">+ New report</Link>} />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Metric label="Open" value={open.length} />
        <Metric label="MOR clocks running" value={clocks.length} tone={clocks.some((r) => r.clock.state === "late" || r.clock.left <= 24) ? "red" : clocks.length ? "amber" : undefined} hint="decide mandatory / voluntary" />
        <Metric label="Not yet acknowledged" value={open.filter((r) => r.status === "received").length} />
        <Metric label="ERC red (≥ 500)" value={open.filter((r) => (r.a?.erc_value ?? 0) >= 500).length} tone={open.some((r) => (r.a?.erc_value ?? 0) >= 500) ? "red" : undefined} />
      </div>
      <div className="flex gap-2 mb-3">{[["", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={k ? `/safe/reports?st=${k}` : "/safe/reports"} className={"btn" + ((st ?? "") === k ? " on" : "")}>{l}</Link>)}</div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th style={{ width: 90 }}>Report</th><th style={{ width: 70 }}>Entity</th><th>What</th><th style={{ width: 150 }}>Status</th><th style={{ width: 170 }}>MOR</th><th style={{ width: 80 }}>ERC</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono"><Link href={`/safe/reports/${r.id}`} className="underline">{r.id}</Link></td>
                <td><span className={"ent " + r.entity}>{r.entity}</span></td>
                <td><Link href={`/safe/reports/${r.id}`}><b>{r.headline_en || r.headline}</b></Link><div className="mini">{new Date(r.received_at).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{r.source && r.source !== "sam" ? ` · ${r.source === "flightlogger" ? "FlightLogger" : "Centrik"} ${r.external_no ?? ""}${r.report_type ? " " + r.report_type : ""}` : ""}{r.aircraft ? " · " + r.aircraft : ""}{r.anonymous ? " · anonymous" : ""}{r.a?.adrep?.length ? " · " + r.a.adrep.join(", ") : ""}</div></td>
                <td><span className={"pill " + (STATUS[r.status]?.[1] ?? "")}>{STATUS[r.status]?.[0] ?? r.status}</span></td>
                <td><span className={"pill " + (r.clock.state === "late" ? "red" : r.clock.state === "running" ? (r.clock.left <= 24 ? "red" : "amber") : "green")}>{r.clock.label}</span></td>
                <td>{r.a?.erc_value != null ? <span className={"pill " + ercTone(r.a.erc_value)}>{r.a.erc_value}</span> : r.source_erc != null ? <span className={"pill " + (r.source_erc >= 300 ? "red" : r.source_erc >= 20 ? "amber" : "green")} title="ERC as scored in Centrik">{r.source_erc}</span> : <span className="mini">—</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-slate6">No report.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
