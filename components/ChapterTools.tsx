"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addChapter, deleteChapter, moveChapter, restoreChapter } from "@/app/(app)/docs/editor/[rev]/actions";

/** Chapter structure of the draft: add after / add a sub-chapter / move / delete or restore. Numbers follow automatically. */
export default function ChapterTools({ revisionId, sectionId, refCode, deleted, isNew }: { revisionId: string; sectionId: string; refCode: string; deleted: boolean; isNew: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState<"after" | "child" | null>(null);
  const [title, setTitle] = useState("");
  async function run(p: Promise<{ ok: boolean; error?: string; focus?: string }>) {
    setBusy(true); setErr("");
    const r = await p; setBusy(false);
    if (!r.ok) { setErr(r.error ?? "Error"); return; }
    setAdding(null); setTitle("");
    router.push(`/docs/editor/${revisionId}?tab=write${r.focus ? `&sec=${encodeURIComponent(r.focus)}` : ""}`);
    router.refresh();
  }
  if (deleted) return (
    <div className="chtools"><span className="mini">Chapter {refCode} is deleted in this revision.</span>
      <button type="button" className="btn" disabled={busy} onClick={() => run(restoreChapter({ revisionId, sectionId }))}>Restore</button>{err && <span className="mini red">{err}</span>}</div>
  );
  return (
    <div className="chtools">
      <span className="eyebrow">Chapter {refCode}</span>
      <button type="button" className="btn" disabled={busy} onClick={() => setAdding(adding === "after" ? null : "after")}>+ Chapter after</button>
      <button type="button" className="btn" disabled={busy} onClick={() => setAdding(adding === "child" ? null : "child")}>+ Sub-chapter</button>
      <button type="button" className="btn" disabled={busy} title="Move up (with its sub-chapters)" onClick={() => run(moveChapter({ revisionId, sectionId, dir: "up" }))}>↑</button>
      <button type="button" className="btn" disabled={busy} title="Move down (with its sub-chapters)" onClick={() => run(moveChapter({ revisionId, sectionId, dir: "down" }))}>↓</button>
      <button type="button" className="btn" disabled={busy} onClick={() => { if (window.confirm(isNew ? `Remove chapter ${refCode} and its sub-chapters?` : `Delete chapter ${refCode} and its sub-chapters in this revision? They stay listed as deleted and can be restored until publication.`)) void run(deleteChapter({ revisionId, sectionId })); }}>Delete</button>
      {busy && <span className="mini">Updating the numbering…</span>}
      {err && <span className="mini red">{err}</span>}
      {adding && (
        <form className="chadd" onSubmit={(e) => { e.preventDefault(); void run(addChapter({ revisionId, sectionId, mode: adding, title })); }}>
          <input autoFocus className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={adding === "child" ? `Title of the new sub-chapter of ${refCode}` : `Title of the chapter after ${refCode}`} />
          <button className="btn primary" type="submit" disabled={busy}>Add</button>
          <button className="btn" type="button" onClick={() => setAdding(null)}>Cancel</button>
        </form>
      )}
    </div>
  );
}
