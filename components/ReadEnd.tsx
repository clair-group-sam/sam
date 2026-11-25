"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markOpened } from "@/app/(app)/docs/manual/[id]/actions";

/** DOC-17 · the revision in force is acknowledged once the manual has been on screen a few seconds (a background tab does not count). */
export default function ReadEnd({ manualId, revId }: { manualId: string; revId: string }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null; let sent = false;
    const arm = () => { if (sent || timer || document.visibilityState !== "visible") return; timer = setTimeout(async () => { sent = true; const r = await markOpened(manualId, revId).catch(() => null); if (r?.acknowledged) router.refresh(); }, 3000); };
    const vis = () => { if (document.visibilityState === "visible") arm(); else if (timer) { clearTimeout(timer); timer = null; } };
    arm(); document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); if (timer) clearTimeout(timer); };
  }, [manualId, revId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
