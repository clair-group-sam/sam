"use client";
import { useState } from "react";
import Link from "next/link";
import { askManual, type ManualAnswer } from "@/app/(app)/docs/manual/[id]/actions";
import { Icon } from "@/lib/icons";

/** Ask this manual: a question in any language, an answer drawn only from the chapters of the revision being read, with the chapters cited. */
export default function AskManual({ manualId, revisionId, rev }: { manualId: string; revisionId: string; rev: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [a, setA] = useState<(ManualAnswer & { q: string }) | null>(null);
  async function ask(e: React.FormEvent) {
    e.preventDefault(); if (busy || !q.trim()) return;
    setBusy(true); setErr("");
    const r = await askManual({ manualId, revisionId, question: q });
    setBusy(false);
    if (r.ok) setA({ ...r.a, q }); else setErr(r.error);
  }
  return (
    <section className="card askm mb-4">
      <form className="askm-f" onSubmit={ask}>
        <label htmlFor="askm-q" className="askm-l"><Icon name="bulb" size={15} /> Ask this manual</label>
        <input id="askm-q" className="inp" value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} placeholder="e.g. Who approves a temporary revision? Qui signe la LEP ?" />
        <button className="btn primary" type="submit" disabled={busy || q.trim().length < 6}>{busy ? "Reading the chapters…" : "Ask"}</button>
      </form>
      {err && <p className="mini red px-4 pb-3">{err}</p>}
      {a && (
        <div className="askm-a">
          <p className={a.notFound ? "askm-nf" : ""}>{a.answer}</p>
          {a.cites.length > 0 && (
            <ul className="askm-c">
              {a.cites.map((c) => (
                <li key={c.ref}>
                  <Link href={`/docs/manual/${manualId}?tab=read&rev=${revisionId}&sec=${encodeURIComponent(c.ref)}`} className="badge">{c.ref}</Link>
                  <span><b>{c.title}</b>{c.quote && <q>{c.quote}</q>}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mini">From Rev {rev} only ({a.searched} chapters searched). SAM can be wrong: the chapter text is what applies.</p>
        </div>
      )}
    </section>
  );
}
