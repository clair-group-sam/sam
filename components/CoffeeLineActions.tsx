"use client";
import { useState } from "react";
import { draftReply, lineToTask, markLine } from "@/app/(app)/home/coffee/actions";
import type { RankItem } from "@/lib/coffee-rank";

/** Morning coffee lot 3 · the buttons of one line. Nothing is sent: a reply is drafted to copy; the preferences are remembered for the next recaps. */
export default function CoffeeLineActions({ it }: { it: RankItem }) {
  const [draft, setDraft] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);
  const B = ({ op, label, title }: { op: string; label: string; title: string }) => (
    <form action={markLine} style={{ display: "inline" }}><input type="hidden" name="key" value={it.key ?? ""} /><input type="hidden" name="op" value={op} /><button className="btn" title={title} style={{ padding: "1px 6px", fontSize: 11 }}>{label}</button></form>);
  return (
    <div className="flex gap-1 flex-wrap justify-end mt-1">
      {it.draftable && <button className="btn" style={{ padding: "1px 6px", fontSize: 11 }} disabled={busy} title="SAM drafts a reply you copy into Outlook / Teams — nothing is sent"
        onClick={async () => { setBusy(true); const r = await draftReply({ title: it.title, why: it.why, action: it.action, ctx: it.ctx }); setBusy(false); setDraft(r.ok ? r.text : `Could not draft: ${r.error}`); }}>{busy ? "…" : "Draft reply"}</button>}
      <form action={lineToTask} style={{ display: "inline" }}>
        <input type="hidden" name="title" value={it.title} /><input type="hidden" name="action" value={it.action} /><input type="hidden" name="entity" value={it.entity ?? ""} /><input type="hidden" name="link" value={it.sources.find((x) => x.link?.startsWith("/"))?.link ?? ""} />
        <button className="btn" title="Add it to your Inbox, due today" style={{ padding: "1px 6px", fontSize: 11 }}>To my Inbox</button></form>
      {it.key && <><B op="snooze" label="Tomorrow" title="Hide it until tomorrow" />
        {it.tier > 2 && <B op="important" label="Important" title={`Always at least "Today" from now on: ${it.keyLabel ?? ""}`} />}
        {it.tier < 4 && <B op="muted" label="Not important" title={`Always "Can wait" from now on: ${it.keyLabel ?? ""}`} />}</>}
      {draft !== null && <div className="card" style={{ flexBasis: "100%", marginTop: 6 }}><div className="cb">
        <textarea className="inp" rows={6} defaultValue={draft} id={`d-${it.id}`} />
        <div className="flex gap-2 mt-1 justify-end"><span className="mini" style={{ marginRight: "auto" }}>Draft only — copy it, check it, send it yourself.</span>
          <button className="btn" onClick={() => { const t = (document.getElementById(`d-${it.id}`) as HTMLTextAreaElement | null)?.value ?? draft; navigator.clipboard.writeText(t).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy"}</button>
          <button className="btn" onClick={() => setDraft(null)}>Close</button></div></div></div>}
    </div>
  );
}
