"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
/* AUD-02 · Import from Centrik: the JSON written by scripts/centrik-audits-export.js (one zone). Checklists first, then the audits, most recent first. */
export function AuditImport({ entities, initial }: { entities: string[]; initial: string }) {
  const [log, setLog] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [entity, setEntity] = useState(initial); const router = useRouter();
  const run = async (file: File) => {
    setBusy(true); setLog(["Reading the file…"]);
    try {
      const j = JSON.parse(await file.text()) as { checklists: unknown[]; audits: { no: string; completed?: string; started?: string; sections: { items: unknown[] }[] }[] };
      const post = (b: unknown) => fetch("/api/import/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ ok: r.ok, j: await r.json() }));
      const c = await post({ entity, step: "checklists", checklists: j.checklists }); setLog((l) => [...l, c.ok ? `Checklists: ${c.j.checklists} created` : `Checklists: ${c.j.error}`]);
      const key = (a: { completed?: string; started?: string }) => (a.completed || a.started || "").split(".").reverse().join("-");
      const audits = [...j.audits].sort((a, b) => key(b).localeCompare(key(a)));
      let n = 0;
      for (const a of audits) { const r = await post({ entity, step: "audit", audit: a }); n++; setLog((l) => [...l.slice(0, 1), `${n} / ${audits.length}, ${a.no}: ${r.ok ? `${r.j.checks} checks → ${r.j.checklist}${r.j.template ? " (template)" : ""}` : r.j.error}`]); }
      setLog((l) => [...l, "Done."]); router.refresh();
    } catch (e) { setLog((l) => [...l, (e as Error).message]); } finally { setBusy(false); }
  };
  return <details className="card mb-4"><summary className="ch"><span className="eyebrow">Import from Centrik</span></summary><div className="cb mini">
    <p>In Centrik, open Compliance › the zone › <b>Checklists schedule</b>, run <code>scripts/centrik-audits-export.js</code> (<code>await samCentrikAudits()</code>, GET only), then drop the JSON here. Audits keep their Centrik number; results and comments are kept as read; the checklist templates take the items of the most recent audit.</p>
    <div className="flex items-center gap-2 mb-2"><span>Into entity</span><select className="inp" value={entity} onChange={(e) => setEntity(e.target.value)} disabled={busy} style={{ width: 120 }}>{entities.map((e) => <option key={e} value={e}>{e}</option>)}</select><b>{entity}</b>, the zone of the file must be this entity's.</div>
    <input type="file" accept="application/json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm(`Import this file into ${entity}?`)) run(f); e.target.value = ""; }} />
    {log.map((l, i) => <div key={i}>{l}</div>)}
  </div></details>;
}
