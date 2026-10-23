// Chapter structure of a revision: ordering, parent / children by number, automatic renumbering. Pure functions.
export type Ch = { id: string; ord: number; ref: string; deleted?: boolean };

export const parentOf = (ref: string) => (ref.includes(".") ? ref.slice(0, ref.lastIndexOf(".")) : "");
const lastOf = (ref: string) => ref.slice(ref.lastIndexOf(".") + 1);
export const isUnder = (ref: string, parent: string) => ref.startsWith(parent + ".");

/** The chapter and its sub-chapters (contiguous in the list), as indexes in `list`. */
export function blockOf(list: Ch[], i: number): [number, number] {
  let j = i + 1;
  while (j < list.length && isUnder(list[j].ref, list[i].ref)) j++;
  return [i, j];
}

/**
 * Renumbers siblings in order: under the same parent, numeric last segments become consecutive, starting from the
 * smallest number the group had (1, or 0 for a cover). Sub-chapters follow their parent's new number. Deleted chapters keep
 * their number and are not counted. Letters (parts "A", "B") are never renumbered.
 */
export function renumber(list: Ch[]): Map<string, string> {
  const sorted = [...list].sort((a, b) => a.ord - b.ord);
  const start = new Map<string, number>();
  for (const c of sorted) {
    if (c.deleted) continue;
    const l = lastOf(c.ref);
    if (!/^\d+$/.test(l)) continue;
    const p = parentOf(c.ref);
    const n = Number(l) >= 9000 ? Infinity : Number(l);
    start.set(p, Math.min(start.get(p) ?? Infinity, n));
  }
  const counter = new Map<string, number>();
  const mapped = new Map<string, string>(); // old ref → new ref (for parents)
  const out = new Map<string, string>();    // id → new ref
  for (const c of sorted) {
    const p = parentOf(c.ref);
    const newParent = mapped.get(p) ?? p;
    const l = lastOf(c.ref);
    if (c.deleted || !/^\d+$/.test(l)) { const r = p ? `${newParent}.${l}` : c.ref; out.set(c.id, c.deleted ? c.ref : r); mapped.set(c.ref, c.deleted ? c.ref : r); continue; }
    const s0 = start.get(p); const base = s0 === undefined || s0 === Infinity ? 1 : s0;
    const n = counter.has(newParent) ? counter.get(newParent)! + 1 : base;
    counter.set(newParent, n);
    const r = newParent ? `${newParent}.${n}` : String(n);
    out.set(c.id, r); mapped.set(c.ref, r);
  }
  return out;
}
