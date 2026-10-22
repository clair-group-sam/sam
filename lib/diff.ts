import { decodeEntities } from "@/lib/docs";

/** "What changed": block-level comparison of two chapter texts, with word-level highlights inside modified blocks. */
export type Word = { t: string; k: "=" | "+" | "-" };
export type Row = { kind: "same" | "mod" | "add" | "del"; left: Word[]; right: Word[] };

export function blocksOf(html: string): string[] {
  const s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<img[^>]*>/gi, " [figure] ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|tr|div|figure|blockquote|caption)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s).split("\n").map((l) => l.replace(/\s*\|\s*$/, "").replace(/\s+/g, " ").trim()).filter((l) => l && l !== "|");
}

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length, m = b.length;
  if (n * m > 9_000_000) return [];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return pairs;
}

export function diffWords(a: string, b: string): { left: Word[]; right: Word[] } {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const pairs = lcs(A, B, (x, y) => x === y);
  const left: Word[] = [], right: Word[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [A.length, B.length] as [number, number]]) {
    while (i < pi) left.push({ t: A[i++], k: "-" });
    while (j < pj) right.push({ t: B[j++], k: "+" });
    if (pi < A.length) { left.push({ t: A[pi], k: "=" }); right.push({ t: B[pj], k: "=" }); i = pi + 1; j = pj + 1; }
  }
  return { left, right };
}

const similar = (a: string, b: string) => {
  const A = new Set(a.toLowerCase().split(/\s+/)), B = b.toLowerCase().split(/\s+/);
  const common = B.filter((w) => A.has(w)).length;
  return common / Math.max(A.size, B.length, 1) >= 0.4;
};

/** Rows for a side-by-side view. Unchanged blocks are kept (the view shows them as context or folds them). */
export function diffBlocks(beforeHtml: string, afterHtml: string): Row[] {
  const A = blocksOf(beforeHtml), B = blocksOf(afterHtml);
  const pairs = lcs(A, B, (x, y) => x === y);
  const rows: Row[] = [];
  let i = 0, j = 0;
  const flush = (ai: number, bj: number) => {
    const dels = A.slice(i, ai), adds = B.slice(j, bj);
    // pair similar blocks as modifications, the rest as plain additions / deletions
    let d = 0, a = 0;
    while (d < dels.length || a < adds.length) {
      if (d < dels.length && a < adds.length && similar(dels[d], adds[a])) { const w = diffWords(dels[d++], adds[a++]); rows.push({ kind: "mod", left: w.left, right: w.right }); }
      else if (d < dels.length && (a >= adds.length || dels.length - d >= adds.length - a)) rows.push({ kind: "del", left: [{ t: dels[d++], k: "-" }], right: [] });
      else rows.push({ kind: "add", left: [], right: [{ t: adds[a++], k: "+" }] });
    }
    i = ai; j = bj;
  };
  for (const [pi, pj] of pairs) { flush(pi, pj); rows.push({ kind: "same", left: [{ t: A[pi], k: "=" }], right: [{ t: B[pj], k: "=" }] }); i = pi + 1; j = pj + 1; }
  flush(A.length, B.length);
  return rows;
}

/** Imported revisions have no previous text: the publisher's revision bars mark the changed passages. */
export function revbarPassages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<div class="revbar">([\s\S]*?)<\/div>/g)) out.push(...blocksOf(m[1]));
  return out;
}
