"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the server component every `every` ms while it is mounted (e.g. while an analysis is being prepared). */
export default function AutoRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), every); return () => clearInterval(t); }, [router, every]);
  return null;
}
