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
import LinkExt from "@tiptap/extension-link";
import { OrgChartNode } from "@/components/OrgChartNode";
import LinkPicker, { type Chap } from "@/components/LinkPicker";
import { saveSection, revertSection, uploadImage, orgSnapshot } from "@/app/(app)/docs/editor/[rev]/actions";
import AiPanel from "@/components/AiPanel";

type Props = { revisionId: string; sectionId: string; refCode: string; title: string; html: string; changed: boolean; editable: boolean; frozenBy?: string | null; baseRevLabel?: string; manualId?: string; chapters?: Chap[] };

export default function ChapterEditor({ revisionId, sectionId, refCode, title: title0, html, changed: changed0, editable: editable0, frozenBy = null, baseRevLabel = "the published revision", manualId = "", chapters = [] }: Props) {
  const editable = editable0 && !frozenBy;
  const router = useRouter();
  const [title, setTitle] = useState(title0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(changed0);
  const [msg, setMsg] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // where the user wanted to go with unsaved changes
  const [recover, setRecover] = useState<{ html: string; title: string; at: string } | null>(null);
  const titleRef = useRef(title0);
  const draftKey = `sam_unsaved_${sectionId}`;
  const keepLocal = (h: string) => { try { localStorage.setItem(draftKey, JSON.stringify({ html: h, title: titleRef.current, at: new Date().toTimeString().slice(0, 5) })); } catch {} };
  const dropLocal = () => { try { localStorage.removeItem(draftKey); } catch {} };
  const [ai, setAi] = useState(false);
  const [linking, setLinking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const baseNorm = useRef<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ inline: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      LinkExt.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: null, target: null } }), OrgChartNode],
    content: html,
    editable,
    immediatelyRender: false,
    onCreate: ({ editor }) => { baseNorm.current = editor.getHTML(); },
    onUpdate: ({ editor: ed }) => { setDirty(true); setMsg(""); keepLocal(ed.getHTML()); },
  });
  useEffect(() => { setTitle(title0); setDirty(false); setChanged(changed0); setMsg(""); setSavedAt(null); }, [sectionId, title0, changed0]);
  // unsaved work left behind earlier (another chapter opened, menu clicked, tab closed…): offer to restore it
  useEffect(() => {
    try { const raw = localStorage.getItem(draftKey); if (!raw) return; const d = JSON.parse(raw) as { html: string; title: string; at: string }; if (d.html && d.html !== html) setRecover(d); else dropLocal(); } catch {}
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // any link clicked with unsaved changes: ask (save / leave without saving / stay)
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.closest(".ProseMirror")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname + url.search === window.location.pathname + window.location.search) return;
      e.preventDefault(); e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);
  // leaving the page with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(): Promise<boolean> {
    if (!editor || saving) return false;
    setSaving(true); setMsg("");
    const r = await saveSection({ revisionId, sectionId, html: editor.getHTML(), title, baseNorm: baseNorm.current ?? undefined });
    setSaving(false);
    if (r.ok) { setDirty(false); dropLocal(); setRecover(null); setChanged(!!r.changed); setSavedAt(new Date().toTimeString().slice(0, 5)); setMsg(r.changed ? "marked as changed" : "identical to the published text"); router.refresh(); return true; }
    setMsg(r.error ?? "Error"); return false;
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  function discard() { if (!editor) return; editor.commands.setContent(html, false); setTitle(title0); titleRef.current = title0; setDirty(false); dropLocal(); setMsg("back to the last saved state"); }
  async function revert() {
    if (!editor || saving) return;
    if (!window.confirm(`Revert chapter ${refCode} to the text of ${baseRevLabel}? Your changes in this revision will be lost.`)) return;
    setSaving(true);
    const r = await revertSection({ revisionId, sectionId });
    setSaving(false);
    if (r.ok) { editor.commands.setContent(r.html ?? "", false); baseNorm.current = editor.getHTML(); setDirty(false); dropLocal(); setChanged(false); setMsg("Chapter reverted"); router.refresh(); } else setMsg(r.error ?? "Error");
  }
  if (!editor) return <div className="cb text-slate6">Loading editor…</div>;
  function pickLink(href: string, label: string) {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinking(false);
  }
  async function addChart() {
    if (!editor) return;
    setMsg("Drawing the chart from NP management…");
    const r = await orgSnapshot({ revisionId });
    if (!r.ok) { setMsg(r.error); return; }
    editor.chain().focus().insertContent({ type: "orgChart", attrs: { entity: r.entity, snapshot: r.snapshot } }).run();
    setMsg("Organisation chart inserted — save the chapter");
  }
  async function addImage(f: File | null) {
    if (!f || !editor) return;
    setMsg("Uploading the image…");
    const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.readAsDataURL(f); });
    const r = await uploadImage({ revisionId, name: f.name, type: f.type, b64 });
    if (r.ok && r.src) { editor.chain().focus().setImage({ src: r.src, alt: f.name }).run(); setMsg("Image inserted — save the chapter"); } else setMsg(r.error ?? "Upload failed");
    if (fileRef.current) fileRef.current.value = "";
  }
  const B = ({ on, act, label, title }: { on?: boolean; act: () => void; label: string; title?: string }) => (
    <button type="button" className={"tb" + (on ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); act(); }} title={title ?? label} disabled={!editable}>{label}</button>
  );
  return (
    <div className="edwrap">
      <div className="edhead">
        <span className="badge big">{refCode}</span>
        <input className="edtitle" value={title} onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; setDirty(true); keepLocal(editor.getHTML()); }} disabled={!editable} />
        {changed && <span className="pill amber">changed in this revision</span>}
        {frozenBy && <span className="pill red">frozen · changed in Rev {frozenBy}, under review</span>}
      </div>
      {recover && editable && (
        <div className="recoverbar">
          <span>You left unsaved changes in this chapter at {recover.at}.</span>
          <button type="button" className="btn primary" onClick={() => { editor.commands.setContent(recover.html); setTitle(recover.title); titleRef.current = recover.title; setDirty(true); setRecover(null); setMsg(""); }}>Restore them</button>
          <button type="button" className="btn" onClick={() => { dropLocal(); setRecover(null); }}>Discard</button>
        </div>
      )}
      {pending && (
        <div className="modalbg" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <b>Unsaved changes in chapter {refCode}</b>
            <p className="mini mt-1 mb-3">Save them before leaving the chapter, or leave without saving (they will be lost).</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn save dirty" disabled={saving} onClick={async () => { const to = pending; if (await save()) { setPending(null); router.push(to); } }}>{saving ? "Saving…" : "Save and continue"}</button>
              <button type="button" className="btn" onClick={() => { const to = pending; dropLocal(); setDirty(false); setPending(null); router.push(to); }}>Leave without saving</button>
              <button type="button" className="btn" onClick={() => setPending(null)}>Stay</button>
            </div>
          </div>
        </div>
      )}
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
          <B label="🔗 Link" title="Link to a chapter, another manual or a web address" on={editor.isActive("link") || linking} act={() => setLinking((v) => !v)} />
          <B label="🖼 Image" title="Insert an image (PNG, JPG…)" act={() => fileRef.current?.click()} />
          <B label="🏢 Org chart" title="Insert the organisation chart from NP management (frozen with this revision)" act={() => void addChart()} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void addImage(e.target.files?.[0] ?? null)} />
          <span className="sep" />
          <B label="↶" title="Undo" act={() => editor.chain().focus().undo().run()} />
          <B label="↷" title="Redo" act={() => editor.chain().focus().redo().run()} />
          <span className="sep" />
          <button type="button" className={"tb ai" + (ai ? " on" : "")} onClick={() => setAi((v) => !v)} title="Work with SAM: draft, rewrite, translate or check this chapter">🤝 Work with SAM</button>
          <span className="flex-1" />
          <span className={"mini" + (dirty ? " savestate dirty" : "")}>{dirty ? "● Unsaved changes" : msg}</span>
          {dirty && <button type="button" className="btn" onClick={discard} disabled={saving} title="Back to the last saved state of this chapter">Cancel changes</button>}
          {changed && !dirty && <button type="button" className="btn" onClick={revert} disabled={saving} title="Back to the text of the base revision">Revert chapter</button>}
          <button type="button" className={"btn save " + (saving ? "busy" : dirty ? "dirty" : "clean")} onClick={() => void save()} disabled={saving || !dirty}
            title={dirty ? "Save this chapter (⌘S)" : "Everything is saved"}>
            {saving ? "Saving…" : dirty ? "Save changes (⌘S)" : savedAt ? `✓ Saved ${savedAt}` : "✓ Up to date"}
          </button>
        </div>
      )}
      {linking && editable && <LinkPicker manualId={manualId} chapters={chapters} initialUrl={editor.getAttributes("link").href as string | undefined}
        onPick={pickLink} onRemove={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinking(false); }} onClose={() => setLinking(false)} />}
      <div className={"edsplit" + (ai ? " withai" : "")}>
        <div className="edbody">
          <EditorContent editor={editor} className="reader" />
        </div>
        {ai && editable && <AiPanel editor={editor} revisionId={revisionId} sectionId={sectionId} onInserted={() => { setDirty(true); setMsg("SAM's proposal inserted — review, then save"); }} onClose={() => setAi(false)} />}
      </div>
    </div>
  );
}
