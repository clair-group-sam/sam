"use client";
import { useRouter } from "next/navigation";
/* 10/11 · « Back »: where the person came from (list by audit, audit sheet, Inbox…), else the fallback. */
export function BackButton({ fallback, label = "← Back" }: { fallback: string; label?: string }) {
  const r = useRouter();
  return <button type="button" className="btn" onClick={() => { if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) r.back(); else r.push(fallback); }}>{label}</button>;
}
