// Generic registers (09/11): one description per table drives the list, the create / edit form and the server action.
// Used for the simple registers of Users & fleet, ERP and Part-IS. Only the tables and fields listed here can be written.
export type Field = {
  k: string; label: string;
  type?: "text" | "textarea" | "date" | "number" | "select" | "bool";
  options?: [string, string][];       // [value, label]
  mono?: boolean; required?: boolean; span?: 1 | 2 | 3 | 4; placeholder?: string;
};
export type Reg = {
  table: string; path: string;
  noun: string;                         // "aircraft", "contact"
  fields: Field[];
  list: string[];                       // field keys shown as columns, the first one is the link
  order: [string, boolean][];           // [column, ascending]
  posts: string[];                      // who may write (base posts), on top of CMM and SUPERADMIN
  tone?: Record<string, Record<string, string>>; // field → value → pill tone
};

const LMH: [string, string][] = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
const ROLE_PH = "SM, CMM, NPFO…";

export const REGS: Record<string, Reg> = {
  aircraft: {
    table: "aircraft", path: "/users/fleet", noun: "aircraft", posts: ["NPCA", "NPFO", "AM"],
    fields: [
      { k: "registration", label: "Registration", mono: true, required: true, placeholder: "9H-ABC" },
      { k: "type_code", label: "Type (ICAO)", mono: true, placeholder: "C68A" },
      { k: "model", label: "Model", span: 2, placeholder: "Citation Latitude" },
      { k: "msn", label: "MSN", mono: true },
      { k: "base", label: "Base", mono: true, placeholder: "LFPB" },
      { k: "camo", label: "CAMO", mono: true, placeholder: "MT.CAMO.0079" },
      { k: "status", label: "Status", type: "select", options: [["in_service", "In service"], ["incoming", "Incoming"], ["stored", "Stored"], ["leaving", "Leaving"], ["left", "Left the fleet"]] },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["registration", "type_code", "model", "base", "camo", "status"], order: [["registration", true]],
    tone: { status: { in_service: "green", incoming: "", stored: "amber", leaving: "amber", left: "" } },
  },
  erp_plans: {
    table: "erp_plans", path: "/erp/plans", noun: "plan", posts: ["SM", "AM"],
    fields: [
      { k: "code", label: "Code", mono: true, placeholder: "ERP-01" },
      { k: "title", label: "Title", required: true, span: 3, placeholder: "Aircraft accident or serious incident" },
      { k: "scope", label: "Scenarios covered", type: "textarea", span: 4, placeholder: "Accident, serious incident, missing aircraft, security event, pandemic…" },
      { k: "manual_ref", label: "Manual reference", placeholder: "OM-A 11, ERP manual" },
      { k: "version", label: "Version", mono: true },
      { k: "reviewed_on", label: "Last review", type: "date" },
      { k: "next_review", label: "Next review", type: "date" },
      { k: "owner_role", label: "Owner (post)", mono: true, placeholder: "SM" },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["title", "code", "manual_ref", "version", "reviewed_on", "next_review"], order: [["code", true], ["title", true]],
  },
  erp_contacts: {
    table: "erp_contacts", path: "/erp/contacts", noun: "contact", posts: ["SM", "AM"],
    fields: [
      { k: "crisis_role", label: "Role in the crisis", required: true, span: 2, placeholder: "Crisis director, Family assistance, BEA…" },
      { k: "name", label: "Name" },
      { k: "organisation", label: "Organisation" },
      { k: "phone", label: "Phone", mono: true },
      { k: "email", label: "E-mail" },
      { k: "available", label: "Availability", placeholder: "24/7" },
      { k: "ord", label: "Order", type: "number" },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["crisis_role", "name", "organisation", "phone", "email", "available"], order: [["ord", true], ["crisis_role", true]],
  },
  erp_checklists: {
    table: "erp_checklists", path: "/erp/check", noun: "checklist", posts: ["SM", "AM"],
    fields: [
      { k: "title", label: "Title", required: true, span: 2, placeholder: "Crisis director, first hour" },
      { k: "phase", label: "Phase", type: "select", options: [["first hour", "First hour"], ["first day", "First day"], ["recovery", "Recovery"]] },
      { k: "owner_role", label: "Who runs it", mono: true, placeholder: ROLE_PH },
      { k: "items", label: "Actions, one per line", type: "textarea", span: 4, required: true },
      { k: "ord", label: "Order", type: "number" },
    ],
    list: ["title", "phase", "owner_role"], order: [["ord", true], ["title", true]],
  },
  erp_exercises: {
    table: "erp_exercises", path: "/erp/exer", noun: "exercise", posts: ["SM", "AM"],
    fields: [
      { k: "held_on", label: "Date", type: "date" },
      { k: "kind", label: "Kind", type: "select", options: [["tabletop", "Tabletop"], ["drill", "Drill"], ["full_scale", "Full scale"]] },
      { k: "status", label: "Status", type: "select", options: [["planned", "Planned"], ["done", "Done"], ["cancelled", "Cancelled"]] },
      { k: "scenario", label: "Scenario", required: true, span: 4 },
      { k: "participants", label: "Participants", span: 4 },
      { k: "lessons", label: "Lessons learned", type: "textarea", span: 2 },
      { k: "actions", label: "Actions decided", type: "textarea", span: 2 },
    ],
    list: ["scenario", "held_on", "kind", "status"], order: [["held_on", false]],
    tone: { status: { planned: "", done: "green", cancelled: "" } },
  },
  is_systems: {
    table: "is_systems", path: "/is/systems", noun: "system", posts: ["ISM", "AM"],
    fields: [
      { k: "name", label: "System", required: true, placeholder: "Leon, FlightLogger…" },
      { k: "kind", label: "Domain", placeholder: "operations, maintenance, training…" },
      { k: "provider", label: "Provider" },
      { k: "hosting", label: "Hosting", placeholder: "SaaS EU" },
      { k: "data", label: "Data held", span: 2 },
      { k: "owner_role", label: "Owner (post)", mono: true, placeholder: ROLE_PH },
      { k: "criticality", label: "Criticality", type: "select", options: LMH },
      { k: "safety_relevant", label: "Aviation safety relevant", type: "bool" },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["name", "kind", "provider", "hosting", "criticality", "safety_relevant"], order: [["name", true]],
    tone: { criticality: { high: "red", medium: "amber", low: "" } },
  },
  is_flows: {
    table: "is_flows", path: "/is/flows", noun: "interface", posts: ["ISM", "AM"],
    fields: [
      { k: "from_system", label: "From", required: true, placeholder: "Leon" },
      { k: "to_system", label: "To", required: true, placeholder: "S.A.M." },
      { k: "data", label: "Data", span: 2, placeholder: "Flights and crew lists" },
      { k: "means", label: "Means", placeholder: "API, e-mail, export" },
      { k: "contract_ref", label: "Contract", mono: true },
      { k: "is_clause", label: "Part-IS clause in the contract", type: "bool" },
      { k: "criticality", label: "Criticality", type: "select", options: LMH },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["from_system", "to_system", "data", "means", "is_clause", "criticality"], order: [["from_system", true]],
    tone: { criticality: { high: "red", medium: "amber", low: "" } },
  },
  is_risks: {
    table: "is_risks", path: "/is/risks", noun: "risk", posts: ["ISM", "AM"],
    fields: [
      { k: "system", label: "System or interface", placeholder: "Leon API" },
      { k: "threat", label: "Threat", required: true, span: 3, placeholder: "Account takeover of a dispatcher" },
      { k: "safety_impact", label: "Impact on aviation safety", type: "textarea", span: 4 },
      { k: "likelihood", label: "Likelihood (1-5)", type: "number" },
      { k: "severity", label: "Severity (1-5)", type: "number" },
      { k: "owner_role", label: "Owner (post)", mono: true, placeholder: ROLE_PH },
      { k: "due", label: "Treatment due", type: "date" },
      { k: "treatment", label: "Treatment", type: "textarea", span: 4 },
      { k: "status", label: "Status", type: "select", options: [["open", "Open"], ["treated", "Treated"], ["accepted", "Accepted"], ["closed", "Closed"]] },
      { k: "reviewed_on", label: "Last review", type: "date" },
    ],
    list: ["threat", "system", "likelihood", "severity", "status", "due"], order: [["status", true], ["due", true]],
    tone: { status: { open: "amber", treated: "", accepted: "", closed: "green" } },
  },
  is_incidents: {
    table: "is_incidents", path: "/is/inc", noun: "event", posts: ["ISM", "AM", "SM"],
    fields: [
      { k: "occurred_on", label: "Date", type: "date", required: true },
      { k: "title", label: "Event", required: true, span: 3, placeholder: "Phishing e-mail opened by a crew member" },
      { k: "system", label: "System" },
      { k: "status", label: "Status", type: "select", options: [["open", "Open"], ["closed", "Closed"]] },
      { k: "reported", label: "Reported to the authority", type: "bool" },
      { k: "report_ref", label: "Report reference", mono: true },
      { k: "description", label: "What happened", type: "textarea", span: 4 },
      { k: "safety_impact", label: "Impact on aviation safety", type: "textarea", span: 2 },
      { k: "actions", label: "Actions", type: "textarea", span: 2 },
    ],
    list: ["title", "occurred_on", "system", "reported", "status"], order: [["occurred_on", false]],
    tone: { status: { open: "amber", closed: "green" } },
  },
};

/** Text shown in a list cell. */
export function cell(f: Field | undefined, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (f?.type === "bool") return v ? "Yes" : "No";
  if (f?.type === "select") return f.options?.find(([k]) => k === v)?.[1] ?? String(v);
  return String(v);
}
