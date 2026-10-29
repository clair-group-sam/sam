// ENT-01 (29/10/2026, meeting): entity codes are the Teams codes of the companies.
// Astonjet Ltd (Malta) ASJMT · Astonjet SAS (France) ASJFR · Astonfly ASFFR · Astontec ASTFR. Old codes still accepted on input
// (Centrik / FlightLogger collectors, old cookies, legacy Entra group names CG-<ENTITY>-<ROLE>) and turned into the new ones.
export const ENTITY_CODES = ["ASJMT", "ASJFR", "ASFFR", "ASTFR"] as const;
export const LEGACY: Record<string, string> = { AJD: "ASJMT", ASJ: "ASJFR", ASF: "ASFFR", TEC: "ASTFR" };
export const normEntity = (e?: string | null) => (e ? LEGACY[e.trim().toUpperCase()] ?? e.trim().toUpperCase() : e ?? null) as string;

/** SAF-07 (29/10): entities whose staff keep reporting in their own tool; S.A.M. retrieves the reports for analysis and treatment. */
export const REPORTS_ELSEWHERE: Record<string, { tool: string; url: string }> = {
  ASFFR: { tool: "FlightLogger", url: "https://astonfly.flightlogger.net/a/astonfly/sms/reports" },
};
