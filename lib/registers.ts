// Generic registers (09/11): one description per table drives the list, the create / edit form and the server action.
// Used for the simple registers of Users & fleet, ERP and Part-IS. Only the tables and fields listed here can be written.
export type Field = {
  k: string; label: string;
  type?: "text" | "textarea" | "date" | "number" | "select" | "bool" | "ref";
  options?: [string, string][];       // [value, label]
  ref?: { table: string; label: string }; // type "ref": a row of another table of the same entity (id stored, label shown)
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
const APPLIES: [string, string][] = [["all", "Every scenario"], ["safety", "Safety emergency"], ["security", "Security emergency"], ["cyber", "Cyber-attack, IS event"], ["overdue", "Aircraft overdue"]];
export const ZONES: [string, string][] = [["g_compta", "Group, Accounting"], ["g_hr", "Group, HR"], ["g_it", "Group, IT"], ["g_mkt", "Group, Marketing"], ["g_own", "Group, Marketing / Owner"], ["g_gen", "Group, Generic"], ["trans", "Transverse"], ["fo", "Flight Ops"], ["camo", "Group CAMO (AJD)"], ["go", "Ground Ops"], ["training", "Training"], ["caa", "CAA / EASA, State channels"], ["asf", "Astonfly (ATO)"], ["pending", "Awaiting reply"]];
const ZONE_OPTS = ZONES;

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
      { k: "cell_safety", label: "Unit for a safety emergency (posts)", mono: true, span: 2, placeholder: "AM, SM, NPFO, NPCA" },
      { k: "cell_security", label: "Unit for a security or cyber emergency (posts)", mono: true, span: 2, placeholder: "AM, NPCT, SM, ISM" },
      { k: "deputy_rule", label: "If the AM is unavailable", span: 2 },
      { k: "location", label: "Crisis room and paper copy", span: 2 },
      { k: "triggers", label: "Events that may activate the plan, one per line", type: "textarea", span: 4 },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["title", "code", "manual_ref", "version", "reviewed_on", "next_review"], order: [["code", true], ["title", true]],
  },
  erp_contacts: {
    table: "erp_contacts", path: "/erp/contacts", noun: "contact", posts: ["SM", "AM"],
    fields: [
      { k: "crisis_role", label: "Role in the crisis", required: true, span: 2, placeholder: "Crisis director, Family assistance, BEA…" },
      { k: "kind", label: "Kind", type: "select", options: [["internal", "Unit member, staff"], ["authority", "Authority"], ["investigation", "Investigation bureau"], ["partner", "Partner, insurer"], ["contractor", "Contracted organisation"], ["emergency", "Emergency services"]] },
      { k: "post", label: "Post (holder taken from NP management)", mono: true, placeholder: "NPFO" },
      { k: "name", label: "Name" },
      { k: "deputy", label: "Deputy" },
      { k: "organisation", label: "Organisation" },
      { k: "phone", label: "Phone", mono: true },
      { k: "email", label: "E-mail" },
      { k: "available", label: "Availability", placeholder: "24/7" },
      { k: "ord", label: "Order", type: "number" },
      { k: "erp_clause", label: "Contractor: mutual ERP notification in the contract", type: "bool" },
      { k: "note", label: "Note", type: "textarea", span: 4 },
    ],
    list: ["crisis_role", "name", "organisation", "phone", "email", "kind"], order: [["ord", true], ["crisis_role", true]],
    tone: { kind: { internal: "", authority: "amber", investigation: "amber", partner: "", contractor: "", emergency: "red" } },
  },
  erp_checklists: {
    table: "erp_checklists", path: "/erp/check", noun: "checklist", posts: ["SM", "AM"],
    fields: [
      { k: "code", label: "Code", mono: true, placeholder: "ERP-AJD-04" },
      { k: "title", label: "Title", required: true, span: 3, placeholder: "Accountable Manager" },
      { k: "phase", label: "Phase", type: "select", options: [["alert", "Before activation"], ["first hour", "First hour"], ["first day", "First day"], ["recovery", "Recovery"]] },
      { k: "owner_role", label: "Who runs it", mono: true, placeholder: ROLE_PH },
      { k: "applies", label: "Scenario", type: "select", options: APPLIES },
      { k: "ord", label: "Order", type: "number" },
      { k: "items", label: "Actions, one per line", type: "textarea", span: 4, required: true },
      { k: "source", label: "Source", span: 4, placeholder: "AJD MSM 9.7.3.4" },
    ],
    list: ["title", "code", "phase", "owner_role", "applies", "source"], order: [["ord", true], ["title", true]],
  },
  erp_milestones: {
    table: "erp_milestones", path: "/erp/times", noun: "milestone", posts: ["SM", "AM"],
    fields: [
      { k: "label", label: "What must be done", required: true, span: 3, placeholder: "Passengers and crew on board sent to the authority" },
      { k: "minutes", label: "After the start (entered in minutes, 0 = at once)", type: "number" },
      { k: "owner_role", label: "Who", mono: true, placeholder: ROLE_PH },
      { k: "applies", label: "Scenario", type: "select", options: APPLIES },
      { k: "ord", label: "Order", type: "number" },
      { k: "source", label: "Source", placeholder: "MSM 9.6.3" },
    ],
    list: ["label", "minutes", "owner_role", "applies", "source"], order: [["minutes", true], ["ord", true]],
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
      { k: "short", label: "Role in one line", span: 2 },
      { k: "dept", label: "Department", placeholder: "Flight Ops, Group CAMO…" },
      { k: "zone", label: "Zone on the map", type: "select", options: ZONE_OPTS },
      { k: "resp", label: "Responsibility", type: "select", options: [["own", "Entity (own contract)"], ["grp", "Clair Group or another entity"], ["auth", "Authority or State"]] },
      { k: "subcontractor_id", label: "Contract (Subcontractors register)", type: "ref", ref: { table: "subcontractors", label: "name" }, span: 2 },
      { k: "contract", label: "Contract and IS clauses", type: "select", options: [["tbc", "Holder or IS clauses to confirm"], ["ok", "Confirmed"], ["none", "No contract"]] },
      { k: "ops_impact", label: "Operational impact", type: "select", options: [["?", "Not known"], ["Y", "Yes"], ["N", "No"]] },
      { k: "purpose", label: "Purpose", type: "textarea", span: 2 },
      { k: "data", label: "Data held", span: 2 },
      { k: "provider", label: "Provider" },
      { k: "hosting", label: "Hosting", placeholder: "SaaS EU" },
      { k: "owner_role", label: "Owner (post)", mono: true, placeholder: ROLE_PH },
      { k: "status", label: "Status", type: "select", options: [["confirmed", "Confirmed"], ["to_confirm", "To be confirmed"], ["awaiting", "Awaiting the department's reply"]] },
      { k: "attention", label: "Attention level", type: "select", options: [["", "None"], ["critical", "Critical"], ["serious", "To address"], ["warning", "To monitor"]] },
      { k: "ring", label: "Ring (1 critical, 2 standard, 3 lower)", type: "number" },
      { k: "criticality", label: "Criticality", type: "select", options: LMH },
      { k: "safety_relevant", label: "Aviation safety relevant", type: "bool" },
      { k: "source", label: "Source", placeholder: "Who answered, decision" },
      { k: "reviewed_on", label: "Last review", type: "date" },
      { k: "note", label: "Observations, one per line", type: "textarea", span: 4 },
    ],
    list: ["name", "dept", "resp", "contract", "ops_impact", "attention", "status"], order: [["name", true]],
    tone: { criticality: { high: "red", medium: "amber", low: "" }, attention: { critical: "red", serious: "amber", warning: "" }, contract: { tbc: "amber", ok: "green", none: "red" }, status: { confirmed: "", to_confirm: "amber", awaiting: "amber" } },
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
      { k: "system_id", label: "System (register)", type: "ref", ref: { table: "is_systems", label: "name" }, span: 2 },
      { k: "system", label: "Or interface, other", placeholder: "Leon API to ForeFlight", span: 2 },
      { k: "threat", label: "Threat", required: true, span: 4, placeholder: "Account takeover of a dispatcher" },
      { k: "safety_impact", label: "Impact on aviation safety", type: "textarea", span: 4 },
      { k: "likelihood", label: "Likelihood (1-5)", type: "number" },
      { k: "severity", label: "Severity (1-5)", type: "number" },
      { k: "owner_role", label: "Owner (post)", mono: true, placeholder: ROLE_PH },
      { k: "due", label: "Treatment due", type: "date" },
      { k: "treatment", label: "Treatment", type: "textarea", span: 4 },
      { k: "status", label: "Status", type: "select", options: [["open", "Open"], ["treated", "Treated"], ["accepted", "Accepted"], ["closed", "Closed"]] },
      { k: "reviewed_on", label: "Last review", type: "date" },
    ],
    list: ["threat", "system_id", "system", "likelihood", "severity", "status", "due"], order: [["status", true], ["due", true]],
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
  if (f?.k === "minutes" && typeof v === "number") return !v ? "at once" : v < 60 ? `${v} min` : v % 60 ? `${Math.floor(v / 60)} h ${v % 60}` : `${v / 60} h`; // FB-103 · 4320 → 72 h
  if (v === null || v === undefined || v === "") return "";
  if (f?.type === "bool") return v ? "Yes" : "No";
  if (f?.type === "select") return f.options?.find(([k]) => k === v)?.[1] ?? String(v);
  return String(v);
}
