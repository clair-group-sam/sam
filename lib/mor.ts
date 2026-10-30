// SAF-06 MOR / ECCAIRS — who receives the MOR, deadlines (376/2014 art. 4(8) and 13(4)).
export const E2_PORTAL = "https://e2.aviationreporting.eu/home";
export const AUTHORITY: Record<string, { name: string; account: string; route: string; note?: string }> = {
  // TM-CAD notice of 30/10/2026: occurrences with a date of event on or after 23/11/2026 go to ECCAIRS 2; reports already in Centrik stay in Centrik (follow-up and closure)
  ASJMT: { name: "TM-CAD (Malta)", account: "ECCAIRS 2 — Astonjet Ltd organisation (TM-CAD)", route: "ECCAIRS 2 for events from 23/11/2026", note: "TM-CAD (30/10/2026): events dated 23 November 2026 or later are reported in ECCAIRS 2; reports already filed in the Centrik-based system are followed up and closed in Centrik." },
  ASJFR: { name: "DGAC (DSAC)", account: "ECCAIRS 2 — SAS_ASTONJET", route: "ECCAIRS 2" },
  ASFFR: { name: "DGAC (DSAC)", account: "ECCAIRS 2 — ASTONFLY", route: "ECCAIRS 2" },
  ASTFR: { name: "DGAC (DSAC)", account: "—", route: "ECCAIRS 2" },
};
const DAY = 864e5;
export const due72 = (received: string) => new Date(new Date(received).getTime() + 72 * 3600e3);
export const due30 = (filed: string) => new Date(new Date(filed).getTime() + 30 * DAY);
export const due3m = (filed: string) => { const d = new Date(filed); d.setUTCMonth(d.getUTCMonth() + 3); return d; };
export type Stage = "to_file" | "late" | "followup" | "final" | "done" | "sent_imported" | "not_sent_imported";
export const STAGE: Record<Stage, [string, string]> = {
  to_file: ["To file — 72 h running", "amber"], late: ["Past 72 h — to file", "red"], followup: ["30-day report due", "amber"], final: ["Final report due (3 months)", "amber"],
  done: ["Closed with the authority", "green"], sent_imported: ["Sent to ECCAIRS", "green"], not_sent_imported: ["Not sent to ECCAIRS", ""],
};
export function stageOf(r: { source: string | null; received_at: string; mor_filed_at: string | null; mor_followup_at: string | null; mor_final_at: string | null; status?: string | null }, now = Date.now()): Stage {
  if ((r.source ?? "sam") !== "sam") return r.mor_filed_at ? "sent_imported" : "not_sent_imported";
  if (!r.mor_filed_at) return now > due72(r.received_at).getTime() ? "late" : "to_file";
  if (!r.mor_followup_at && !r.mor_final_at) return "followup";
  if (!r.mor_final_at) return "final";
  return "done";
}
