"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = { wmId: number; name: string; file: string; versions?: number; published?: string | null };
/** SAF-09 · history from Web Manuals: select wm-promotions_<folder>.json and the PDFs together; each PDF is sent on its own (size limit). */
export default function PromoImport({ entity }: { entity: string }) {
  const [log, setLog] = useState<string[]>([]); const [busy, setBusy] = useState(false); const router = useRouter();
  async function go(files: FileList | null) {
    if (!files?.length) return; setBusy(true); const out: string[] = [];
    const metaFile = [...files].find((f) => f.name.endsWith(".json"));
    if (!metaFile) { setLog(["Select the wm-promotions_….json together with the PDFs."]); setBusy(false); return; }
    const meta = JSON.parse(await metaFile.text()) as { items: Item[] };
    for (const it of meta.items) {
      const pdf = [...files].find((f) => f.name === it.file);
      if (!pdf) { out.push(`✕ ${it.name}: PDF not selected (${it.file})`); continue; }
      const fd = new FormData(); fd.set("file", pdf); fd.set("meta", JSON.stringify(it)); fd.set("entity", entity);
      const r = await fetch("/api/import/promotions", { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
      out.push(r.ok ? `✓ ${j.number} — ${j.title}${j.updated ? " (updated)" : ""}` : `✕ ${it.name}: ${j.error ?? r.status}`);
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
