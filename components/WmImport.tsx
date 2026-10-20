"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { importWmBundle, type ImportResult } from "@/app/(app)/set/integ/actions";
import { imageExt, type WmBundle } from "@/lib/wm-import";

type ManualRow = { id: string; entity: string; code: string; title: string; path: string | null };
type Props = { manuals: ManualRow[]; entities: string[] };

export default function WmImport({ manuals, entities }: Props) {
  const [bundle, setBundle] = useState<WmBundle | null>(null);
  const [fileName, setFileName] = useState("");
  const [entity, setEntity] = useState(entities[0] ?? "TEC");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [certKind, setCertKind] = useState("approval");
  const [issuer, setIssuer] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const say = (m: string) => setLog((l) => [...l, m]);

  async function onFile(f: File | undefined) {
    setResult(null); setLog([]); setBundle(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const b = JSON.parse(await f.text()) as WmBundle;
      if (b.format !== "sam-wm-export/1") { say("This file is not a S.A.M. Web Manuals export."); return; }
      setBundle(b);
      const guess = /_([A-Z]{3})_([A-Z0-9-]+)_/.exec(f.name);
      if (guess) { if (entities.includes(guess[1])) setEntity(guess[1]); setCode(guess[2]); }
      setTitle(b.manual.name);
      if (b.kind === "file") { setIssuer(entity === "TEC" ? "OSAC" : entity === "AJD" ? "TM-CAD" : "DSAC"); }
      const known = manuals.find((m) => m.code === (guess?.[2] ?? "") && m.entity === (guess?.[1] ?? ""));
      if (known) setPath(known.path ?? "");
    } catch { say("Could not read the file."); }
  }

  async function run() {
    if (!bundle || !code) return;
    setBusy(true); setLog([]); setResult(null);
    try {
      const sb = supabaseBrowser();
      const rev = bundle.manual.rev ?? "00";
      if (bundle.kind === "file" || bundle.kind === "pdf") {
        const f = bundle.file; if (!f?.b64) { say("No file in this export."); return; }
        const bin = Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0));
        const bucket = bundle.kind === "file" ? "certificates" : "manuals";
        const key = bundle.kind === "file" ? `${entity}/${code}/${f.name}` : `${entity}/${code}/${rev}/${f.name}`;
        say(`${bundle.kind === "file" ? "File" : "Official PDF"} ${f.name} · ${Math.round(f.size / 1024)} KB`);
        const { error } = await sb.storage.from(bucket).upload(key, bin, { upsert: true, contentType: f.type || "application/pdf" });
        if (error) { say(`upload: ${error.message}`); return; }
        say("Stored in the private bucket.");
        const r = await importWmBundle({ entity, code, title, path: path || undefined, bundle: { ...bundle, file: { name: f.name, type: f.type, size: f.size } }, imageExt: {}, filePath: `${bucket}/${key}`, cert: { kind: certKind, issuer, valid_until: validUntil || null } });
        setResult(r); say(r.ok ? "Done." : `Error: ${r.error}`);
        return;
      }
      const images = bundle.images ?? {};
      const ext: Record<string, string> = {};
      const ids = Object.keys(images);
      say(`${bundle.pages.length} pages · ${ids.length} images · Rev ${rev}`);
      let n = 0;
      for (const id of ids) {
        const im = images[id]; const e = imageExt(im.name, im.type); ext[id] = e;
        if (!im.b64) continue;
        const bin = Uint8Array.from(atob(im.b64), (c) => c.charCodeAt(0));
        const { error } = await sb.storage.from("manuals").upload(`${entity}/${code}/${rev}/${id}.${e}`, bin, { upsert: true, contentType: im.type && im.type !== "application/octet-stream" ? im.type : (e === "png" ? "image/png" : e === "jpg" ? "image/jpeg" : "application/octet-stream") });
        if (error) { say(`image ${id}: ${error.message}`); } else n++;
      }
      say(`${n} image${n > 1 ? "s" : ""} stored.`);
      const slim: WmBundle = { ...bundle, images: Object.fromEntries(ids.map((id) => [id, { name: images[id].name, type: images[id].type, size: images[id].size }])) };
      say("Writing chapters…");
      const r = await importWmBundle({ entity, code, title, path: path || undefined, bundle: slim, imageExt: ext });
      setResult(r);
      say(r.ok ? `Done: ${r.sections} chapters, ${r.changed} flagged as changed in Rev ${rev}.` : `Error: ${r.error}`);
    } catch (e) { say(`Error: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-2 gap-5">
      <div>
        <label className="block mb-3"><span className="eyebrow">1 · Export file</span>
          <input type="file" accept=".json,application/json" className="block mt-1 text-sm" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        {bundle && (
          <div className="mini mb-3">{fileName} — <b>{bundle.manual.name}</b> · Issue {bundle.manual.issue} Rev {bundle.manual.rev} · published {bundle.manual.publishedDate?.slice(0, 10)} · {bundle.kind === "pages" || !bundle.kind ? `${bundle.pages.length} pages · ${Object.keys(bundle.images ?? {}).length} images` : bundle.kind === "pdf" ? `official PDF ${bundle.file?.name}` : `file ${bundle.file?.name} → Certificates & Validities`}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label><span className="eyebrow">Entity</span>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} className="inp">{entities.map((e) => <option key={e}>{e}</option>)}</select></label>
          <label><span className="eyebrow">Manual code</span>
            <input list="codes" value={code} onChange={(e) => { setCode(e.target.value); const k = manuals.find((m) => m.code === e.target.value && m.entity === entity); if (k) { setTitle(k.title); setPath(k.path ?? ""); } }} className="inp" placeholder="CAE, OM-A, MSM…" />
            <datalist id="codes">{manuals.filter((m) => m.entity === entity).map((m) => <option key={m.id} value={m.code}>{m.title}</option>)}</datalist></label>
          <label className="col-span-2"><span className="eyebrow">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} className="inp" /></label>
          <label className="col-span-2"><span className="eyebrow">Folder (as in the library)</span><input value={path} onChange={(e) => setPath(e.target.value)} className="inp" placeholder="3. OPERATIONS MANUALS › CAO" /></label>
          {bundle?.kind === "file" && (<>
            <label><span className="eyebrow">Certificate kind</span>
              <select value={certKind} onChange={(e) => setCertKind(e.target.value)} className="inp">{["approval", "approval letter", "AOC", "OpSpecs", "ATO", "CAMO", "Part-CAE", "insurance", "ARC", "CofA", "radio licence", "noise", "other"].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label><span className="eyebrow">Issuer</span><input value={issuer} onChange={(e) => setIssuer(e.target.value)} className="inp" placeholder="OSAC, DSAC, TM-CAD…" /></label>
            <label className="col-span-2"><span className="eyebrow">Valid until (leave empty if no expiry)</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="inp" /></label>
          </>)}
        </div>
        <button type="button" className="btn primary mt-4" disabled={!bundle || !code || busy} onClick={run}>{busy ? "Importing…" : "Import this revision"}</button>
      </div>
      <div>
        <div className="eyebrow mb-1">Log</div>
        <pre className="log">{log.join("\n") || "—"}</pre>
        {result?.ok && result.manualId && <a className="btn mt-3" href={`/docs/manual/${result.manualId}?rev=${result.revisionId}`}>Open the manual ›</a>}
        {result?.ok && !result.manualId && <a className="btn mt-3" href="/docs/files">Open Certificates & Validities ›</a>}
        <details className="mt-4 mini"><summary>How to export from Web Manuals</summary>
          <p className="mt-2">Open the Web Manuals reader signed in, open the browser console on any page and run the S.A.M. export script with the manual id (the CMM holds it). It downloads <code>wm-export_&lt;ENTITY&gt;_&lt;CODE&gt;_&lt;id&gt;_rev&lt;NN&gt;.json</code>. Nothing is modified in Web Manuals.</p></details>
      </div>
    </div>
  );
}
