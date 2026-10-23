"use client";
import { useState } from "react";
import Link from "next/link";
import { reviewRevision, type Review } from "@/app/(app)/docs/editor/[rev]/actions";

const SEV: Record<string, string> = { major: "amber", minor: "", suggestion: "green" };

/** Internal documents: the assistant reads the revision and comments; the author uses or ignores each comment, then publishes. */
export default function ReviewPanel({ revisionId, initial, editable }: { revisionId: string; initial: Review | null; editable: boolean }) {
  const [r, setR] = useState<Review | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState<Record<number, "used" | "ignored">>({});
  async function run() { setBusy(true); setErr(""); const x = await reviewRevision({ revisionId }); setBusy(false); if (x.ok) { setR(x.review); setSeen({}); } else setErr(x.error); }
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="mini">{r ? `Reviewed ${r.at.slice(0, 16).replace("T", " ")} · ${r.comments.length} comment${r.comments.length === 1 ? "" : "s"}` : "Not reviewed yet."}</span>
        {editable && <button type="button" className="btn primary ml-auto" disabled={busy} onClick={run}>{busy ? "SAM is reading the document…" : r ? "Ask SAM to review again" : "🤝 Ask SAM to review"}</button>}
      </div>
      {err && <p className="mini red mb-2">{err}</p>}
      {r && <p className="text-[13px] mb-3">{r.summary}</p>}
      {r && r.comments.length > 0 && (
        <table className="tbl"><tbody>
          {r.comments.map((c, i) => (
            <tr key={i} style={{ opacity: seen[i] ? 0.5 : 1 }}>
              <td style={{ width: 80 }}><Link className="mono underline" href={`/docs/editor/${revisionId}?tab=write&sec=${encodeURIComponent(c.chapter)}`}>{c.chapter}</Link></td>
              <td style={{ width: 90 }}><span className={"pill " + (SEV[c.severity] ?? "")}>{c.severity}</span></td>
              <td>{c.comment}{c.proposal && <div className="mini mt-1">→ {c.proposal}</div>}</td>
              <td style={{ width: 150 }} className="text-right">
                {seen[i] ? <span className="mini">{seen[i]}</span> : <>
                  <button type="button" className="btn" onClick={() => setSeen((x) => ({ ...x, [i]: "used" }))}>Used</button>{" "}
                  <button type="button" className="btn" onClick={() => setSeen((x) => ({ ...x, [i]: "ignored" }))}>Ignore</button></>}
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
      {r && !r.comments.length && <p className="mini">No comment: the document can be published as it is.</p>}
    </div>
  );
}
