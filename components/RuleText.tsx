import type { RegItem } from "@/lib/regulation-items";
/* REG-03 · the official text of a rule with its AMC / GM, as loaded from the EASA export (version shown). Read-only. */
export function RuleText({ items, version, onlineUrl, compact }: { items: RegItem[]; version: string; onlineUrl?: string | null; compact?: boolean }) {
  const ir = items.filter((i) => i.kind === "ir" || i.kind === "cs"), rest = items.filter((i) => i.kind === "amc" || i.kind === "gm");
  const Body = ({ it }: { it: RegItem }) => <div className="ruletext">{it.body.map((b, i) => b.l === -1 ? <div key={i} className="rt-h">{b.t}</div> : b.l === -2 ? <div key={i} className="mini rt-src">{b.t}</div> : <p key={i} style={{ marginLeft: Math.max(0, b.l) * 18 }} className={/^\[applicable/i.test(b.t) ? "mini rt-appl" : ""}>{b.t}</p>)}</div>;
  return (
    <div className="grid gap-3">
      {ir.map((it) => <section key={it.id} className="card"><div className="ch"><span><b className="mono">{it.ref}</b> {it.title}</span><span className="mini">{it.source} · {version}{it.change && it.change !== "unchanged" ? <span className="pill amber" style={{ marginLeft: 8 }}>{it.change}</span> : null}</span></div><div className="cb"><Body it={it} />{!compact && <div className="mini">{it.annex}{it.section ? ` · ${it.section}` : ""}</div>}</div></section>)}
      {rest.length > 0 && <details className="card" open={!compact}><summary className="ch"><span className="eyebrow">AMC &amp; GM · {rest.length}</span></summary>
        <div className="cb grid gap-3">{rest.map((it) => <div key={it.id}><div><b className="mono">{it.ref}</b> {it.title} <span className="mini">· {it.source}</span>{it.change && it.change !== "unchanged" ? <span className="pill amber" style={{ marginLeft: 8 }}>{it.change}</span> : null}</div><Body it={it} /></div>)}</div></details>}
      {onlineUrl && <p className="mini">Official text as published by EASA ({version}). <a href={onlineUrl} target="_blank" rel="noreferrer">Open the online version ↗</a></p>}
    </div>
  );
}
