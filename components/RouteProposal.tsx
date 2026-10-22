"use client";
import { useState } from "react";
import { proposeRoute, decideRoute, type RouteProposal as Proposal } from "@/app/(app)/docs/editor/[rev]/actions";

const LABEL: Record<string, string> = { approval: "Approval by the authority", notification: "Notification to the authority", none: "No authority route" };

/** DOC-06 · the assistant proposes, Compliance decides. */
export default function RouteProposal({ revisionId, initial, route, authority }: { revisionId: string; initial: Proposal | null; route: string | null; authority: string }) {
  const [p, setP] = useState<Proposal | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function ask() { setBusy(true); setErr(""); const r = await proposeRoute({ revisionId }); setBusy(false); if (r.ok) setP(r.proposal); else setErr(r.error); }
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="mini">Decided route:</span>
        <b>{route ? LABEL[route] ?? route : "not decided yet"}</b>
        <button type="button" className="btn ml-auto" disabled={busy} onClick={ask}>{busy ? "Reading the changes…" : p ? "Propose again" : "Propose a route"}</button>
      </div>
      {err && <p className="mini red mb-2">{err}</p>}
      {p && (
        <div className="rprop">
          <div className="flex items-center gap-2 mb-1"><span className={"pill " + (p.route === "approval" ? "amber" : p.route === "notification" ? "" : "green")}>{LABEL[p.route]}</span><span className="mini">proposed · confidence {p.confidence}{p.at ? ` · ${p.at.slice(0, 16).replace("T", " ")}` : ""}</span></div>
          <p className="text-[13px] mb-2">{p.summary}</p>
          {p.reasons?.length > 0 && <table className="tbl"><tbody>{p.reasons.map((r, i) => <tr key={i}><td className="mono" style={{ width: 70 }}>{r.chapter}</td><td>{r.change}<div className="mini">{r.rule}</div></td></tr>)}</tbody></table>}
        </div>
      )}
      <form action={decideRoute} className="flex gap-2 mt-3 flex-wrap">
        <input type="hidden" name="revision_id" value={revisionId} />
        {(["approval", "notification", "none"] as const).map((r) => (
          <button key={r} name="route" value={r} type="submit" className={"btn" + ((p?.route === r && route !== r) ? " primary" : "") + (route === r ? " on" : "")}>{r === "none" ? "No route" : r === "approval" ? `Approval (${authority})` : `Notification (${authority})`}</button>
        ))}
      </form>
    </div>
  );
}
