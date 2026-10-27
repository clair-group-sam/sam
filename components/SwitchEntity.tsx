"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Switches the working entity (cookie sam_ent) and refreshes. Used by the top-bar block and by the band of an object from another entity. */
export default function SwitchEntity({ to, label, className }: { to: string; label: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button type="button" className={className ?? "btn"} disabled={busy} onClick={async () => { setBusy(true); await fetch("/api/ent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ent: to }) }); router.refresh(); setBusy(false); }}>{label}</button>;
}
