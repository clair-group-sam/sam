"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type St = { configured: boolean; last: string | null; count: number } | null;
type Res = { read: number; created: string[]; status_changed: string[]; errors: string[]; error?: string };

/** SAF-07 · Safety › Reports (Astonfly): one button — S.A.M. reads FlightLogger with its own account; read again every evening. */
export default function FlSync({ url }: { url: string }) {
  const [st, setSt] = useState<St>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [txt, setTxt] = useState(""); const router = useRouter();
  const load = () => fetch("/api/import/flightlogger").then((r) => r.json()).then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  async function go(body: object) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/import/flightlogger", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as Res; if (!r.ok) throw new Error(j.error ?? r.statusText);
      setMsg(`${j.read} read · ${j.created.length ? `${j.created.length} new (${j.created.join(", ")})` : "nothing new"}${j.status_changed.length ? ` · ${j.status_changed.length} status changed in FlightLogger` : ""}${j.errors.length ? ` · errors: ${j.errors.join("; ")}` : ""}`);
      setTxt(""); load(); router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const last = st?.last ? `last read ${st.last.slice(0, 16).replace("T", " ")} UTC` : "not read yet";
  return (
    <section className="card mb-5">
      <div className="ch"><span className="eyebrow">FlightLogger</span><span className="mini">Astonfly reports are sent in FlightLogger · {st ? `${st.count} in S.A.M. · ${last}` : "…"} · read again every evening</span>
        {st?.configured && <button className="btn primary ml-auto" disabled={busy} onClick={() => go({})}>{busy ? "Reading FlightLogger…" : "Retrieve from FlightLogger"}</button>}</div>
      {(msg || (st && !st.configured)) && <div className="cb mini">{msg ?? <>The S.A.M. FlightLogger account is not set yet (FLIGHTLOGGER_USER / FLIGHTLOGGER_PASSWORD in Vercel). Until then, use the collector below.</>}</div>}
      <details className="cb"><summary className="mini cursor-pointer">Without the S.A.M. account — collector script</summary>
        <p className="mini mt-1">Run scripts/flightlogger-reports-export.js in <a className="underline" href={url} target="_blank" rel="noreferrer">FlightLogger › Safety Management › Reports</a> (read-only), paste here, Import.</p>
        <textarea className="inp mono" rows={2} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder='{"source":"flightlogger","reports":[…]}' />
        <button className="btn mt-1" disabled={busy || !txt} onClick={() => { try { const b = JSON.parse(txt.trim()); go({ reports: b.reports ?? b }); } catch { setMsg("Not the collector output."); } }}>Import</button>
      </details>
    </section>
  );
}
