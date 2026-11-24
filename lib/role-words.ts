/** What a code means, in words, when no post of the organisation carries it. */
export const ROLE_WORDS: Record<string, string> = {
  AM: "Accountable Manager", CMM: "Compliance Monitoring Manager", SM: "Safety Manager", SUPERADMIN: "Administrator of S.A.M.", USER: "User", CREW: "Crew member", EXT: "External person",
  NPFO: "Nominated person, flight operations", NPCA: "Nominated person, continuing airworthiness", NPGO: "Nominated person, ground operations", NPCT: "Nominated person, crew training",
  CFI: "Chief Flight Instructor", HT: "Head of Training", CTKI: "Chief Theoretical Knowledge Instructor", FSO: "Flight Safety Officer", MAM: "Maintenance and Airworthiness Manager", ISM: "Information Security Manager",
  RE: "Responsable Entretien", RN: "Responsable Navigabilité", RRO: "Responsable de Revue d'Organisation", AUDITOR: "Auditor",
};
/** The roles that are not a post of an organisation chart: given to a person as such. */
export const GENERAL_ROLES = ["USER", "CREW", "AM", "CMM", "SM", "AUDITOR", "EXT"];
