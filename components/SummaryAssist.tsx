"use client";
import { useState } from "react";
import { aiSummary } from "@/app/(app)/docs/editor/[rev]/actions";
import { Icon } from "@/lib/icons";

/** "What changed" for the readers: SAM drafts it from the changed chapters (base text vs draft); the author edits and saves. */
export default function SummaryAssist({ revisionId, textareaName = "summary" }: { revisionId: string; textareaName?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run() {
    if (busy) return; setBusy(true); setMsg("");
    const form = (document.activeElement as HTMLElement | null)?.closest("form") ?? document.querySelector(`textarea[name="${textareaName}"]`)?.closest("form");
    const ta = (form?.querySelector(`textarea[name="${textareaName}"]`) ?? document.querySelector(`textarea[name="${textareaName}"]`)) as HTMLTextAreaElement | null;
    const r = await aiSummary({ revisionId, reason: ta?.value?.trim() && ta.value.trim().length < 300 ? ta.value.trim() : undefined });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    if (ta) { ta.value = r.summary; ta.dispatchEvent(new Event("input", { bubbles: true })); }
    setMsg(`Drafted from ${r.changed} changed chapter${r.changed === 1 ? "" : "s"} — read it, adjust, then Save.`);
  }
  return (
    <div className="flex items-center gap-2 mt-2 mini">
      <button type="button" className="btn" onClick={run} disabled={busy}>{busy ? "SAM is reading the changes…" : <><Icon name="bulb" size={14} /> Draft it with SAM</>}</button>
      <span>{msg || "From the chapters marked as changed. A short note typed above is used as the reason."}</span>
    </div>
  );
}
