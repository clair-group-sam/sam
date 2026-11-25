"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markRead } from "@/app/(app)/docs/manual/[id]/actions";

/** DOC-17 · placed at the end of what must be read: once it has stayed in view a few seconds, the part counts as read. */
export default function ReadEnd({ manualId, revId, refKey, onDone }: { manualId: string; revId: string; refKey: string; onDone?: (r: { acknowledged: boolean; left: number }) => void }) {
  const el = useRef<HTMLDivElement>(null); const router = useRouter(); const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    if (!el.current || sent === refKey) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !timer) timer = setTimeout(async () => { io.disconnect(); setSent(refKey); const r = await markRead(manualId, revId, refKey).catch(() => null); if (r) { onDone?.(r); if (r.acknowledged) router.refresh(); } }, 4000);
      if (!e.isIntersecting && timer) { clearTimeout(timer); timer = null; }
    }, { threshold: 0.5 });
    io.observe(el.current);
    return () => { io.disconnect(); if (timer) clearTimeout(timer); };
  }, [manualId, revId, refKey, sent]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="readend" aria-hidden="true" />;
}
