// Kinds of documents kept in Certificates & Validities, with who is alerted before they expire.
export const CERT_KINDS: { id: string; label: string; scope: "organisation" | "aircraft" }[] = [
  { id: "AOC", label: "Air Operator Certificate", scope: "organisation" },
  { id: "OpSpecs", label: "Operations specifications", scope: "organisation" },
  { id: "CAMO", label: "CAMO approval", scope: "organisation" },
  { id: "CAO", label: "Part-CAO approval", scope: "organisation" },
  { id: "ATO", label: "ATO approval", scope: "organisation" },
  { id: "FSTD", label: "FSTD qualification", scope: "organisation" },
  { id: "approval", label: "Other approval / authority letter", scope: "organisation" },
  { id: "insurance", label: "Insurance", scope: "organisation" },
  { id: "contract", label: "Contract / agreement", scope: "organisation" },
  { id: "ARC", label: "Airworthiness review certificate (ARC)", scope: "aircraft" },
  { id: "CofA", label: "Certificate of airworthiness", scope: "aircraft" },
  { id: "CofR", label: "Certificate of registration", scope: "aircraft" },
  { id: "noise", label: "Noise certificate", scope: "aircraft" },
  { id: "radio", label: "Radio station licence", scope: "aircraft" },
  { id: "aircraft_insurance", label: "Aircraft insurance", scope: "aircraft" },
  { id: "other", label: "Other document", scope: "organisation" },
];
export const kindLabel = (k: string) => CERT_KINDS.find((x) => x.id === k)?.label ?? k;
/** Who gets the expiry alerts: Compliance always; the CAMO post for aircraft documents. */
export function alertRoles(scope: string): string[] { return scope === "aircraft" ? ["CMM", "NPCA"] : ["CMM"]; }
export const safeKey = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
