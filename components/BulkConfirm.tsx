"use client";
import { useState } from "react";

/* FB-088 · a bulk action never fires on one click: nothing is pre-ticked, an optional link ticks the suggested rows (data-suggest="1"),
   and the button first says how many rows it will touch. */
export function BulkConfirm({ formId, label, verb, suggestLabel }: { formId: string; label: string; verb: string; suggestLabel?: string }) {
  const [n, setN] = useState<number | null>(null);
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="ids"][form="${formId}"]`)];
  const suggest = () => { for (const b of boxes()) b.checked = b.dataset.suggest === "1"; setN(null); };
  const none = () => { for (const b of boxes()) b.checked = false; setN(null); };
  return (
    <span className="flex gap-2 items-center flex-wrap">
      {n === null ? <button type="button" className="btn" onClick={() => setN(boxes().filter((b) => b.checked).length)}>{label}</button>
        : n === 0 ? <><span className="mini">Nothing is ticked.</span><button type="button" className="btn" onClick={() => setN(null)}>OK</button></>
        : <><b className="mini">{verb} {n} line{n === 1 ? "" : "s"}?</b><button type="submit" className="btn primary">Yes, {verb.toLowerCase()} {n}</button><button type="button" className="btn" onClick={() => setN(null)}>Cancel</button></>}
      {suggestLabel && n === null && <><button type="button" className="linkbtn mini underline" onClick={suggest}>{suggestLabel}</button><button type="button" className="linkbtn mini underline" onClick={none}>untick all</button></>}
    </span>
  );
}
