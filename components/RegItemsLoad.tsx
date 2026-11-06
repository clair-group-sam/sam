"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
/* REG-03 · desk button: load (or reload) the articles of one EAR from the EASA XML export. */
export function RegItemsLoad({ regKey, label }: { regKey: string; label: string }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const router = useRouter();
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const r = await fetch("/api/import/regulation-items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: regKey }) }); const j = await r.json();
      setMsg(r.ok ? `${j.count} articles · ${j.version}${j.new || j.modified || j.removed ? ` · ${j.new} new, ${j.modified} modified, ${j.removed} removed` : ""} (${Math.round(j.ms / 1000)} s)` : j.error ?? "failed"); router.refresh(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return <span className="mini"><button type="button" className="btn sm" onClick={go} disabled={busy}>{busy ? "Reading the EASA export…" : label}</button>{msg && <span style={{ marginLeft: 8 }}>{msg}</span>}</span>;
}
