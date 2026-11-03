// SAF-09 · names of the bulletins kept in Web Manuals (Astonfly) → S.A.M. number, title, month.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "FSR - 02/26 V3" · "FSR-04 05 24" · "Safety Bulletin - ENVOL - 06-2024" → number, title, month. */
export function parseWmName(name: string, file: string): { number: string; title: string; issued: string | null } {
  const yy = (y: string) => (y.length === 2 ? `20${y}` : y);
  const theme = file.replace(/\.pdf$/i, "").split(/\s*-\s*/).slice(2).join(" - ").replace(/_/g, " ").replace(/\s{2,}/g, " · ").trim();
  let m = /FSR\s*-?\s*(\d{2})(?:\s+(\d{2}))?\s*[/ ]\s*(\d{2,4})/i.exec(name);
  if (m) { const y = yy(m[3]); const mo = Number(m[1]); const to = m[2] ? Number(m[2]) : null;
    return { number: `FSR-${y}-${m[1]}${m[2] ? "-" + m[2] : ""}`, title: `Flight Safety Report ${MONTHS[mo - 1]}${to ? "–" + MONTHS[to - 1] : ""} ${y}${theme ? ` — ${theme}` : ""}`, issued: `${y}-${m[1]}-01` }; }
  m = /ENVOL\s*-?\s*(\d{2})[\s-]+(\d{4})/i.exec(name);
  if (m) return { number: `SB-ENVOL-${m[2]}-${m[1]}`, title: `Safety Bulletin ENVOL — ${MONTHS[Number(m[1]) - 1]} ${m[2]}`, issued: `${m[2]}-${m[1]}-01` };
  return { number: `WM-${name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`, title: name, issued: null };
}

