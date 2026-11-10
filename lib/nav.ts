// Generated from the S.A.M. prototype (v48) — single source of truth for the navigation.
export type RoleKey = "cmm" | "np" | "am" | "user";
export type Module = { id: string; label: string; icon: string; bottom?: boolean; erp?: boolean };
export type SubItem = { id: string; label: string; hidden?: boolean; gear?: boolean };
export const MODULES: Module[] = [{"id":"home","label":"Home","icon":"home","bottom":false,"erp":false},{"id":"dash","label":"Dashboards","icon":"dash","bottom":false,"erp":false},{"id":"docs","label":"Documents","icon":"docs","bottom":false,"erp":false},{"id":"comp","label":"Compliance","icon":"comp","bottom":false,"erp":false},{"id":"reg","label":"Regulation","icon":"reg","bottom":false,"erp":false},{"id":"safe","label":"Safety","icon":"safe","bottom":false,"erp":false},{"id":"np","label":"NP management","icon":"np","bottom":false,"erp":false},{"id":"comm","label":"Communication","icon":"comm","bottom":false,"erp":false},{"id":"is","label":"Part-IS","icon":"is","bottom":false,"erp":false},{"id":"proj","label":"Projects","icon":"proj","bottom":false,"erp":false},{"id":"erp","label":"ERP","icon":"erp","bottom":false,"erp":true},{"id":"users","label":"Users & fleet","icon":"users","bottom":true,"erp":false},{"id":"admin","label":"Registers","icon":"admin","bottom":true,"erp":false},{"id":"ref","label":"References","icon":"docs","bottom":true,"erp":false},{"id":"set","label":"Settings","icon":"admin","bottom":true,"erp":false}];
export const SUB: Record<string, SubItem[]> = {"home":[{"id":"decisions","label":"Decisions for me"},{"id":"domain","label":"My domain"},{"id":"mine","label":"My space"},{"id":"tasks","label":"Inbox"},{"id":"todo","label":"My to-do list"},{"id":"coffee","label":"Morning coffee","hidden":true}],"docs":[{"id":"lib","label":"Library"},{"id":"mine","label":"My manuals"},{"id":"drafts","label":"Drafts in progress"},{"id":"files","label":"Certificates & Validities"},{"id":"drop","label":"Drop a document"},{"id":"editor","label":"Revision editor","hidden":true}],"comp":[{"id":"over","label":"Overview"},{"id":"kpi","label":"Indicators"},{"id":"prog","label":"Audit programme"},{"id":"checks","label":"Compliance checks"},{"id":"audits","label":"Audits"},{"id":"auditors","label":"Internal auditors"},{"id":"find","label":"Findings"},{"id":"watch","label":"Regulatory watch"},{"id":"subs","label":"Subcontractors"}],"reg":[{"id":"ear","label":"Easy Access Rules"}],"safe":[{"id":"mine","label":"My reports"},{"id":"over","label":"Overview"},{"id":"reports","label":"Reports"},{"id":"actions","label":"Actions"},{"id":"new","label":"New report"},{"id":"risk","label":"Hazard log"},{"id":"moc","label":"Management of change"},{"id":"ra","label":"Risk assessments"},{"id":"inv","label":"Investigations"},{"id":"comm","label":"Committees (SRB / SAG)"},{"id":"mor","label":"MOR / ECCAIRS"},{"id":"promo","label":"Safety promotion"}],"is":[{"id":"over","label":"Overview"},{"id":"map","label":"Map"},{"id":"systems","label":"Systems register"},{"id":"flows","label":"Interfaces & contracts"},{"id":"risks","label":"IS risk assessment"},{"id":"inc","label":"IS events & incidents"}],"erp":[{"id":"plans","label":"Emergency plans"},{"id":"contacts","label":"Crisis directory"},{"id":"check","label":"Activation checklists"},{"id":"times","label":"Response times"},{"id":"activate","label":"Activation mode"},{"id":"exer","label":"Exercises"}],"proj":[{"id":"boards","label":"Projects"},{"id":"auth","label":"CAA applications"},{"id":"rex","label":"Closed & lessons learned"}],"sign":[{"id":"queue","label":"My signatures"},{"id":"reg","label":"Signature register"},{"id":"verify","label":"Verify a document"},{"id":"matrix","label":"Who signs what"},{"id":"rules","label":"Rules & evidence"}],"np":[{"id":"over","label":"Posts & org chart"},{"id":"changes","label":"Changes & approvals"},{"id":"assess","label":"Competency assessments"},{"id":"daily","label":"Absences & delegations"}],"comm":[{"id":"camp","label":"Communications"},{"id":"track","label":"Read tracking"},{"id":"new","label":"Create communication"}],"dash":[{"id":"codir","label":"CODIR / SRB"},{"id":"cs","label":"Compliance & Safety"},{"id":"group","label":"Group view","hidden":true},{"id":"obj","label":"Objectives 2027","hidden":true},{"id":"man","label":"Manpower","hidden":true}],"users":[{"id":"book","label":"People"},{"id":"fleet","label":"Aircraft registry"}],"admin":[{"id":"signreg","label":"Signature register"},{"id":"signrules","label":"Who signs what"},{"id":"comms","label":"Communications register"},{"id":"ai","label":"AI agents & usage"},{"id":"log","label":"Audit log"}],"ref":[{"id":"req","label":"Requirements register"},{"id":"basis","label":"NP regulatory basis"},{"id":"types","label":"Authority application types"},{"id":"ptpl","label":"Project templates"},{"id":"forms","label":"Project forms & sign-off"},{"id":"tpl","label":"Communication templates"},{"id":"aud","label":"Audiences"},{"id":"annex","label":"PRO-IS-01 annexes"},{"id":"gloss","label":"References & glossary"}],"set":[{"id":"ent","label":"Entities"},{"id":"param","label":"Parameters"},{"id":"levels","label":"Access levels"},{"id":"cat","label":"User categories & scope"},{"id":"integ","label":"Integrations"},{"id":"notif","label":"Notification rules"},{"id":"core","label":"Core"},{"id":"newac","label":"Add an aircraft"},{"id":"groups","label":"Entra groups sync"},{"id":"golive","label":"Go-live checklist"}]};
export const ROLES: Record<RoleKey, { label: string; home: string; mods: string[]; subs: Record<string, string[]> }> = {"cmm":{"label":"CMM / SM","home":"tasks","mods":["home","dash","docs","comp","reg","safe","np","comm","is","proj","erp","users","admin","ref","set"],"subs":{"reg":["ear"],"home":["tasks","todo","coffee"],"dash":["codir","cs","group","obj","man"],"docs":["lib","mine","drafts","files","editor","drop"],"comp":["over","kpi","prog","checks","audits","auditors","find","watch","subs"],"safe":["over","reports","actions","inv","new","mine","risk","moc","ra","comm","mor","promo"],"np":["over","changes","assess","daily"],"comm":["camp","track","new"],"is":["over","map","systems","flows","risks","inc"],"proj":["boards","auth","rex"],"erp":["plans","contacts","check","times","activate","exer"],"users":["book","fleet"],"admin":["signreg","signrules","comms","ai","log"],"ref":["req","basis","types","ptpl","forms","tpl","aud","annex","gloss"],"set":["ent","param","levels","cat","integ","notif","core","newac","groups","golive"]}},"np":{"label":"Nominated person","home":"domain","mods":["home","docs","comp","reg","safe","np","comm","proj","erp","ref"],"subs":{"reg":["ear"],"home":["domain","tasks","todo","coffee"],"docs":["lib","mine","drafts","files","editor","drop"],"comp":["find","audits","over","prog","subs"],"safe":["over","reports","actions","inv","new","risk","moc","ra","promo"],"np":["over","changes","assess","daily"],"comm":["camp","track","new"],"proj":["boards","auth","rex"],"erp":["plans","contacts","activate"],"ref":["req","basis","types","ptpl","forms","tpl","aud","annex","gloss"]}},"am":{"label":"Accountable Manager","home":"decisions","mods":["home","dash","docs","comp","reg","safe","np","comm","is","proj","erp","ref"],"subs":{"reg":["ear"],"home":["decisions","tasks","coffee"],"dash":["codir","cs"],"docs":["lib","drafts","files","editor","drop"],"comp":["over","kpi","prog","find"],"safe":["over","actions","inv","risk","comm","mor","promo"],"np":["over","changes"],"comm":["camp"],"is":["over","map","risks"],"proj":["boards","auth","rex"],"erp":["plans","contacts","activate"],"ref":["req","basis","types","ptpl","forms","tpl","aud","annex","gloss"]}},"user":{"label":"User (pilot, instructor…)","home":"mine","mods":["home","docs","reg","safe","comm","erp"],"subs":{"reg":["ear"],"home":["mine","coffee"],"docs":["lib"],"safe":["new","mine","promo"],"comm":["camp"],"erp":["plans","contacts","activate"]}}};
export const RAIL_DAILY = ["home","docs","comp","reg","safe","comm","proj"];
export const RAIL_BOTTOM = ["users","admin","ref","set"];
export const VERBS = {"mods":{"docs":"Read","safe":"Report","comm":"Messages","erp":"Emergency","home":"Home"},"subs":{"reg/ear":"Regulations","docs/lib":"My manuals","safe/new":"Report an event","safe/mine":"My reports","safe/promo":"Safety bulletins","comm/camp":"Messages to read","erp/plans":"Emergency plans","erp/contacts":"Who to call","erp/activate":"Activate the ERP","home/mine":"My space"}};

export const ENT: Record<string, { name: string; qual: string; auth: string }> = {
  ASFFR: { name: "Astonfly", qual: "Flight school · ATO + FSTD", auth: "DSAC" },
  ASJFR: { name: "Astonjet", qual: "Air operator · AOC France", auth: "DSAC" },
  ASJMT: { name: "Astonjet Ltd", qual: "Air operator + CAMO · Malta", auth: "TM-CAD" },
  ASTFR: { name: "Astontec", qual: "Maintenance · Part-CAE", auth: "OSAC" },
};
export const ENTS4 = ["ASJMT", "ASJFR", "ASFFR", "ASTFR"];
/** One colour per entity, used by the pills, the top-bar block and the rule under it; purple = group view. */
export const ENT_COLOR: Record<string, string> = { ASJMT: "#006c9c", ASJFR: "#3a7a1b", ASFFR: "#b8860b", ASTFR: "#b43a0f", ALL: "#7d166d" };

export function roleModules(role: RoleKey): Module[] {
  const R = ROLES[role];
  return MODULES.filter((m) => R.mods.includes(m.id));
}
/** FB-051 · the screens that exist in the beta (app/(app)/<mod>/<sub>); the others are prototype placeholders ("soon"). Keep in step with the folders. */
export const BUILT: Record<string, string[]> = {
  home: ["tasks", "coffee"], docs: ["lib", "mine", "drafts", "files", "drop", "editor", "manual", "new", "link"],
  comp: ["over", "kpi", "prog", "checks", "audits", "auditors", "find", "watch", "subs"], reg: ["ear"], dash: ["cs"], np: ["over"], proj: ["boards", "auth", "rex"], ref: ["ptpl", "types", "annex"],
  safe: ["over", "reports", "actions", "new", "mine", "risk", "moc", "ra", "inv", "comm", "mor", "promo"],
  set: ["integ", "notif", "core", "ent", "param", "levels", "cat", "newac", "groups", "golive"],
  comm: ["camp", "track", "new"], admin: ["signreg", "signrules", "comms", "ai", "log"], users: ["book", "fleet"],
  erp: ["plans", "contacts", "check", "times", "activate", "exer"], is: ["over", "map", "systems", "flows", "risks", "inc"],
};
export const isBuilt = (mod: string, sub: string) => (BUILT[mod] ?? []).includes(sub);
/** The first screen of a module that is actually built — never a placeholder when a real one exists. */
export function landingFor(role: RoleKey, mod: string): SubItem | undefined {
  const subs = subsFor(role, mod).filter((x) => !x.hidden);
  return subs.find((x) => isBuilt(mod, x.id)) ?? subs[0];
}
export function subsFor(role: RoleKey, mod: string): SubItem[] {
  const allow = ROLES[role].subs[mod] ?? [];
  const all = SUB[mod] ?? [];
  return allow.map((id) => all.find((s) => s.id === id)).filter((s): s is SubItem => !!s);
}
/** Vocabulary: verbs for staff / crew, regulatory terms for the office (UX-03 §11). */
export function modLabel(role: RoleKey, mod: Module): string {
  return role === "user" ? (VERBS.mods as Record<string, string>)[mod.id] ?? mod.label : mod.label;
}
export function subLabel(role: RoleKey, mod: string, sub: SubItem): string {
  return role === "user" ? (VERBS.subs as Record<string, string>)[`${mod}/${sub.id}`] ?? sub.label : sub.label;
}
export function homeFor(role: RoleKey): string {
  return `/home/${ROLES[role].home}`;
}
export function findSub(mod: string, sub: string): SubItem | undefined {
  return (SUB[mod] ?? []).find((s) => s.id === sub);
}
export function findModule(mod: string): Module | undefined {
  return MODULES.find((m) => m.id === mod);
}

/**
 * What the entity switch means on a page (09/11):
 *  - "group":  overviews, dashboards, inbox and lists — the Group view (every entity) makes sense here;
 *  - "single": the page works on one entity (creating, entering data, running a desk) — no Group: a group user lands on
 *              their home entity there, the Group view comes back on the overviews;
 *  - "none":   the page does not depend on the entity (settings, registers, references, a record's own page, which
 *              carries its entity) — the switch is shown greyed.
 * Unknown pages default to "group", i.e. the behaviour before this rule.
 */
export type EntMode = "group" | "single" | "none";
const ENT_SINGLE = ["safe/over/data", "safe/over/set", "safe/inv", "safe/comm", "safe/promo", "erp/activate", "docs/drop"];
// checked through what each page calls, not only what it reads itself: the registers (components/Register), Part-IS (isData),
// the admin registers (scopeOf), listManuals and the coffee all filter by the entity, so ERP, Part-IS, Registers and the
// aircraft registry are lists ("group"), not "none".
const ENT_NONE = ["set", "ref", "admin/signrules", "docs/link", "docs/editor", "docs/manual"];
const ENT_LISTS_UNDER_NONE = ["set/integ"]; // listManuals
const ENT_DEEP_LISTS = ["safe/risk/match", "safe/risk/templates", "dash/cs/overdue"]; // three segments, still lists
export function entMode(path: string): EntMode {
  const seg = path.split("?")[0].split("/").filter(Boolean);
  const p = seg.join("/");
  if (seg.includes("new") || ENT_SINGLE.includes(p)) return "single";
  if (ENT_LISTS_UNDER_NONE.includes(p)) return "group";
  if (ENT_NONE.some((x) => p === x || p.startsWith(x + "/"))) return "none";
  if (seg.length >= 3 && !ENT_DEEP_LISTS.includes(p)) return "none"; // a record's own page
  return "group";
}
/** The entity a group user works in on a "single" page: their home entity, else the first in scope. */
export function singleEntity(home: string | null | undefined, entities: string[]): string {
  return home && entities.includes(home) ? home : entities[0] ?? "ALL";
}
