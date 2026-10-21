"use client";
import { useEffect, useState } from "react";

/** Screen-only toolbar of the PDF page: waits for every figure, then opens the browser's Save as PDF dialog. */
export default function PrintAuto({ fileName, auto }: { fileName: string; auto: boolean }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    document.title = fileName; // Chrome uses the title as the PDF file name
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".pm img"));
    let pending = imgs.filter((i) => !i.complete).length;
    setLeft(pending);
    let done = false;
    const finish = () => { if (done) return; done = true; setLeft(0); if (auto) setTimeout(() => window.print(), 300); };
    if (!pending) { finish(); return; }
    const one = () => { pending -= 1; setLeft(pending); if (pending <= 0) finish(); };
    imgs.forEach((i) => { if (!i.complete) { i.addEventListener("load", one, { once: true }); i.addEventListener("error", one, { once: true }); } });
    const t = setTimeout(finish, 25000);
    return () => clearTimeout(t);
  }, [fileName, auto]);
  const ready = left === 0;
  return (
    <div className="pm-bar">
      <b>{fileName}.pdf</b>
      <span>{ready ? "Ready — choose “Save as PDF” as destination in the dialog." : `Loading figures… ${left ?? ""}`}</span>
      <button type="button" className="btn primary" disabled={!ready} onClick={() => window.print()}>Download PDF</button>
      <button type="button" className="btn" onClick={() => window.close()}>Close</button>
    </div>
  );
}
