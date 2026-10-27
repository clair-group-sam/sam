"use client";
import { useState } from "react";
import { createImportToken } from "@/app/(app)/safe/risk/actions";

/** One-time import key (30 min) for the Centrik / FlightLogger export scripts — shown once, never stored in clear. */
export default function RiskImportKey({ origin }: { origin: string }) {
  const [k, setK] = useState<{ token: string; expires: string } | null>(null); const [err, setErr] = useState("");
  return (
    <div>
      <button className="btn" onClick={async () => { try { setErr(""); setK(await createImportToken()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }}>Create an import key (30 min)</button>
      {err && <p className="mini red mt-2">{err}</p>}
      {k && <div className="mt-3"><p className="mini mb-1">Key valid until {new Date(k.expires).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })} — copy it now, it is not shown again:</p>
        <code className="mono" style={{ display: "block", padding: 8, background: "#f1f5f8", borderRadius: 6, wordBreak: "break-all" }}>{k.token}</code>
        <p className="mini mt-2">In the Centrik tab (Risk › ASJ Risk or AJD Risk › Assessments), run the S.A.M. export: <code>samCentrikRiskExport(&quot;{origin}&quot;, &quot;KEY&quot;, &quot;AJD&quot;)</code>.</p></div>}
    </div>
  );
}
