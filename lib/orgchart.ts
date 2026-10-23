// Organisation charts drawn by S.A.M. from NP management (posts, holders, deputies, reporting lines).
// A manual keeps a SNAPSHOT of the chart in each revision (approved content never changes by itself);
// NP management holds the live data and tells which manuals are out of date. Pure functions, used in the editor, reader and PDF.

export type ChartPost = { code: string; title: string; holder: string | null; deputy: string | null; parent: string | null };
export type ChartSnapshot = { entity: string; at: string; source?: string; deputyLabel?: string; posts: ChartPost[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const W = 210, H = 46, GX = 24, DEP_GAP = 26, LEVEL_GAP = 46;

function wrap(t: string, max = 30): string[] {
  const words = t.split(/\s+/); const out: string[] = []; let line = "";
  for (const w of words) { if ((line + " " + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + " " + w).trim(); }
  if (line) out.push(line);
  return out.slice(0, 2);
}
function box(x: number, y: number, name: string | null, title: string, deputy = false): string {
  const lines = wrap(title, deputy ? 32 : 30);
  const nameY = y + (lines.length > 1 ? 15 : 19);
  const t = lines.map((l, i) => `<tspan x="${x + W / 2}" y="${nameY + 15 + i * 12}">${esc(l)}</tspan>`).join("");
  return `<g><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="6" fill="${deputy ? "#f6f9fb" : "#ffffff"}" stroke="${deputy ? "#8fa3b3" : "#0d2a3f"}" stroke-width="${deputy ? 1 : 1.4}"${deputy ? ' stroke-dasharray="4 3"' : ""}/>`
    + `<text text-anchor="middle" font-family="Inter, Arial, sans-serif" fill="#0d2a3f"><tspan x="${x + W / 2}" y="${nameY}" font-size="12.5" font-weight="700">${esc(name || "— vacant —")}</tspan><tspan font-size="10.5" fill="#44546a">${t}</tspan></text></g>`;
}

export function orgChartSvg(snap: ChartSnapshot | null): string {
  if (!snap || !snap.posts?.length) return `<div class="orgchart-empty">Organisation chart — no post defined in NP management yet.</div>`;
  const posts = snap.posts;
  const codes = new Set(posts.map((p) => p.code));
  const kids = new Map<string, ChartPost[]>();
  const roots: ChartPost[] = [];
  for (const p of posts) { if (p.parent && codes.has(p.parent) && p.parent !== p.code) { if (!kids.has(p.parent)) kids.set(p.parent, []); kids.get(p.parent)!.push(p); } else roots.push(p); }
  const width = new Map<string, number>();
  const seen = new Set<string>();
  const wOf = (p: ChartPost): number => { if (seen.has(p.code)) return 1; seen.add(p.code); const c = kids.get(p.code) ?? []; const w = Math.max(1, c.reduce((a, k) => a + wOf(k), 0)); width.set(p.code, w); return w; };
  roots.forEach(wOf);
  // depth and level heights (a level with deputies is taller)
  const depth = new Map<string, number>();
  const setDepth = (p: ChartPost, d: number) => { if (depth.has(p.code)) return; depth.set(p.code, d); (kids.get(p.code) ?? []).forEach((k) => setDepth(k, d + 1)); };
  roots.forEach((r) => setDepth(r, 0));
  const maxD = Math.max(...[...depth.values()]);
  const lvlH: number[] = []; for (let d = 0; d <= maxD; d++) lvlH[d] = H + (posts.some((p) => depth.get(p.code) === d && p.deputy) ? DEP_GAP + H : 0);
  const lvlY: number[] = []; let acc = 8; for (let d = 0; d <= maxD; d++) { lvlY[d] = acc; acc += lvlH[d] + LEVEL_GAP; }
  const slot = W + GX;
  const pos = new Map<string, { x: number; y: number }>();
  const place = (p: ChartPost, left: number) => {
    const w = width.get(p.code) ?? 1; const d = depth.get(p.code) ?? 0;
    pos.set(p.code, { x: left + (w * slot - GX) / 2 - W / 2, y: lvlY[d] });
    let l = left; for (const k of kids.get(p.code) ?? []) { place(k, l); l += (width.get(k.code) ?? 1) * slot; }
  };
  let left = 8; for (const r of roots) { place(r, left); left += (width.get(r.code) ?? 1) * slot; }
  const totalW = left - GX + 8, totalH = acc - LEVEL_GAP + 8;
  const parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, dash = false) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${dash ? "#8fa3b3" : "#0d2a3f"}" stroke-width="1.2"${dash ? ' stroke-dasharray="4 3"' : ""}/>`);
  for (const p of posts) {
    const a = pos.get(p.code); if (!a) continue;
    const bottom = a.y + H + (p.deputy ? DEP_GAP + H : 0);
    if (p.deputy) line(a.x + W / 2, a.y + H, a.x + W / 2, a.y + H + DEP_GAP, true);
    const c = kids.get(p.code) ?? [];
    if (c.length) {
      const d = depth.get(p.code) ?? 0; const busY = lvlY[d] + lvlH[d] + LEVEL_GAP / 2;
      line(a.x + W / 2, bottom, a.x + W / 2, busY);
      const xs = c.map((k) => (pos.get(k.code)?.x ?? 0) + W / 2);
      if (xs.length > 1) line(Math.min(...xs), busY, Math.max(...xs), busY);
      for (const k of c) { const b = pos.get(k.code); if (b) line(b.x + W / 2, busY, b.x + W / 2, b.y); }
    }
  }
  for (const p of posts) {
    const a = pos.get(p.code); if (!a) continue;
    parts.push(box(a.x, a.y, p.holder, p.title));
    if (p.deputy) parts.push(box(a.x, a.y + H + DEP_GAP, p.deputy, `${snap.deputyLabel ?? "Deputy"} ${p.title}`, true));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" style="max-width:100%;height:auto" role="img" aria-label="Organisation chart ${esc(snap.entity)}">${parts.join("")}</svg>`;
}

/** Same chart? (posts, titles, holders, deputies, reporting lines) */
export function chartKey(s: ChartSnapshot | null): string {
  return JSON.stringify((s?.posts ?? []).map((p) => [p.code, p.title, p.holder ?? "", p.deputy ?? "", p.parent ?? ""]).sort());
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export function parseSnapshot(attr: string | null | undefined): ChartSnapshot | null {
  if (!attr) return null;
  try { return JSON.parse(decode(attr)) as ChartSnapshot; } catch { try { return JSON.parse(decodeURIComponent(attr)) as ChartSnapshot; } catch { return null; } }
}
/** Reader / PDF: every chart block of a chapter becomes its drawing. */
export function renderCharts(html: string): string {
  return html.replace(/<div\b[^>]*data-sam-orgchart="([^"]*)"[^>]*>\s*<\/div>/gi, (all) => {
    const snap = parseSnapshot(/data-snapshot="([^"]*)"/i.exec(all)?.[1]);
    return `<figure class="orgchart">${orgChartSvg(snap)}</figure>`;
  });
}
export function chartsIn(html: string): ChartSnapshot[] {
  return [...html.matchAll(/<div\b[^>]*data-sam-orgchart="[^"]*"[^>]*>/gi)].map((m) => parseSnapshot(/data-snapshot="([^"]*)"/i.exec(m[0])?.[1])).filter(Boolean) as ChartSnapshot[];
}
export function chartBlock(snap: ChartSnapshot): string {
  return `<div data-sam-orgchart="${esc(snap.entity)}" data-snapshot="${esc(JSON.stringify(snap))}"></div>`;
}
