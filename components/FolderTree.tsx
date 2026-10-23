"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export type TNode = { name: string; full: string; depth: number; count: number; worst: 0 | 1 | 2; href: string; color?: string; entity?: boolean; children: TNode[] };
const dot = (w: 0 | 1 | 2) => (w === 2 ? "var(--terra)" : w === 1 ? "var(--amber)" : "var(--green)");
const KEY = "sam_lib_open";

/** Library folders: entities and folders expand / collapse (remembered in this browser); the selected folder stays open. */
export default function FolderTree({ nodes, selected, total, several }: { nodes: TNode[]; selected: string; total: number; several: boolean }) {
  const [open, setOpen] = useState<Set<string> | null>(null);
  useEffect(() => {
    let saved: string[] | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch {}
    const s = new Set<string>(saved ?? (several ? [] : nodes.map((n) => n.full)));
    // the path of the selected folder is always open
    if (selected) { const parts = selected.split(" › "); for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join(" › ")); }
    setOpen(s);
  }, [selected, several, nodes]);
  const save = (s: Set<string>) => { setOpen(new Set(s)); try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch {} };
  const toggle = (full: string) => { if (!open) return; const s = new Set(open); if (s.has(full)) s.delete(full); else s.add(full); save(s); };
  const all = (): string[] => { const out: string[] = []; const walk = (ns: TNode[]) => ns.forEach((n) => { if (n.children.length) { out.push(n.full); walk(n.children); } }); walk(nodes); return out; };
  const isOpen = (full: string) => open?.has(full) ?? !several;

  const render = (ns: TNode[]): React.ReactNode => ns.map((n) => (
    <div key={n.full}>
      <div className={"fnode d" + n.depth + (n.entity ? " ent-node " + n.name.slice(-4, -1) : "") + (selected === n.full ? " on" : "")} style={n.depth === 0 && n.color ? { borderLeftColor: n.color } : undefined}>
        {n.children.length > 0
          ? <button type="button" className={"fchev" + (isOpen(n.full) ? " open" : "")} onClick={() => toggle(n.full)} aria-label={isOpen(n.full) ? "Collapse" : "Expand"} aria-expanded={isOpen(n.full)}>›</button>
          : <span className="fchev empty" />}
        <i className="fdot" style={{ background: dot(n.worst) }} />
        <Link href={n.href} className="fname" style={n.color && n.depth <= 1 ? { color: n.color } : undefined}>{n.name}</Link>
        <span className="fcount">{n.count}</span>
      </div>
      {n.children.length > 0 && isOpen(n.full) && render(n.children)}
    </div>
  ));

  return (
    <div className="p-2">
      <div className="flex items-center gap-1 mb-1">
        <Link href="/docs/lib" className={"fnode d0 all flex-1" + (!selected ? " on" : "")}><span className="fname">All documents</span><span className="fcount">{total}</span></Link>
      </div>
      <div className="ftools"><button type="button" onClick={() => save(new Set(all()))}>Expand all</button><button type="button" onClick={() => save(new Set())}>Collapse all</button></div>
      {render(nodes)}
    </div>
  );
}
