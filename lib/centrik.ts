// Centrik: names are shown as "<initials><Surname>, <Given> (<Department>)", dates as dd.mm.yyyy.
export const centrikPerson = (n?: string | null): [string | null, string | null] => {
  if (!n || n === "-") return [null, null];
  const m = /^([A-Z]+[^,]*),\s*([^(]+?)\s*(?:\((.*)\))?$/.exec(n.trim()); if (!m) return [n.trim(), null];
  const sw = m[1].trim().split(/\s+/).length, gw = m[2].trim().split(/\s+/).length, ini = m[1].trim().slice(0, sw + gw), sur = m[1].trim().slice(sw + gw);
  return /^[A-Z]+$/.test(ini) && sur ? [`${m[2].trim()} ${sur}`, m[3] ?? null] : [`${m[2].trim()} ${m[1].trim()}`, m[3] ?? null];
};
/** "Babillot, Maxime" (no initials, as in action grids) → "Maxime Babillot". */
export const commaName = (n?: string | null) => { if (!n || n === "-") return null; const m = /^([^,]+),\s*(.+)$/.exec(n.trim()); return m ? `${m[2].trim()} ${m[1].trim()}` : n.trim(); };
export const centrikDate = (d?: string | null) => { const m = /(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(d ?? ""); return m ? (m[4] ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00Z` : `${m[3]}-${m[2]}-${m[1]}`) : null; };
