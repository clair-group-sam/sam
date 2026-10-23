"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { aiPropose } from "@/app/(app)/docs/editor/[rev]/actions";
import type { AiAgent } from "@/lib/ai";

type Note = { where: string; change: string; why: string };
type Props = { editor: Editor; revisionId: string; sectionId: string; onInserted: () => void; onClose: () => void };

/** Word-level diff (LCS) between two texts, for the proposal preview. */
function diffWords(a: string, b: string): { t: string; k: "=" | "+" | "-" }[] {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [{ t: b, k: "=" }];
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: string; k: "=" | "+" | "-" }[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: A[i], k: "=" }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: A[i], k: "-" }); i++; } else { out.push({ t: B[j], k: "+" }); j++; } }
  while (i < n) out.push({ t: A[i++], k: "-" }); while (j < m) out.push({ t: B[j++], k: "+" });
  return out;
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export default function AiPanel({ editor, revisionId, sectionId, onInserted, onClose }: Props) {
  const [agent, setAgent] = useState<AiAgent>("draft");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prop, setProp] = useState<{ html: string; notes: Note[]; model: string } | null>(null);
  const [view, setView] = useState<"diff" | "preview">("diff");

  async function propose() {
    if (busy) return; setBusy(true); setErr(""); setProp(null);
    const r = await aiPropose({ revisionId, sectionId, agent, request, currentHtml: editor.getHTML() });
    setBusy(false);
    if (r.ok) setProp({ html: r.html, notes: r.notes, model: r.model }); else setErr(r.error);
  }
  function insert() { if (!prop) return; editor.commands.setContent(prop.html); onInserted(); setProp(null); }
  const diff = prop ? diffWords(textOf(editor.getHTML()), textOf(prop.html)) : [];
  const added = diff.filter((d) => d.k === "+").length, removed = diff.filter((d) => d.k === "-").length;
  const AGENTS: [AiAgent, string, string][] = [["draft", "Draft", "Integrate what you describe"], ["rewrite", "Rewrite", "Manual style, same meaning"], ["translate", "Translate", "Passages in another language → manual language"], ["check", "Check", "Consistency review, no change"]];

  return (
    <aside className="aipanel">
      <div className="ch"><span className="eyebrow">🤝 Work with SAM</span><button type="button" className="clr" onClick={onClose} aria-label="Close">×</button></div>
      <div className="p-3">
        <div className="seg mb-2">{AGENTS.map(([k, l, t]) => <button key={k} type="button" className={agent === k ? "on" : ""} title={t} onClick={() => setAgent(k)}>{l}</button>)}</div>
        <textarea className="inp" rows={4} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={agent === "draft" ? "What do you want to integrate in this chapter? (any language — the chapter keeps its own)" : agent === "check" ? "Optional: what to pay attention to" : agent === "translate" ? "Target language (default: the chapter's)" : "Optional: which passages"} />
        <div className="flex items-center gap-2 mt-2">
          <button type="button" className="btn primary" onClick={propose} disabled={busy || (agent === "draft" && !request.trim())}>{busy ? "SAM is working…" : "Ask SAM"}</button>
          <span className="mini">SAM proposes; nothing enters the manual until you insert it.</span>
        </div>
        {err && <div className="lockbar mt-3" style={{ margin: "12px 0 0" }}>{err}</div>}
        {prop && (
          <div className="mt-3">
            {agent !== "check" && (<>
              <div className="flex items-center gap-2 mb-2">
                <div className="seg"><button type="button" className={view === "diff" ? "on" : ""} onClick={() => setView("diff")}>Changes</button><button type="button" className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>Preview</button></div>
                <span className="mini"><b style={{ color: "#1d7a3a" }}>+{added}</b> · <b style={{ color: "var(--terra)" }}>−{removed}</b> words</span>
              </div>
              {view === "diff"
                ? <div className="aidiff">{diff.map((d, i) => d.k === "=" ? <span key={i}>{d.t} </span> : d.k === "+" ? <ins key={i}>{d.t} </ins> : <del key={i}>{d.t} </del>)}</div>
                : <div className="reader aipreview" dangerouslySetInnerHTML={{ __html: prop.html }} />}
            </>)}
            {prop.notes.length > 0 && (
              <div className="mt-3">
                <div className="eyebrow mb-1">{agent === "check" ? "Findings" : "What changed and why"}</div>
                <ul className="ainotes">{prop.notes.map((n, i) => <li key={i}><b>{n.where}</b> — {n.change}{n.why && <span className="mini"> · {n.why}</span>}</li>)}</ul>
              </div>
            )}
            {agent !== "check" && (
              <div className="flex gap-2 mt-3">
                <button type="button" className="btn primary" onClick={insert}>Insert into the chapter</button>
                <button type="button" className="btn" onClick={() => setProp(null)}>Discard</button>
              </div>
            )}
            <p className="mini mt-2">Review before saving: the proposal is a draft, you remain the author of the text.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
