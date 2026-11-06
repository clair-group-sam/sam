"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = { wmId: number; name: string; file: string; versions?: number; published?: string | null };
/** SAF-09 · history from Web Manuals: select wm-promotions_<folder>.json and the PDFs together; each PDF goes straight to the private storage (signed upload URL), then the bulletin is recorded. */
export default function PromoImport({ entity }: { entity: string }) {
  const [log, setLog] = useState<string[]>([]); const [busy, setBusy] = useState(false); const router = useRouter();
  async function go(files: FileList | null) {
    if (!files?.length) return; setBusy(true); const out: string[] = [];
    const metaFile = [...files].find((f) => f.name.endsWith(".json"));
    if (!metaFile) { setLog(["Select the wm-promotions_….json together with the PDFs."]); setBusy(false); return; }
    const meta = JSON.parse(await metaFile.text()) as { items: Item[] };
    for (const it of meta.items) {
      const pdf = [...files].find((f) => f.name === it.file);
      if (!pdf) { out.push(`FAILED ${it.name}: PDF not selected (${it.file})`); continue; }
      const call = async (step: string) => { const r = await fetch("/api/import/promotions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, meta: it, entity }) }); return { ok: r.ok, j: await r.json().catch(() => ({})) }; };
      const sign = await call("sign");
      if (!sign.ok) { out.push(`FAILED ${it.name}: ${sign.j.error ?? "refused"}`); setLog([...out]); continue; }
      const up = await fetch(sign.j.url, { method: "PUT", headers: { "content-type": "application/pdf", "x-upsert": "true" }, body: pdf });
      if (!up.ok) { out.push(`FAILED ${it.name}: upload ${up.status}`); setLog([...out]); continue; }
      const { ok, j } = await call("save");
      out.push(ok ? `OK ${j.number} — ${j.title}${j.updated ? " (updated)" : ""}` : `FAILED ${it.name}: ${j.error ?? "refused"}`);
      setLog([...out]);
    }
    setBusy(false); router.refresh();
  }
  return (
    <div>
      <p className="mini mb-2">In Web Manuals (admin), run <span className="mono">samWmPromotions(&lt;folder id&gt;)</span> from scripts/wm-promotions-export.js — read-only — then select the JSON and all the PDFs here.</p>
      <input type="file" multiple accept=".json,.pdf,application/pdf,application/json" disabled={busy} onChange={(e) => go(e.target.files)} />
      {log.length > 0 && <ul className="mini mt-2" style={{ display: "grid", gap: 2 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}
