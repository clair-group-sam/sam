// A small, discreet mark on what was imported (Centrik, FlightLogger, Web Manuals, Monday, Word, Excel) — what has no mark was created in S.A.M.
const NAME: Record<string, string> = { centrik: "Centrik", flightlogger: "FlightLogger", webmanuals: "Web Manuals", wm: "Web Manuals", monday: "Monday", word: "Word files", excel: "Excel", sharepoint: "SharePoint" };
export const sourceName = (s?: string | null) => (s ? NAME[s] ?? s : "");

export default function SourceMark({ source, id: r, when }: { source?: string | null; id?: string | null; when?: string | null }) {
  if (!source || source === "sam") return null;
  const t = `Imported from ${sourceName(source)}${r ? ` (${r})` : ""}${when ? ` · ${when.slice(0, 10)}` : ""} — not created in S.A.M.`;
  return (
    <span className="srcmark" title={t} aria-label={t}>
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 1.5v8M4.8 6.6 8 9.8l3.2-3.2M2.5 10.5v2.2c0 .5.4.8.8.8h9.4c.4 0 .8-.3.8-.8v-2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}
