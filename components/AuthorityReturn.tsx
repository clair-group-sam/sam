"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { recordReturn } from "@/app/(app)/docs/editor/[rev]/actions";
import type { ReturnKind } from "@/lib/revisions";

// pdf.js is loaded from the CDN at run time (not bundled): it only renders the authority's PDF into page images in the browser.
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
type Role = "" | "approval" | "lep" | "signature";
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }> };

async function loadPdf(file: File): Promise<PdfDoc> {
  const url = PDFJS;
  const lib = await import(/* webpackIgnore: true */ url);
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  return (await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise) as PdfDoc;
}
async function renderPage(doc: PdfDoc, n: number, scale: number, type: "image/png" | "image/jpeg"): Promise<Blob> {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), type, 0.8));
}

/** DOC-03 · upload what the authority sent back; pick the pages S.A.M. keeps in the manual (page 0.0 / stamped LEP). */
export default function AuthorityReturn({ revisionId, entity, code, rev, kind }: { revisionId: string; entity: string; code: string; rev: string; kind: ReturnKind }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(f: File | null) {
    setFile(f); setThumbs([]); setRoles([]); setDoc(null); setMsg("");
    if (!f) return;
    setBusy(true); setMsg("Reading the PDF…");
    try {
      const d = await loadPdf(f); setDoc(d);
      const n = Math.min(d.numPages, 400), urls: string[] = [];
      for (let i = 1; i <= n; i++) { urls.push(URL.createObjectURL(await renderPage(d, i, 0.3, "image/jpeg"))); if (i % 10 === 0 || i === n) { setThumbs([...urls]); setMsg(`Reading the PDF… ${i} / ${n} pages`); } }
      setRoles(urls.map((_, i) => (kind === "approval_page" && i === 0 ? "approval" : kind === "approval_lep" ? (i === 0 ? "approval" : n <= 20 ? "lep" : "") : "")));
      setMsg(kind === "consolidated" ? "Mark the signature page(s) of the authority." : "Check the pages S.A.M. keeps, then integrate.");
    } catch (e) { setMsg(`Could not read the PDF: ${(e as Error).message}`); }
    setBusy(false);
  }

  async function integrate() {
    if (!file || !doc) return;
    const kept = roles.map((r, i) => ({ r, i })).filter((x) => x.r);
    if (kind !== "none" && !kept.length) { setMsg("Select at least one page to keep in the manual."); return; }
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const dir = `${entity}/${code}/${rev}/authority`;
      setMsg("Uploading the authority's PDF…");
      const up = await sb.storage.from("manuals").upload(`${dir}/return.pdf`, file, { upsert: true, contentType: "application/pdf" });
      if (up.error) throw new Error(up.error.message);
      const pages: { path: string; role: "approval" | "lep" | "signature"; page: number }[] = [];
      for (const [k, x] of kept.entries()) {
        setMsg(`Preparing page ${x.i + 1} (${k + 1} / ${kept.length})…`);
        const blob = await renderPage(doc, x.i + 1, 2, "image/png");
        const path = `${dir}/p${x.i + 1}.png`;
        const u = await sb.storage.from("manuals").upload(path, blob, { upsert: true, contentType: "image/png" });
        if (u.error) throw new Error(u.error.message);
        pages.push({ path, role: x.r as "approval" | "lep" | "signature", page: x.i + 1 });
      }
      const r = await recordReturn({ revisionId, kind, pdfPath: `${dir}/return.pdf`, pages, receivedAt: date });
      if (!r.ok) throw new Error(r.error);
      setMsg("Integrated."); router.refresh();
    } catch (e) { setMsg(`Failed: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <div className="aret">
      <div className="flex gap-3 items-end flex-wrap">
        <label className="flex-1 min-w-[220px]"><span className="eyebrow">PDF received from the authority</span>
          <input type="file" accept="application/pdf" className="inp" disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
        <label><span className="eyebrow">Received on</span><input type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" className="btn primary" disabled={busy || !doc} onClick={integrate}>Integrate in the manual</button>
      </div>
      {msg && <p className="mini mt-2">{msg}</p>}
      {thumbs.length > 0 && (
        <div className="athumbs">
          {thumbs.map((u, i) => (
            <div key={i} className={"athumb" + (roles[i] ? " on" : "")}>
              <img src={u} alt={`page ${i + 1}`} />
              <select value={roles[i] ?? ""} onChange={(e) => setRoles((r) => r.map((x, j) => (j === i ? (e.target.value as Role) : x)))}>
                <option value="">p. {i + 1} — not kept</option>
                <option value={kind === "consolidated" ? "signature" : "approval"}>p. {i + 1} — {kind === "consolidated" ? "signature page" : "approval page"}</option>
                {kind !== "consolidated" && <option value="lep">p. {i + 1} — stamped LEP</option>}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
