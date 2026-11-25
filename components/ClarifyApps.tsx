"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clarifyApplications } from "@/app/(app)/proj/boards/clarify";
import SamBusy from "@/components/SamBusy";

/** Applications card: one click gives every application still to file its official name and one sentence on what it is for. */
export default function ClarifyApps({ projectId, entity }: { projectId: string; entity: string }) {
  const [busy, start] = useTransition(); const [msg, setMsg] = useState(""); const router = useRouter();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" className="btn sm" disabled={busy} onClick={() => start(async () => {
        setMsg("");
        const r = await clarifyApplications(projectId).catch(() => ({ ok: false as const, error: "It took too long. Try again." }));
        setMsg(r.ok ? `${r.changed} application${r.changed === 1 ? "" : "s"} renamed and explained${r.unconfirmed ? `; ${r.unconfirmed} official name${r.unconfirmed === 1 ? "" : "s"} not found on an official source, check ${r.unconfirmed === 1 ? "it" : "them"}` : ""}.` : r.error);
        if (r.ok) router.refresh();
      })}>{busy ? <><SamBusy entity={entity} />Naming the applications…</> : "Name and explain with S.A.M."}</button>
      {msg && <span className="mini">{msg}</span>}
    </div>
  );
}
