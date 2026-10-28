"use client";
import { useState } from "react";

/** Download the risk assessment as a PDF (for the CAA application or the archive). */
export function PdfButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const go = async () => {
    if (busy) return; setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/risk/pdf/${id}`); const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
      const a = document.createElement("a"); a.href = j.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <span className="flex flex-col items-end"><button className="btn" onClick={go} disabled={busy}>{busy ? "Preparing the PDF…" : "Download PDF"}</button>{err && <span className="mini red">{err}</span>}</span>;
}
