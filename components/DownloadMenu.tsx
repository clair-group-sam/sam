"use client";
import { useEffect, useRef, useState } from "react";

export type DlRev = { id: string; label: string; sub: string };

/** DOC-13 · "Download PDF ▾": published revision, a draft (pick which) or an archived revision (pick which). */
export default function DownloadMenu({ manualId, published, drafts, archive }: { manualId: string; published: DlRev | null; drafts: DlRev[]; archive: DlRev[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(drafts[0]?.id ?? "");
  const [arch, setArch] = useState(archive[0]?.id ?? "");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const [busy, setBusy] = useState("");
  // real PDF (with bookmarks) generated on the server; if that fails, the browser's Save as PDF on the print page
  const [err, setErr] = useState("");
  // real PDF (with bookmarks) generated on the server; no lesser fallback — if it fails, say so and let the user retry later
  const go = async (rev: string) => {
    if (busy) return; setBusy(rev); setErr("");
    try {
      const r = await fetch(`/api/docs/pdf/${manualId}?rev=${rev}`);
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
      const a = document.createElement("a"); a.href = j.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
      setOpen(false);
    } catch { setErr("The PDF could not be generated right now. Please try again later."); }
    setBusy("");
  };
  return (
    <div className="dlmenu" ref={box}>
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Download PDF ▾</button>
      {open && (
        <div className="dlpanel" role="menu">
          <div className={"dlrow" + (published ? "" : " off")}>
            <span className="k">Published</span>
            <span className="v">{published ? <>{published.label}<small>{published.sub}</small></> : "no published revision"}</span>
            <button type="button" className="btn primary" disabled={!published || !!busy} onClick={() => published && go(published.id)}>{busy && busy === published?.id ? "Preparing…" : "Download"}</button>
          </div>
          <div className={"dlrow" + (drafts.length ? "" : " off")}>
            <span className="k">Draft</span>
            <span className="v">{drafts.length ? (
              <select value={draft} onChange={(e) => setDraft(e.target.value)}>{drafts.map((d) => <option key={d.id} value={d.id}>{d.label} — {d.sub}</option>)}</select>
            ) : "no revision in progress"}</span>
            <button type="button" className="btn" disabled={!draft || !!busy} onClick={() => draft && go(draft)}>{busy && busy === draft ? "Preparing…" : "Download"}</button>
          </div>
          <div className={"dlrow" + (archive.length ? "" : " off")}>
            <span className="k">Archive</span>
            <span className="v">{archive.length ? (
              <select value={arch} onChange={(e) => setArch(e.target.value)}>{archive.map((d) => <option key={d.id} value={d.id}>{d.label} — {d.sub}</option>)}</select>
            ) : "no superseded revision"}</span>
            <button type="button" className="btn" disabled={!arch || !!busy} onClick={() => arch && go(arch)}>{busy && busy === arch ? "Preparing…" : "Download"}</button>
          </div>
          {busy && <p className="mini px-3 pb-2">Preparing the PDF with its bookmarks — a few seconds for a large manual.</p>}
          {err && <p className="mini red px-3 pb-2">{err}</p>}
        </div>
      )}
    </div>
  );
}
