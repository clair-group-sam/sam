import type { Session } from "@/lib/session";
import { isCmm } from "@/lib/revisions";

/* NP-03 · Competency assessments: the two house forms, as written.
 * ENR-COMP-01 (OPS) and ENR-COMP-02 (CAMO, CAMO.A.305(g), CAME § 2.9). A point applies to a person when it is ticked
 * for at least one of the functions assessed. {org} is replaced by the name of the entity.
 * 19/11 (Guillaume): Astonjet France and Astonjet Malta only (the Astonfly MSM names no competency assessment); the assessor is the
 * Compliance Monitoring Manager (MSM 1.5.2), never the AM; the person pre-fills the sheet, Compliance validates and signs. */
export const ASSESS_ENTITIES = ["ASJFR", "ASJMT"];
/** MSM 4-5 (Astonjet Ltd Iss 01 Rev 09, Astonjet Iss 10 Rev 07): "Those files have a validity period of 12 months." */
export const VALIDITY_MONTHS = 12;
export const validUntil = (assessedOn: string | null) => { if (!assessedOn) return null; const d = new Date(assessedOn + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + VALIDITY_MONTHS); return d.toISOString().slice(0, 10); };
export type FormKey = "OPS" | "CAMO";
export type FormPoint = { k: string; section: string; text: string; mask: string; initialOnly?: boolean };
export type FormDef = { key: FormKey; ref: string; edition: string; basis: string; functions: { code: string; label: string }[]; levels: [number, string][]; points: FormPoint[]; page3: boolean };
/** level / remark: the assessor (Compliance). self / self_remark: what the person wrote when pre-filling the sheet. */
export type Item = { k: string; section: string; text: string; level: number | null; remark: string | null; self?: number | null; self_remark?: string | null };
export type Assessment = {
  id: string; entity: string; form: FormKey; form_ref: string; form_edition: string | null; person_id: string | null; person_name: string; position: string | null;
  functions: string[]; kind: "initial" | "recurrent"; assessed_on: string | null; last_assessed_on: string | null; assessor_id: string | null; assessor_name: string | null;
  org_changes: string | null; items: Item[]; outcome: "fit" | "fit_training" | "not_fit" | null; training_required: string | null; diplomas: string | null; trainings: string | null;
  next_due: string | null; status: "draft" | "submitted" | "signed"; submitted_at: string | null; signed_at: string | null; signed_by: string | null; created_by: string | null; created_at: string;
};

const ops = (rows: [string, string][]): FormPoint[] => rows.map(([text, mask], i) => ({ k: String(i + 1), section: "Points to evaluate", text, mask }));
const sec = (section: string, prefix: string, rows: [string, string][], initialOnly = false): FormPoint[] => rows.map(([text, mask], i) => ({ k: `${prefix}${i + 1}`, section, text, mask, initialOnly }));
const ALL = "XXXXXX";

export const FORMS: Record<FormKey, FormDef> = {
  OPS: {
    key: "OPS", ref: "ENR-COMP-01", edition: "Edit. 01 Rev 01, 07/03/2025", basis: "", page3: false,
    functions: [{ code: "NPFO", label: "NPFO" }, { code: "NPCT", label: "NPCT" }, { code: "NPGO", label: "NPGO" }, { code: "AUDITOR", label: "Auditor" }],
    levels: [[4, "Acquired"], [3, "Acquired under supervision / in cooperation"], [2, "In the process of acquisition"], [1, "Not acquired"]],
    points: ops([
      ["Knowledge of human performance and limitations.", "XXXX"],
      ["Knowledge of the organization's capabilities, privileges, and limitations.", "XXXX"],
      ["Knowledge of EU Safety Regulations", "XXX-"],
      ["Regulatory Knowledge", "XXX-"],
      ["Knowledge of the OM and associated procedures.", "XXXX"],
      ["Knowledge of AOC holder's ERP", "XXX-"],
      ["Knowledge of AOC holder's FTL scheme", "X-X-"],
      ["Familiarity with Management Systems in Aviation", "XXXX"],
      ["Knowledge of the event reporting system and understanding the importance of reporting events.", "XXX-"],
      ["Ability to promote safety and compliance policy.", "XXX-"],
      ["Ability to demonstrate integrity and impartiality.", "XXX-"],
      ["Understanding of professional integrity, behavior, and attitude towards safety.", "XXX-"],
      ["Ability to consider human limitations and performance.", "XXX-"],
      ["Ability to develop Training Program", "-X--"],
      ["Ability to deliver Training", "-XX-"],
      ["Ability to evaluate crew", "XX--"],
      ["Ability to prioritize tasks and report any irregularities.", "XXX-"],
      ["Knowledge of audit techniques (auditor skills).", "---X"],
      ["Ability to draft audit findings and reports.", "---X"],
      ["Ability to manage and support team members", "XXX-"],
      ["Technical knowledge in relation to the task performed by the managed team", "XXX-"],
    ]),
  },
  CAMO: {
    key: "CAMO", ref: "ENR-COMP-02", edition: "Edit. 1 Rev 1, 07/03/2025", basis: "CAMO.A.305 (g), CAME § 2.9", page3: true,
    functions: [{ code: "CAM", label: "Continuing Airworthiness Manager" }, { code: "CMM", label: "Compliance Monitoring Manager" }, { code: "SM", label: "Safety Manager" },
      { code: "AE", label: "Airworthiness engineers" }, { code: "ARS", label: "Airworthiness Review Staff" }, { code: "CMS", label: "Compliance Monitoring Staff" }],
    levels: [[4, "Acquired"], [3, "Acquired under supervision"], [2, "In the process of acquisition"], [1, "Not acquired"]],
    points: [
      ...sec("Knowledge", "K", [
        ["Knowledge of applicable officially recognised standards", ALL],
        ["Knowledge of auditing techniques: planning, conducting and reporting", "-XX--X"],
        ["Knowledge of {org} organisation capabilities, privileges and limitations", ALL],
        ["Knowledge of Part-M, Part-145, Part-CAMO and their evolutions", ALL],
        ["Knowledge of relevant parts of the continuing airworthiness management exposition and procedures", ALL],
        ["Knowledge of occurrence reporting system and understanding of the importance of reporting occurrences", ALL],
        ["Knowledge of safety risks linked to the working environment", ALL],
        ["Knowledge of Fuel Tank Safety", "XX-XXX"],
        ["Knowledge of CDCCL", "XX-XXX"],
        ["Knowledge of Corrosion Prevention Requirements", "X--XXX"],
        ["Knowledge of Aging Aircraft Requirements", "X--XXX"],
        ["Knowledge of the embodiment policy of modifications and repairs", "X--XXX"],
        ["Knowledge of required certification of components fitted on EASA registered aircraft", "X--X-X"],
        ["Knowledge of maintenance methods", "XXX-X-"],
        ["Knowledge of a relevant sample of type(s) of aircraft gained through a formalised training course (at least at a level equivalent to Level 1 General Familiarisation)", ALL],
        ["Knowledge of Management and Compliance Systems", "XXX-XX"],
        ["Comprehensive knowledge of relevant parts of operational requirements and procedures, {org} operations specifications, and the need for and content of the relevant parts of the {org} operations manual", "XXX--X"],
        ["Knowledge of design status of aircraft in operation", "X--X--"],
        ["Knowledge of Human Factors issues", ALL],
      ]),
      ...sec("Experience (initial competency assessment only)", "E", [
        ["Practical experience and expertise in the application of aviation safety standards and safe operating practices", "XXX---"],
        ["Five Years Relevant Work Experience", "XXX---"],
        ["Two Years in an appropriate position in the aeronautical industry", "XXX---"],
        ["Auditing Experience", "-XX--X"],
        ["Five Years / Three Years experience in continuing airworthiness (depending on work scope of organisation), of which at least six months in the last 2 years", "X---X-"],
        ["Position within the approved organisation with appropriate responsibilities", "X---X-"],
        ["Conducted at least one airworthiness review in the last twelve month period", "----X-"],
        ["Safety Management", "--X---"],
        ["A relevant engineering/Aeronautical degree or an aircraft maintenance technician qualification with additional education acceptable to the competent authority. Such qualification may be replaced by additional 5 years", "XXX-X-"],
      ], true),
      ...sec("Skills", "S", [
        ["Adequate communication and English literacy skills", ALL],
        ["Ability to properly record work accomplished", ALL],
        ["Ability to use information systems", ALL],
        ["Ability to develop and control an Aircraft Maintenance Programme (AMP)", "X--X--"],
        ["Understanding of Reliability Monitoring", "X--X--"],
        ["Ability to coordinate scheduled maintenance, application of ADs, replacement of service life limited parts and component inspections", "X--X--"],
        ["Ability to coordinate performance of unscheduled maintenance", "X--X--"],
        ["Ability to perform mass and balance calculations and ensure that the mass and balance statement reflects the current status of the aircraft", "X--X--"],
        ["Ability to use and understand maintenance data", "X--XX-"],
        ["Ability to analyse and review Airworthiness Directives and Service Bulletins", "X--XX-"],
        ["Analytical and proven auditing skills (objectivity, fairness, open-mindedness, determination,...)", "-XX--X"],
        ["Ability to compile reports", "-XX-XX"],
        ["Ability to perform root cause analysis and formulate corrective and preventive action", "XXX--X"],
        ["Ability to understand the utilisation of MEL and defect deferral", "X--XX-"],
        ["Ability to understand and verify the utilisation of ATL", "X--XX-"],
        ["Understanding of conditions for ensuring continuing airworthiness of aircraft and components", "X--XX-"],
        ["Understanding of personnel authorisations and limitations", "XXX-XX"],
        ["Understanding critical maintenance tasks and ability to identify such tasks", "X--XX-"],
        ["Ability to determine required qualifications for task performance", "XX-XXX"],
        ["Ability to identify and rectify existing and potential unsafe conditions", ALL],
        ["Ability to manage sub-contracted organisations", "X-----"],
        ["Ability to confirm proper accomplishment of tasks", "XX-XXX"],
        ["Ability to issue work orders", "X--X--"],
        ["Ability to review work reports", "X-XXX-"],
        ["Ability to analyse engine health monitoring data", "X--XX-"],
        ["Ability and knowledge of retention of aircraft continuing airworthiness record system", "X--XX-"],
        ["Ability to perform an aircraft physical survey", "----X-"],
        ["Ability to perform an aircraft documental survey", "----X-"],
        ["Understanding of an understanding of management systems, including compliance monitoring systems; an understanding of risk management;", "XXX--X"],
        ["Understanding of safety investigation techniques and root cause methodologies", "XXX--X"],
        ["Understanding of HF", ALL],
        ["Understanding and promotion of a positive safety culture", "XXX--X"],
        ["Ability to prioritize tasks and report any irregularities", "X-----"],
      ]),
      ...sec("Aptitude", "A", [
        ["Understanding of his/her own human performance and limitations", ALL],
        ["Ability to prioritise and process the work required", ALL],
        ["Ability in resolving work-based problems", ALL],
        ["Ability to analyse statistics, figures and charts", ALL],
        ["Capacity to digest information from passages of text", ALL],
        ["Ability to apply engineering principles to problems", ALL],
        ["Ability to identify errors", ALL],
        ["Ability to promote the safety and quality policy", "XXX--X"],
        ["Ability to improve procedures and systems", ALL],
        ["Interpersonal and leadership skills, and the ability to influence staff", "-XX---"],
      ]),
      ...sec("Attitude", "T", [
        ["Understanding of professional integrity, behaviour and attitude towards safety", ALL],
        ["Leadership and command abilities", "XXX---"],
        ["Judgement and decision making skills", ALL],
        ["Ability to work in a Team and shows respect towards colleagues", ALL],
        ["Ability to act responsibly", ALL],
        ["Shows commitment to tasks at hand", ALL],
        ["Exhibits perseverance and determination when faced with strenuous tasks", ALL],
        ["Engages in tasks with a positive attitude and enthusiasm", ALL],
        ["Maintenance of company philosophy and spirit", ALL],
        ["Reliability in carrying out duties", ALL],
        ["Ability to demonstrate integrity and impartiality.", "-XX--X"],
      ]),
    ],
  },
};

export const OUTCOME: Record<string, [string, string]> = { fit: ["Yes", "green"], fit_training: ["Yes but additional training required", "amber"], not_fit: ["No", "red"] };
export const isForm = (x: string): x is FormKey => x === "OPS" || x === "CAMO";

/** The points of a form that apply to the functions assessed (ticked for at least one of them), in the order of the form. */
export function pointsFor(form: FormKey, functions: string[], kind: "initial" | "recurrent", orgName: string): Item[] {
  const F = FORMS[form]; const idx = F.functions.map((f, i) => (functions.includes(f.code) ? i : -1)).filter((i) => i >= 0);
  return F.points.filter((p) => idx.some((i) => p.mask[i] === "X") && (!p.initialOnly || kind === "initial"))
    .map((p) => ({ k: p.k, section: p.section, text: p.text.replaceAll("{org}", orgName), level: null, remark: null }));
}
export function progress(a: Pick<Assessment, "items">) { const n = a.items.length; const done = a.items.filter((i) => i.level).length; return { n, done, low: a.items.filter((i) => i.level && i.level <= 2).length }; }
/** What still prevents the signature by Compliance. */
export function missingToSign(a: Assessment): string[] {
  const m: string[] = []; const p = progress(a);
  if (!a.assessed_on) m.push("date of assessment");
  if (p.done < p.n) m.push(`${p.n - p.done} point${p.n - p.done === 1 ? "" : "s"} without a level`);
  if (!a.outcome) m.push("fit for position: yes / yes with training / no");
  if (a.outcome === "fit_training" && !a.training_required?.trim()) m.push("the training required");
  return m;
}
export const selfProgress = (a: Pick<Assessment, "items">) => ({ n: a.items.length, done: a.items.filter((i) => i.self).length });

/** Compliance (CMM and deputy) of the entity: the assessor. */
export const isDesk = (s: Session) => isCmm(s) || s.role === "cmm";
const deskOf = (s: Session, entity: string) => isDesk(s) && (s.group || s.entities.includes(entity));
/** A sheet is seen by Compliance and by the person assessed. */
export function maySee(s: Session, a: Pick<Assessment, "entity" | "person_id">): boolean {
  return a.person_id === (s.person?.id ?? "-") || deskOf(s, a.entity);
}
/** The person pre-fills their own sheet while it is a draft. */
export function mayPrefill(s: Session, a: Pick<Assessment, "person_id" | "status">): boolean {
  return a.status === "draft" && !!s.person && a.person_id === s.person.id;
}
/** Compliance grades, decides and signs — never its own sheet. */
export function mayValidate(s: Session, a: Pick<Assessment, "entity" | "person_id" | "status">): boolean {
  return a.status !== "signed" && deskOf(s, a.entity) && a.person_id !== (s.person?.id ?? "-");
}
/** A nominated person (or deputy) may open their own sheet to pre-fill it. */
export const mayStartOwn = (s: Session) => !!s.person && (s.role === "np" || s.role === "cmm");
