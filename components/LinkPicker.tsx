"use client";
import { useEffect, useState } from "react";
import { linkTargets } from "@/app/(app)/docs/editor/[rev]/actions";

export type Chap = { ref: string; title: string | null; uid: string };
type Man = { id: string; entity: string; code: string; title: string };

/** Link to a chapter of this manual, a chapter of another manual in S.A.M. (stable chapter ids: renumbering keeps links right), or a web address. */
export default function LinkPicker({ manualId, chapters, initialUrl, onPick, onRemove, onClose }: { manualId: string; chapters: Chap[]; initialUrl?: string; onPick: (href: string, label: string) => void; onRemove: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<"self" | "other" | "web">(initialUrl && /^https?:/.test(initialUrl) ? "web" : "self");
  const [q, setQ] = useState("");
  const [manuals, setManuals] = useState<Man[]>([]);
  const [other, setOther] = useState("");
  const [otherCh, setOtherCh] = useState<Chap[]>([]);
  const [url, setUrl] = useState(initialUrl && /^https?:/.test(initialUrl) ? initialUrl : "https://");
  useEffect(() => { if (tab === "other" && !manuals.length) void linkTargets({}).then((r) => setManuals(r.manuals.filter((m) => m.id !== manualId))); }, [tab, manuals.length, manualId]);
  useEffect(() => { if (other) void linkTargets({ manualId: other }).then((r) => setOtherCh(r.chapters)); else setOtherCh([]); }, [other]);
  const f = (c: Chap) => !q || `${c.ref} ${c.title ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const man = manuals.find((m) => m.id === other);
  return (
    <div className="lpick">
      <div className="flex items-center gap-1 mb-2">
        {([["self", "This manual"], ["other", "Another manual"], ["web", "Web address"]] as const).map(([k, l]) => <button key={k} type="button" className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>)}
        <span className="flex-1" />
        {initialUrl && <button type="button" className="btn" onClick={onRemove}>Remove the link</button>}
        <button type="button" className="btn" onClick={onClose}>✕</button>
      </div>
      {tab !== "web" && <input className="inp mb-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter chapters…" />}
      {tab === "self" && <div className="lplist">{chapters.filter(f).map((c) => <button key={c.uid} type="button" onClick={() => onPick(`/docs/link/ch/${manualId}/${c.uid}`, `${c.ref} ${c.title ?? ""}`.trim())}><span className="mono">{c.ref}</span> {c.title}</button>)}</div>}
      {tab === "other" && (<>
        <select className="inp mb-2" value={other} onChange={(e) => setOther(e.target.value)}><option value="">— choose a manual —</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.entity} · {m.code} — {m.title}</option>)}</select>
        <div className="lplist">{otherCh.filter(f).map((c) => <button key={c.uid} type="button" onClick={() => onPick(`/docs/link/ch/${other}/${c.uid}`, `${man?.code ?? ""} ${c.ref} ${c.title ?? ""}`.trim())}><span className="mono">{c.ref}</span> {c.title}</button>)}
          {other && !otherCh.length && <span className="mini">No published chapter in this manual.</span>}</div>
      </>)}
      {tab === "web" && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^https?:\/\/[^\s]+\.[^\s]+/.test(url)) onPick(url, url); }}>
          <input className="inp flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus />
          <button className="btn primary" type="submit">Insert</button>
        </form>
      )}
    </div>
  );
}
