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
import { saveSection } from "@/app/(app)/docs/editor/[rev]/actions";

type Props = { revisionId: string; sectionId: string; refCode: string; title: string; html: string; changed: boolean; editable: boolean };

export default function ChapterEditor({ revisionId, sectionId, refCode, title: title0, html, changed: changed0, editable }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(title0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(changed0);
  const [msg, setMsg] = useState("");
  const baseNorm = useRef<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ inline: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
    content: html,
    editable,
    immediatelyRender: false,
    onCreate: ({ editor }) => { baseNorm.current = editor.getHTML(); },
    onUpdate: () => setDirty(true),
  });
  useEffect(() => { setTitle(title0); setDirty(false); setChanged(changed0); setMsg(""); }, [sectionId, title0, changed0]);

  async function save() {
    if (!editor || saving) return;
    setSaving(true); setMsg("");
    const r = await saveSection({ revisionId, sectionId, html: editor.getHTML(), title, baseNorm: baseNorm.current ?? undefined });
    setSaving(false);
    if (r.ok) { setDirty(false); setChanged(!!r.changed); setMsg(r.changed ? "Saved · marked as changed" : "Saved · identical to the published text"); router.refresh(); }
    else setMsg(r.error ?? "Error");
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
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
      </div>
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
          <span className="flex-1" />
          <span className="mini">{msg || (dirty ? "Unsaved changes" : "")}</span>
          <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save (⌘S)"}</button>
        </div>
      )}
      <div className="edbody">
        <EditorContent editor={editor} className="reader" />
      </div>
    </div>
  );
}
