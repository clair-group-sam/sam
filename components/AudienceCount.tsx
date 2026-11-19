"use client";
import { useEffect, useRef, useState } from "react";

/* FB-106 · before "Send now": how many people the ticked audience reaches (same rule as the server: lib/audience.ts resolveReaders). */
export function AudienceCount({ people }: { people: { id: string; staff: boolean; group: boolean; posts: string[] }[] }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [n, setN] = useState(0);
  const [empty, setEmpty] = useState<string[] | null>(null); // FB-129 · null = nothing ticked; else the ticked audiences that reach nobody
  useEffect(() => {
    const form = ref.current?.closest("form"); if (!form) return;
    const calc = () => {
      const t = [...form.querySelectorAll<HTMLInputElement>('input[name="audience"]:checked')].map((i) => i.value);
      const all = t.includes("ALL"); const posts = new Set(t.filter((x) => x.startsWith("ROLE:")).map((x) => x.slice(5))); const named = new Set(t.filter((x) => x.startsWith("PERSON:")).map((x) => x.slice(7)));
      setN(people.filter((p) => named.has(p.id) || (all && p.staff && !p.group) || p.posts.some((r) => posts.has(r))).length);
      setEmpty(t.length ? [...(all && !people.some((p) => p.staff && !p.group) ? ["all staff"] : []), ...[...posts].filter((r) => !people.some((p) => p.posts.includes(r)))] : null);
    };
    calc(); form.addEventListener("change", calc); return () => form.removeEventListener("change", calc);
  }, [people]);
  return <span ref={ref} className="mini" aria-live="polite" style={{ marginRight: "auto" }}>{empty === null ? <b style={{ color: "var(--amber-ink)" }}>Nobody selected yet: tick an audience.</b> : n === 0 ? <b style={{ color: "var(--red)" }}>Reaches nobody: {empty.join(", ")} {empty.length === 1 ? "has" : "have"} no holder with a S.A.M. account. It cannot be sent.</b> : <>Reaches <b>{n}</b> {n === 1 ? "person" : "people"}.{empty.length ? <b style={{ color: "var(--amber-ink)" }}> Nobody behind: {empty.join(", ")}.</b> : null}</>}</span>;
}
