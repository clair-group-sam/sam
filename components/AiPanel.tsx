"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { aiPropose } from "@/app/(app)/docs/editor/[rev]/actions";
import type { AiAgent } from "@/lib/ai";
import { Icon } from "@/lib/icons";

type Note = { where: string; change: string; why: string };
type Props = { editor: Editor; revisionId: string; sectionId: string; onInserted: () => void; onClose: () => void; initialRequest?: string };

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

export default function AiPanel({ editor, revisionId, sectionId, onInserted, onClose, initialRequest = "" }: Props) {
  const [agent, setAgent] = useState<AiAgent>("draft");
  const [request, setRequest] = useState(initialRequest);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prop, setProp] = useState<{ html: string; notes: Note[]; model: string } | null>(null);
  const [view, setView] = useState<"diff" | "preview">("diff");

  const [secs, setSecs] = useState(0);
  async function propose() {
    if (busy) return; setBusy(true); setErr(""); setProp(null); setSecs(0);
    // FB-049 · say what is going on and give up after 90 s instead of spinning forever
    const t0 = Date.now(); const tick = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    const timeout = new Promise<{ ok: false; error: string }>((res) => setTimeout(() => res({ ok: false, error: "SAM did not answer within 90 s — the chapter may be long or the service busy. Try again, or ask for a specific sub-chapter." }), 90_000));
    const r = await Promise.race([aiPropose({ revisionId, sectionId, agent, request, currentHtml: editor.getHTML() }), timeout]);
    clearInterval(tick); setBusy(false);
    if (r.ok) setProp({ html: r.html, notes: r.notes, model: r.model }); else setErr(r.error);
  }
  const stage = secs < 3 ? "reading the chapter…" : secs < 8 ? (agent === "check" || agent === "explain" ? "reading the rules cited…" : "preparing the request…") : secs < 60 ? `SAM is writing… ${secs} s` : `still working… ${secs} s (long chapter)`;
  function insert() { if (!prop) return; editor.commands.setContent(prop.html); onInserted(); setProp(null); }
  const diff = prop ? diffWords(textOf(editor.getHTML()), textOf(prop.html)) : [];
  const added = diff.filter((d) => d.k === "+").length, removed = diff.filter((d) => d.k === "-").length;
  const AGENTS: [AiAgent, string, string][] = [["draft", "Draft", "Integrate what you describe"], ["rewrite", "Rewrite", "Manual style, same meaning"], ["translate", "Translate", "Passages in another language → manual language"], ["check", "Check", "Consistency review, no change"], ["explain", "Explain", "What a requirement asks, where the chapter stands"]];

  return (
    <aside className="aipanel">
      <div className="ch"><span className="eyebrow"><Icon name="bulb" size={14} /> Work with SAM</span><button type="button" className="clr" onClick={onClose} aria-label="Close">×</button></div>
      <div className="p-3">
        <div className="seg mb-2">{AGENTS.map(([k, l, t]) => <button key={k} type="button" className={agent === k ? "on" : ""} title={t} onClick={() => setAgent(k)}>{l}</button>)}</div>
        <textarea className="inp" rows={4} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={agent === "draft" ? "What do you want to integrate in this chapter? (any language — the chapter keeps its own)" : agent === "check" ? "Optional: what to pay attention to" : agent === "explain" ? "The requirement to explain (ORO.GEN.200(a)(3), CAMO.A.305…) or paste its text — default: the references cited in this chapter" : agent === "translate" ? "Target language (default: the chapter's)" : "Optional: which passages"} />
        <div className="flex items-center gap-2 mt-2">
          <button type="button" className="btn primary" onClick={propose} disabled={busy || (agent === "draft" && !request.trim())}>{busy ? stage : "Ask SAM"}</button>
          <span className="mini">SAM proposes; nothing enters the manual until you insert it.</span>
        </div>
        {err && <div className="lockbar mt-3" style={{ margin: "12px 0 0" }}>{err}</div>}
        {prop && (
          <div className="mt-3">
            {agent !== "check" && agent !== "explain" && (<>
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
                <div className="eyebrow mb-1">{agent === "check" ? "Findings" : agent === "explain" ? "What the requirement asks, and where the chapter stands" : "What changed and why"}</div>
                <ul className="ainotes">{prop.notes.map((n, i) => <li key={i}><b>{n.where}</b> — {n.change}{n.why && <span className="mini"> · {n.why}</span>}</li>)}</ul>
              </div>
            )}
            {agent !== "check" && agent !== "explain" && (
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
