"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** A tile of the Group view: one click makes the entity the working one and shows its own dashboard on the same page. */
export default function EntityTile({ entity, className, style, children }: { entity: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} style={{ textAlign: "left", cursor: busy ? "progress" : "pointer", opacity: busy ? 0.6 : 1, ...style }} disabled={busy} aria-label={`Open ${entity}`}
      onClick={async () => { setBusy(true); await fetch("/api/ent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ent: entity }) }); router.refresh(); }}>
      {children}
    </button>
  );
}
