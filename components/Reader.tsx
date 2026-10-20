"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Heading, Part } from "@/lib/docs";

export type TocItem = { id: string; ref: string; title: string | null; part: string; headings: Heading[] };
type Hit = { ref: string; title: string | null; snippet: string; n: number };
type Props = {
  manualId: string; revId: string; parts: Part[]; toc: TocItem[];
  active: { ref: string; title: string | null; html: string; part: string; pages: number } | null;
  initialQuery?: string;
};

export default function Reader({ manualId, revId, parts, toc, active, initialQuery = "" }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"toc" | "full">(initialQuery ? "full" : "toc");
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(parts.map((p) => p.key)));
  const [progress, setProgress] = useState(0);
  const [folded, setFolded] = useState(false);
  useEffect(() => { setFolded(false); }, [active?.ref]);
  const art = useRef<HTMLDivElement>(null);
  const colorOf = useMemo(() => Object.fromEntries(parts.map((p) => [p.key, p.color])), [parts]);
  const idx = toc.findIndex((t) => t.ref === active?.ref);
  const prev = idx > 0 ? toc[idx - 1] : null, next = idx >= 0 && idx < toc.length - 1 ? toc[idx + 1] : null;
  const href = (ref: string, extra = "") => `/docs/manual/${manualId}?rev=${revId}&sec=${encodeURIComponent(ref)}${extra}`;

  // full-text search (debounced)
  useEffect(() => {
    if (mode !== "full" || q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try { const r = await fetch(`/api/docs/search?rev=${revId}&q=${encodeURIComponent(q)}`); const j = await r.json(); setHits(j.hits ?? []); } finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode, revId]);

  // chapter content is injected by hand (not by React) so that highlights survive re-renders
  useEffect(() => {
    const el = art.current; if (!el) return;
    el.innerHTML = active?.html ?? "";
    const words = q.trim().toLowerCase().split(/[\s-]+/).filter((w) => w.length > 2);
    if (mode !== "full" || !words.length) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    let first: HTMLElement | null = null;
    for (const t of nodes) {
      if (!re.test(t.data)) continue; re.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0; let m: RegExpExecArray | null;
      while ((m = re.exec(t.data))) { frag.appendChild(document.createTextNode(t.data.slice(last, m.index))); const mk = document.createElement("mark"); mk.className = "hl"; mk.textContent = m[0]; frag.appendChild(mk); first = first ?? mk; last = m.index + m[0].length; }
      frag.appendChild(document.createTextNode(t.data.slice(last))); t.replaceWith(frag);
    }
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [q, mode, active?.ref, active?.html]);

  // reading progress + keyboard navigation
  useEffect(() => {
    const el = art.current?.parentElement; if (!el) return;
    const onScroll = () => { const max = el.scrollHeight - el.clientHeight; setProgress(max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 100); };
    onScroll(); el.addEventListener("scroll", onScroll);
    const onKey = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === "INPUT") return; if (e.key === "ArrowRight" && next) router.push(href(next.ref)); if (e.key === "ArrowLeft" && prev) router.push(href(prev.ref)); };
    window.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("scroll", onScroll); window.removeEventListener("keydown", onKey); };
  });

  const ql = q.trim().toLowerCase();
  const filtered = mode === "toc" && ql ? toc.filter((t) => `${t.ref} ${t.title ?? ""}`.toLowerCase().includes(ql) || t.headings.some((h) => h.text.toLowerCase().includes(ql))) : toc;
  const grouped = parts.map((p) => ({ part: p, items: filtered.filter((t) => t.part === p.key) })).filter((g) => g.items.length);

  return (
    <>
      <div className="findbar">
        <div className="seg">
          <button type="button" className={mode === "toc" ? "on" : ""} onClick={() => setMode("toc")}>Contents</button>
          <button type="button" className={mode === "full" ? "on" : ""} onClick={() => setMode("full")}>Full text</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === "toc" ? "Filter chapters and sub-chapters…" : "Search every word of this manual…"} autoFocus={!!initialQuery} />
        {q && <button type="button" className="clr" onClick={() => { setQ(""); setHits(null); }} aria-label="Clear">×</button>}
        <span className="mini">{mode === "full" ? (busy ? "searching…" : hits ? `${hits.length} passage${hits.length === 1 ? "" : "s"}` : "type at least 2 letters") : `${filtered.length} / ${toc.length} chapters`}</span>
        {active && <span className="mini ml-auto">Chapter {idx + 1} / {toc.length} · {progress}% read</span>}
      </div>

      <div className="flex gap-4 items-start">
        <aside className="card toc">
          {mode === "full" && hits && (
            <div className="hits">
              {hits.map((h, i) => (
                <Link key={i} href={href(h.ref, "")} onClick={(e) => { e.preventDefault(); router.push(href(h.ref)); }} className={"hit" + (active?.ref === h.ref ? " on" : "")}>
                  <span className="badge" style={{ background: colorOf[partOfRef(h.ref)] }}>{h.ref}</span>
                  <span className="t">{h.title}</span>
                  <span className="s">…{h.snippet}…</span>
                </Link>
              ))}
              {!hits.length && <div className="p-4 text-slate6 text-sm">No passage contains these words.</div>}
            </div>
          )}
          {(mode === "toc" || !hits) && grouped.map(({ part, items }) => (
            <div key={part.key} className="tocpart">
              <button type="button" className="ph" style={{ color: part.color }} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(part.key)) n.delete(part.key); else n.add(part.key); return n; })}>
                <i style={{ background: part.color }} />{part.label}<span className="mini">{items.length}</span><b>{open.has(part.key) ? "▾" : "▸"}</b>
              </button>
              {(open.has(part.key) || !!ql) && items.map((t) => (
                <div key={t.id}>
                  <Link href={href(t.ref)} className={"tocch" + (active?.ref === t.ref ? " on" : "")}
                    onClick={(e) => { if (active?.ref === t.ref && t.headings.length) { e.preventDefault(); setFolded((f) => !f); } }}>
                    <span className="badge" style={{ background: part.color }}>{t.ref}</span><span>{t.title}</span>
                    {t.headings.length > 0 && <b className="fold">{active?.ref === t.ref && !folded ? "▾" : "▸"}</b>}
                  </Link>
                  {((active?.ref === t.ref && !folded) || !!ql) && t.headings.filter((h) => !ql || h.text.toLowerCase().includes(ql) || `${t.ref} ${t.title ?? ""}`.toLowerCase().includes(ql)).map((h) => (
                    <a key={h.id} href={active?.ref === t.ref ? `#${h.id}` : href(t.ref) + `#${h.id}`} className={"sh l" + h.level} onClick={(e) => { if (active?.ref === t.ref) { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ block: "start", behavior: "smooth" }); } }}>{h.text}</a>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {!grouped.length && mode === "toc" && <div className="p-4 text-slate6 text-sm">No chapter matches.</div>}
        </aside>

        <section className="card flex-1 min-w-0 readwrap" style={{ borderTopColor: active ? colorOf[active.part] : undefined }}>
          {active ? (<>
            <div className="chaphead" style={{ background: `${colorOf[active.part]}12` }}>
              <span className="badge big" style={{ background: colorOf[active.part] }}>{active.ref}</span>
              <div><div className="eyebrow" style={{ color: colorOf[active.part] }}>{parts.find((p) => p.key === active.part)?.label}</div><h2>{active.title}</h2></div>
              <span className="mini ml-auto">{active.pages} page{active.pages > 1 ? "s" : ""}</span>
            </div>
            <div className="readscroll">
              <article ref={art} className="reader" onClick={(e) => { const a = (e.target as HTMLElement).closest("a[data-nav]") as HTMLAnchorElement | null; if (a) { e.preventDefault(); const u = new URL(a.href); router.push(u.pathname + u.search + u.hash); if (u.hash) setTimeout(() => document.getElementById(u.hash.slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" }), 400); } }} style={{ "--pc": colorOf[active.part] } as React.CSSProperties} />
              <div className="pager">
                {prev ? <Link href={href(prev.ref)}>‹ {prev.ref} {prev.title}</Link> : <span />}
                {next ? <Link href={href(next.ref)}>{next.ref} {next.title} ›</Link> : <span />}
              </div>
            </div>
          </>) : <div className="cb text-slate6">Nothing to read.</div>}
        </section>
      </div>
    </>
  );
}
function partOfRef(ref: string): string { const m = /^([A-Za-z]+|\d+)/.exec(ref); return m ? m[1].toUpperCase() : "?"; }
