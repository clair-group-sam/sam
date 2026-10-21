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
  const go = (rev: string) => { window.open(`/print/manual/${manualId}?rev=${rev}&auto=1`, "_blank", "noopener"); setOpen(false); };
  return (
    <div className="dlmenu" ref={box}>
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Download PDF ▾</button>
      {open && (
        <div className="dlpanel" role="menu">
          <div className={"dlrow" + (published ? "" : " off")}>
            <span className="k">Published</span>
            <span className="v">{published ? <>{published.label}<small>{published.sub}</small></> : "no published revision"}</span>
            <button type="button" className="btn primary" disabled={!published} onClick={() => published && go(published.id)}>Download</button>
          </div>
          <div className={"dlrow" + (drafts.length ? "" : " off")}>
            <span className="k">Draft</span>
            <span className="v">{drafts.length ? (
              <select value={draft} onChange={(e) => setDraft(e.target.value)}>{drafts.map((d) => <option key={d.id} value={d.id}>{d.label} — {d.sub}</option>)}</select>
            ) : "no revision in progress"}</span>
            <button type="button" className="btn" disabled={!draft} onClick={() => draft && go(draft)}>Download</button>
          </div>
          <div className={"dlrow" + (archive.length ? "" : " off")}>
            <span className="k">Archive</span>
            <span className="v">{archive.length ? (
              <select value={arch} onChange={(e) => setArch(e.target.value)}>{archive.map((d) => <option key={d.id} value={d.id}>{d.label} — {d.sub}</option>)}</select>
            ) : "no superseded revision"}</span>
            <button type="button" className="btn" disabled={!arch} onClick={() => arch && go(arch)}>Download</button>
          </div>
        </div>
      )}
    </div>
  );
}
