"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** SAF-07 · Safety › Reports (Astonfly): paste what the FlightLogger collector copied, check, import. */
export default function FlSync({ url }: { url: string }) {
  const [txt, setTxt] = useState(""); const [busy, setBusy] = useState(false); const [res, setRes] = useState<string | null>(null);
  const [last, setLast] = useState<string>("…"); const router = useRouter();
  useEffect(() => { fetch("/api/import/flightlogger").then((r) => r.json()).then((j) => setLast(j.last ? `${j.count} reports from FlightLogger · last read ${String(j.last.synced_at ?? j.last.received_at).slice(0, 16).replace("T", " ")}` : `${j.count ?? 0} reports from FlightLogger`)).catch(() => setLast("")); }, [res]);
  async function go(dry: boolean) {
    setBusy(true); setRes(null);
    try {
      const body = JSON.parse(txt.trim());
      const r = await fetch("/api/import/flightlogger", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reports: body.reports ?? body, dry }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRes(`${dry ? "Check" : "Imported"} — ${j.read} read · ${j.created.length} new${j.created.length ? ` (${j.created.join(", ")})` : ""} · ${j.status_changed.length} status changed in FlightLogger${j.errors.length ? ` · errors: ${j.errors.join("; ")}` : ""}`);
      if (!dry) { setTxt(""); router.refresh(); }
    } catch (e) { setRes(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <details className="card mb-5"><summary className="ch cursor-pointer"><span className="eyebrow">Retrieve from FlightLogger</span><span className="mini">{last}</span></summary>
      <div className="cb">
        <ol className="mini mb-2" style={{ paddingLeft: 16, listStyle: "decimal" }}>
          <li>Open <a className="underline" href={url} target="_blank" rel="noreferrer">FlightLogger › Safety Management › Reports</a> and run the S.A.M. collector (scripts/flightlogger-reports-export.js) — it only reads.</li>
          <li>Paste here, Check, then Import: new reports enter S.A.M. as received (72 h from their FlightLogger date); known reports only get their FlightLogger status.</li>
        </ol>
        <textarea className="inp mono" rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder='{"source":"flightlogger","reports":[…]}' />
        <div className="flex gap-2 mt-2 items-center"><button className="btn" disabled={busy || !txt} onClick={() => go(true)}>Check</button><button className="btn primary" disabled={busy || !txt} onClick={() => go(false)}>Import</button>{res && <span className="mini">{res}</span>}</div>
      </div>
    </details>
  );
}
