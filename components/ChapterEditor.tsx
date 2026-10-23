"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { saveSection, revertSection } from "@/app/(app)/docs/editor/[rev]/actions";
import AiPanel from "@/components/AiPanel";

type Props = { revisionId: string; sectionId: string; refCode: string; title: string; html: string; changed: boolean; editable: boolean; frozenBy?: string | null; baseRevLabel?: string };

export default function ChapterEditor({ revisionId, sectionId, refCode, title: title0, html, changed: changed0, editable: editable0, frozenBy = null, baseRevLabel = "the published revision" }: Props) {
  const editable = editable0 && !frozenBy;
  const router = useRouter();
  const [title, setTitle] = useState(title0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(changed0);
  const [msg, setMsg] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const baseNorm = useRef<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ inline: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
    content: html,
    editable,
    immediatelyRender: false,
    onCreate: ({ editor }) => { baseNorm.current = editor.getHTML(); },
    onUpdate: () => { setDirty(true); setMsg(""); },
  });
  useEffect(() => { setTitle(title0); setDirty(false); setChanged(changed0); setMsg(""); setSavedAt(null); }, [sectionId, title0, changed0]);
  // leaving the page with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    if (!editor || saving) return;
    setSaving(true); setMsg("");
    const r = await saveSection({ revisionId, sectionId, html: editor.getHTML(), title, baseNorm: baseNorm.current ?? undefined });
    setSaving(false);
    if (r.ok) { setDirty(false); setChanged(!!r.changed); setSavedAt(new Date().toTimeString().slice(0, 5)); setMsg(r.changed ? "marked as changed" : "identical to the published text"); router.refresh(); }
    else setMsg(r.error ?? "Error");
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  function discard() { if (!editor) return; editor.commands.setContent(html, false); setTitle(title0); setDirty(false); setMsg("back to the last saved state"); }
  async function revert() {
    if (!editor || saving) return;
    if (!window.confirm(`Revert chapter ${refCode} to the text of ${baseRevLabel}? Your changes in this revision will be lost.`)) return;
    setSaving(true);
    const r = await revertSection({ revisionId, sectionId });
    setSaving(false);
    if (r.ok) { editor.commands.setContent(r.html ?? "", false); baseNorm.current = editor.getHTML(); setDirty(false); setChanged(false); setMsg("Chapter reverted"); router.refresh(); } else setMsg(r.error ?? "Error");
  }
  if (!editor) return <div className="cb text-slate6">Loading editor…</div>;
  const B = ({ on, act, label, title }: { on?: boolean; act: () => void; label: string; title?: string }) => (
    <button type="button" className={"tb" + (on ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); act(); }} title={title ?? label} disabled={!editable}>{label}</button>
  );
  return (
    <div className="edwrap">
      <div className="edhead">
        <span className="badge big">{refCode}</span>
        <input className="edtitle" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} disabled={!editable} />
        {changed && <span className="pill amber">changed in this revision</span>}
        {frozenBy && <span className="pill red">frozen · changed in Rev {frozenBy}, under review</span>}
      </div>
      {frozenBy && <div className="lockbar">This chapter was modified in Rev {frozenBy}, which is still with Compliance or the authority. It is read-only here and will receive the approved text automatically when Rev {frozenBy} is published.</div>}
      {editable && (
        <div className="toolbar">
          <B label="B" title="Bold" on={editor.isActive("bold")} act={() => editor.chain().focus().toggleBold().run()} />
          <B label="I" title="Italic" on={editor.isActive("italic")} act={() => editor.chain().focus().toggleItalic().run()} />
          <span className="sep" />
          <B label="¶" title="Paragraph" on={editor.isActive("paragraph")} act={() => editor.chain().focus().setParagraph().run()} />
          <B label="H2" title="Sub-chapter" on={editor.isActive("heading", { level: 2 })} act={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <B label="H3" title="Sub-section" on={editor.isActive("heading", { level: 3 })} act={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <B label="H4" title="Heading 4" on={editor.isActive("heading", { level: 4 })} act={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} />
          <span className="sep" />
          <B label="• List" on={editor.isActive("bulletList")} act={() => editor.chain().focus().toggleBulletList().run()} />
          <B label="1. List" on={editor.isActive("orderedList")} act={() => editor.chain().focus().toggleOrderedList().run()} />
          <span className="sep" />
          <B label="Table" act={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          <B label="+ Row" act={() => editor.chain().focus().addRowAfter().run()} />
          <B label="+ Col" act={() => editor.chain().focus().addColumnAfter().run()} />
          <B label="− Row" act={() => editor.chain().focus().deleteRow().run()} />
          <B label="− Col" act={() => editor.chain().focus().deleteColumn().run()} />
          <B label="✕ Table" act={() => editor.chain().focus().deleteTable().run()} />
          <span className="sep" />
          <B label="↶" title="Undo" act={() => editor.chain().focus().undo().run()} />
          <B label="↷" title="Redo" act={() => editor.chain().focus().redo().run()} />
          <span className="sep" />
          <button type="button" className={"tb ai" + (ai ? " on" : "")} onClick={() => setAi((v) => !v)} title="Draft with AI">✦ AI</button>
          <span className="flex-1" />
          <span className={"mini" + (dirty ? " savestate dirty" : "")}>{dirty ? "● Unsaved changes" : msg}</span>
          {dirty && <button type="button" className="btn" onClick={discard} disabled={saving} title="Back to the last saved state of this chapter">Cancel changes</button>}
          {changed && !dirty && <button type="button" className="btn" onClick={revert} disabled={saving} title="Back to the text of the base revision">Revert chapter</button>}
          <button type="button" className={"btn save " + (saving ? "busy" : dirty ? "dirty" : "clean")} onClick={save} disabled={saving || !dirty}
            title={dirty ? "Save this chapter (⌘S)" : "Everything is saved"}>
            {saving ? "Saving…" : dirty ? "Save changes (⌘S)" : savedAt ? `✓ Saved ${savedAt}` : "✓ Up to date"}
          </button>
        </div>
      )}
      <div className={"edsplit" + (ai ? " withai" : "")}>
        <div className="edbody">
          <EditorContent editor={editor} className="reader" />
        </div>
        {ai && editable && <AiPanel editor={editor} revisionId={revisionId} sectionId={sectionId} onInserted={() => { setDirty(true); setMsg("Proposal inserted — review, then save"); }} onClose={() => setAi(false)} />}
      </div>
    </div>
  );
}
