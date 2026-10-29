// TMS-03 · "@S.A.M." in a chat or a channel: read the thread (Graph, RSC permissions consented when the app was added there),
// let Claude draft a safety report from it, show an editable card; "Create in S.A.M." stores the report exactly as the app form does.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude } from "@/lib/ai";
import { PHASES } from "@/lib/safety-shared";
import { createReport, type NewReport } from "@/lib/safety-create";
import { graphToken, origin } from "@/lib/teams";
import { DOMAINS, MOC_CATEGORIES } from "@/lib/risk-shared";
import { createAuthorityFile } from "@/lib/authority-create";
import { createMoc } from "@/lib/moc-create";

export type ThreadRef = { kind: "chat" | "channel"; chatId?: string; teamId?: string; channelId?: string; rootId?: string };
export type ThreadMsg = { from: string; at: string; text: string };
const strip = (html: string) => html.replace(/<at[^>]*>.*?<\/at>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();

/** Where the activity comes from, in Graph terms. Channel activities carry the root message id in the conversation id (";messageid=…"). */
export function threadRefOf(a: { conversation: { id: string; conversationType?: string }; channelData?: { team?: { id?: string; aadGroupId?: string }; channel?: { id?: string } }; replyToId?: string }): ThreadRef | null {
  const type = a.conversation.conversationType ?? "personal";
  if (type === "groupChat") return { kind: "chat", chatId: a.conversation.id.split(";")[0] };
  if (type === "channel") {
    const teamId = a.channelData?.team?.aadGroupId; const channelId = a.channelData?.channel?.id ?? a.conversation.id.split(";")[0];
    const rootId = /messageid=(\d+)/.exec(a.conversation.id)?.[1] ?? a.replyToId;
    return teamId && channelId ? { kind: "channel", teamId, channelId, rootId } : null;
  }
  return null;
}
/** The last messages of the thread (oldest first), 40 at most, as plain text. Throws with the Graph error when the app is not allowed there. */
export async function readThread(ref: ThreadRef): Promise<ThreadMsg[]> {
  const H = { authorization: `Bearer ${await graphToken()}` };
  const urls: string[] = [];
  if (ref.kind === "chat") urls.push(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(ref.chatId!)}/messages?$top=40`);
  else if (ref.rootId) { urls.push(`https://graph.microsoft.com/v1.0/teams/${ref.teamId}/channels/${encodeURIComponent(ref.channelId!)}/messages/${ref.rootId}`); urls.push(`https://graph.microsoft.com/v1.0/teams/${ref.teamId}/channels/${encodeURIComponent(ref.channelId!)}/messages/${ref.rootId}/replies?$top=40`); }
  else urls.push(`https://graph.microsoft.com/v1.0/teams/${ref.teamId}/channels/${encodeURIComponent(ref.channelId!)}/messages?$top=40`);
  type G = { id: string; createdDateTime: string; from?: { user?: { displayName?: string }; application?: { displayName?: string } }; body?: { content?: string; contentType?: string }; messageType?: string; value?: G[]; error?: { code: string; message: string } };
  const out: ThreadMsg[] = [];
  for (const u of urls) {
    const r = await fetch(u, { headers: H });
    const j = (await r.json()) as G;
    if (!r.ok) throw new Error(`${j.error?.code ?? r.status}: ${j.error?.message ?? "Graph refused"}`);
    for (const m of j.value ?? [j]) {
      if (m.messageType && m.messageType !== "message") continue;
      const text = strip(m.body?.content ?? ""); if (!text) continue;
      out.push({ from: m.from?.user?.displayName ?? m.from?.application?.displayName ?? "?", at: m.createdDateTime, text });
    }
  }
  return out.sort((x, y) => x.at.localeCompare(y.at)).slice(-40);
}

export type Draft = { occurrence: boolean; reason: string; entity: string; headline: string; narrative: string; event_date: string; event_time_utc: string; aircraft: string; flight_ref: string; phase: string; location: string; language: string; missing: string[] };
/** Claude reads the thread and drafts the report: facts only, in the language of the thread, with what is still missing. */
export async function draftReport(db: SupabaseClient, personId: string, entities: string[], thread: ThreadMsg[], instruction: string): Promise<Draft> {
  const transcript = thread.map((m) => `[${m.at.slice(0, 16).replace("T", " ")}] ${m.from}: ${m.text}`).join("\n").slice(0, 12000);
  const { text } = await callClaude({ agent: "safety", personId, entity: entities[0] ?? null, maxTokens: 1500,
    system: `You draft a safety (occurrence) report for an aviation operator from a Teams conversation. Facts only, in chronological order, in the language of the conversation; never guess causes, blame or human factors; never invent a date, a registration or a flight number — leave the field empty and list it in "missing". If the conversation describes NO safety occurrence (administrative talk, tests, chit-chat), answer {"occurrence":false,"reason":"one short line"} and nothing else. The headline is one factual line (what, where). Entities: ${entities.join(", ")} (pick the one the conversation is about, else the first). Phases: ${PHASES.join(" | ")}. Answer ONLY JSON: {"occurrence":true,"entity":"…","headline":"…","narrative":"…","event_date":"YYYY-MM-DD or empty","event_time_utc":"HH:MM or empty","aircraft":"registration or empty","flight_ref":"…","phase":"one of the phases or empty","location":"…","language":"fr|en|…","missing":["…"]}`,
    user: `Instruction from the person who mentioned S.A.M.: ${instruction || "(none — a safety report from this conversation)"}\n\nConversation:\n${transcript}` });
  const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error("No draft.");
  const j = JSON.parse(m[0]) as Partial<Draft>;
  if (j.occurrence === false) return { occurrence: false, reason: typeof j.reason === "string" ? j.reason.slice(0, 200) : "", entity: entities[0] ?? "", headline: "", narrative: "", event_date: "", event_time_utc: "", aircraft: "", flight_ref: "", phase: "", location: "", language: "", missing: [] };
  const str = (v: unknown, n = 2000) => (typeof v === "string" ? v.slice(0, n) : "");
  return { occurrence: true, reason: "", entity: entities.includes(str(j.entity)) ? str(j.entity) : entities[0] ?? "", headline: str(j.headline, 200), narrative: str(j.narrative, 6000), event_date: /^\d{4}-\d{2}-\d{2}$/.test(str(j.event_date)) ? str(j.event_date) : "", event_time_utc: /^\d{2}:\d{2}$/.test(str(j.event_time_utc)) ? str(j.event_time_utc) : "", aircraft: str(j.aircraft, 12), flight_ref: str(j.flight_ref, 40), phase: PHASES.includes(str(j.phase)) ? str(j.phase) : "", location: str(j.location, 120), language: str(j.language, 5), missing: Array.isArray(j.missing) ? j.missing.map(String).slice(0, 6) : [] };
}

/** The editable draft card: every field is an input; Create in S.A.M. / Discard. `ref` travels in the action data so the thread is attached at creation. */
export function draftCard(d: Draft, entities: string[], ref: ThreadRef, by: string): unknown {
  const body: unknown[] = [
    { type: "TextBlock", text: "S.A.M. · Safety report — draft", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: `Drafted from this conversation for ${by}. Check and complete, then create it in S.A.M. — nothing is stored until then.`, wrap: true, isSubtle: true },
    { type: "Input.ChoiceSet", id: "entity", label: "Entity", value: d.entity, choices: entities.map((e) => ({ title: e, value: e })), style: "compact" },
    { type: "Input.Text", id: "headline", label: "Title (one factual line)", value: d.headline, maxLength: 200 },
    { type: "Input.Text", id: "narrative", label: "What happened", value: d.narrative, isMultiline: true, maxLength: 6000 },
    { type: "ColumnSet", columns: [
      { type: "Column", width: "stretch", items: [{ type: "Input.Date", id: "event_date", label: "Date", value: d.event_date || undefined }] },
      { type: "Column", width: "stretch", items: [{ type: "Input.Time", id: "event_time_utc", label: "Time UTC", value: d.event_time_utc || undefined }] },
    ] },
    { type: "ColumnSet", columns: [
      { type: "Column", width: "stretch", items: [{ type: "Input.Text", id: "aircraft", label: "Aircraft", value: d.aircraft, maxLength: 12 }] },
      { type: "Column", width: "stretch", items: [{ type: "Input.Text", id: "flight_ref", label: "Flight", value: d.flight_ref, maxLength: 40 }] },
    ] },
    { type: "Input.ChoiceSet", id: "phase", label: "Phase", value: d.phase || undefined, placeholder: "Phase of flight", choices: PHASES.map((p) => ({ title: p, value: p })), style: "compact" },
    { type: "Input.Text", id: "location", label: "Location", value: d.location, maxLength: 120 },
  ];
  if (d.missing.length) body.push({ type: "TextBlock", text: `Still missing: ${d.missing.join(", ")}.`, wrap: true, color: "Attention", spacing: "Small" });
  const actions = [
    { type: "Action.Execute", title: "Create in S.A.M.", verb: "report_create", style: "positive", data: { ref, language: d.language } },
    { type: "Action.Execute", title: "Discard", verb: "report_discard", data: {} },
  ];
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, actions, msteams: { width: "Full" } };
}
export function createdCard(id: string, headline: string, by: string): unknown {
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [
    { type: "TextBlock", text: "S.A.M. · Safety report", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: `${id} — ${headline}`, size: "Medium", weight: "Bolder", wrap: true },
    { type: "TextBlock", text: `Created by ${by}. The Safety Manager has it in the Inbox (72 h clock running); the conversation is attached as context.`, wrap: true },
  ], actions: [{ type: "Action.OpenUrl", title: "Open in S.A.M.", url: `${origin()}/safe/reports/${id}` }], msteams: { width: "Full" } };
}
export function discardedCard(by: string): unknown {
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: "S.A.M.", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" }, { type: "TextBlock", text: `Draft discarded by ${by}. Nothing was stored.`, wrap: true }] };
}

/** Creates the report from the card's inputs; the thread is re-read and kept with the report as context (complements.teams_thread). */
export async function createFromCard(db: SupabaseClient, person: { id: string; display_name: string; entities: string[] }, data: Record<string, unknown>): Promise<{ ok: true; id: string; headline: string } | { ok: false; error: string }> {
  const g = (k: string, n = 2000) => (typeof data[k] === "string" ? (data[k] as string).slice(0, n) : "");
  const entity = g("entity", 3);
  if (!person.entities.includes(entity)) return { ok: false, error: "Entity outside your scope." };
  const ref = data.ref as ThreadRef | undefined;
  let transcript = "";
  try { if (ref) transcript = (await readThread(ref)).map((m) => `[${m.at.slice(0, 16).replace("T", " ")}] ${m.from}: ${m.text}`).join("\n").slice(0, 20000); } catch { /* context only */ }
  const r: NewReport = { entity, headline: g("headline", 200), narrative: g("narrative", 6000), event_date: g("event_date", 10), event_time_utc: g("event_time_utc", 5), aircraft: g("aircraft", 12), flight_ref: g("flight_ref", 40), phase: g("phase", 40), location: g("location", 120), contributing: "", anonymous: false, language: g("language", 5),
    precisions: { source: "Teams conversation", ...(transcript ? { teams_thread: transcript } : {}) } };
  const res = await createReport(db, r, person.id, { source: "teams", note: `Received — created from a Teams conversation by ${person.display_name}` });
  return res.ok ? { ok: true, id: res.id, headline: r.headline } : res;
}

/* ---------- intent: what the person wants from the thread ---------- */
export type Intent = "report" | "authority" | "moc";
/** Picks the object to draft from the instruction (and the thread when the instruction is silent). Cheap call, no draft yet. */
export async function classifyIntent(db: SupabaseClient, personId: string, instruction: string, thread: ThreadMsg[]): Promise<{ intent: Intent; reason: string }> {
  const quick = instruction.toLowerCase();
  if (/\b(moc|management of change|changement|change request)\b/.test(quick)) return { intent: "moc", reason: "instruction" };
  if (/\b(authority file|dossier|application|tm-?cad|meteor|osac|dsac|submission|soumission|notification)\b/.test(quick)) return { intent: "authority", reason: "instruction" };
  if (/\b(report|occurrence|rapport|incident|event|événement|evenement)\b/.test(quick)) return { intent: "report", reason: "instruction" };
  try {
    const { text } = await callClaude({ agent: "safety", personId, entity: null, maxTokens: 120,
      system: `Classify what an aviation compliance/safety colleague wants S.A.M. to open from a Teams conversation. "report" = a safety occurrence report (something happened: bird strike, TCAS, technical event, ground incident…). "authority" = an application / notification file to the authority (manual revision, aircraft addition, nominated person, approval…). "moc" = a management-of-change assessment (organisational, fleet, base, procedure or equipment change to assess). Answer ONLY JSON {"intent":"report|authority|moc","reason":"short"}.`,
      user: `Instruction: ${instruction || "(none)"}\n\nLast messages:\n${thread.slice(-12).map((m) => `${m.from}: ${m.text}`).join("\n").slice(0, 4000)}` });
    const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as { intent?: string; reason?: string };
    return { intent: (["report", "authority", "moc"].includes(j.intent ?? "") ? j.intent : "report") as Intent, reason: j.reason ?? "" };
  } catch { return { intent: "report", reason: "default" }; }
}

/* ---------- authority file from a thread ---------- */
export type AuthorityDraft = { entity: string; type_code: string; title: string; owner_role: string; trigger_note: string; aircraft_reg: string; missing: string[] };
type TypeRow = { code: string; name: string; entities: string[]; default_owner_role: string | null; active: boolean };
export async function draftAuthority(db: SupabaseClient, personId: string, entities: string[], thread: ThreadMsg[], instruction: string): Promise<{ d: AuthorityDraft; types: TypeRow[] }> {
  const { data } = await db.from("authority_file_types").select("code,name,entities,default_owner_role,active").eq("active", true).order("ord");
  const types = ((data ?? []) as TypeRow[]).filter((t) => t.entities.some((e) => entities.includes(e)));
  const transcript = thread.map((m) => `[${m.at.slice(0, 16).replace("T", " ")}] ${m.from}: ${m.text}`).join("\n").slice(0, 10000);
  const { text } = await callClaude({ agent: "file", personId, entity: entities[0] ?? null, maxTokens: 800,
    system: `You open an authority application file for an aviation operator from a Teams conversation. Pick the type from the catalogue (code → name → entities): ${types.map((t) => `${t.code}: ${t.name} [${t.entities.join("/")}]`).join("; ")}. Entities of the person: ${entities.join(", ")}. Title = one factual line naming the object (manual + issue/rev, aircraft registration, post…). trigger_note = 2-3 lines on what triggers the application, facts from the conversation only. Never invent a registration, a revision number or a date — list what is missing. Answer ONLY JSON {"entity":"…","type_code":"…","title":"…","owner_role":"post code or empty","trigger_note":"…","aircraft_reg":"… or empty","missing":["…"]}`,
    user: `Instruction: ${instruction || "(none — an authority file from this conversation)"}\n\nConversation:\n${transcript}` });
  const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as Partial<AuthorityDraft>;
  const str = (v: unknown, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");
  const entity = entities.includes(str(j.entity)) ? str(j.entity) : entities[0] ?? "";
  const type = types.find((t) => t.code === str(j.type_code) && t.entities.includes(entity)) ?? types.find((t) => t.entities.includes(entity));
  return { d: { entity, type_code: type?.code ?? "", title: str(j.title, 200), owner_role: str(j.owner_role, 10) || type?.default_owner_role || "", trigger_note: str(j.trigger_note, 1500), aircraft_reg: str(j.aircraft_reg, 10), missing: Array.isArray(j.missing) ? j.missing.map(String).slice(0, 6) : [] }, types };
}
export function authorityCard(d: AuthorityDraft, entities: string[], types: TypeRow[], ref: ThreadRef, by: string): unknown {
  const body: unknown[] = [
    { type: "TextBlock", text: "S.A.M. · Authority file — draft", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: `Drafted from this conversation for ${by}. The file opens in Draft with the checklist of its type; nothing is sent to the authority.`, wrap: true, isSubtle: true },
    { type: "Input.ChoiceSet", id: "entity", label: "Entity", value: d.entity, choices: entities.map((e) => ({ title: e, value: e })), style: "compact" },
    { type: "Input.ChoiceSet", id: "type_code", label: "Type of application", value: d.type_code, choices: types.map((t) => ({ title: `${t.code} — ${t.name.slice(0, 70)} [${t.entities.join("/")}]`, value: t.code })), style: "compact" },
    { type: "Input.Text", id: "title", label: "Title", value: d.title, maxLength: 200 },
    { type: "ColumnSet", columns: [
      { type: "Column", width: "stretch", items: [{ type: "Input.Text", id: "owner_role", label: "Owner post", value: d.owner_role, maxLength: 10 }] },
      { type: "Column", width: "stretch", items: [{ type: "Input.Text", id: "aircraft_reg", label: "Aircraft (if any)", value: d.aircraft_reg, maxLength: 10 }] },
    ] },
    { type: "Input.Text", id: "trigger_note", label: "What triggers it", value: d.trigger_note, isMultiline: true, maxLength: 1500 },
  ];
  if (d.missing.length) body.push({ type: "TextBlock", text: `Still missing: ${d.missing.join(", ")}.`, wrap: true, color: "Attention", spacing: "Small" });
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, actions: [
    { type: "Action.Execute", title: "Open the file in S.A.M.", verb: "authority_create", style: "positive", data: { ref } },
    { type: "Action.Execute", title: "Discard", verb: "report_discard", data: {} }], msteams: { width: "Full" } };
}
export async function createAuthorityFromCard(db: SupabaseClient, person: { id: string; display_name: string; entities: string[] }, data: Record<string, unknown>): Promise<{ ok: true; id: string; title: string } | { ok: false; error: string }> {
  const g = (k: string, n = 2000) => (typeof data[k] === "string" ? (data[k] as string).trim().slice(0, n) : "");
  const entity = g("entity", 3);
  if (!person.entities.includes(entity)) return { ok: false, error: "Entity outside your scope." };
  try {
    const f = await createAuthorityFile(db, { personId: person.id, name: person.display_name }, { entity, type_code: g("type_code", 12), title: g("title", 200) || null, owner_role: g("owner_role", 10) || null, trigger_kind: "other", trigger_note: g("trigger_note", 1500) || null, aircraft_reg: g("aircraft_reg", 10).toUpperCase() || null }, "teams");
    return { ok: true, id: f.id, title: f.title };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Not created" }; }
}

/* ---------- MOC from a thread ---------- */
export type MocDraft = { entity: string; name: string; description: string; domain: string; category: string; change_type: string; start_date: string; reason: string; requestor: string; missing: string[] };
export async function draftMoc(db: SupabaseClient, personId: string, entities: string[], thread: ThreadMsg[], instruction: string): Promise<MocDraft> {
  const transcript = thread.map((m) => `[${m.at.slice(0, 16).replace("T", " ")}] ${m.from}: ${m.text}`).join("\n").slice(0, 10000);
  const { text } = await callClaude({ agent: "safety", personId, entity: entities[0] ?? null, maxTokens: 900,
    system: `You open a management-of-change (MOC) assessment for an aviation operator from a Teams conversation (ICAO Annex 19 / MSM: describe the change, its reason, who asks for it, when it starts; the hazards are identified afterwards in the assessment). Entities: ${entities.join(", ")}. Domains: ${DOMAINS.join(" | ")}. Categories: ${Object.entries(MOC_CATEGORIES).map(([k, v]) => `${k}=${v}`).join(", ")}. change_type: permanent | temporary. Facts only, in the language of the conversation; never invent dates or names — list what is missing. Answer ONLY JSON {"entity":"…","name":"one line naming the change","description":"what changes, scope","domain":"…","category":"key","change_type":"permanent|temporary","start_date":"YYYY-MM-DD or empty","reason":"why","requestor":"who asks (post or name) or empty","missing":["…"]}`,
    user: `Instruction: ${instruction || "(none — a MOC from this conversation)"}\n\nConversation:\n${transcript}` });
  const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as Partial<MocDraft>;
  const str = (v: unknown, n = 1500) => (typeof v === "string" ? v.slice(0, n) : "");
  return { entity: entities.includes(str(j.entity)) ? str(j.entity) : entities[0] ?? "", name: str(j.name, 200), description: str(j.description), domain: DOMAINS.includes(str(j.domain)) ? str(j.domain) : "", category: MOC_CATEGORIES[str(j.category, 20)] ? str(j.category, 20) : "other", change_type: str(j.change_type, 10) === "temporary" ? "temporary" : "permanent", start_date: /^\d{4}-\d{2}-\d{2}$/.test(str(j.start_date)) ? str(j.start_date) : "", reason: str(j.reason), requestor: str(j.requestor, 120), missing: Array.isArray(j.missing) ? j.missing.map(String).slice(0, 6) : [] };
}
export function mocCard(d: MocDraft, entities: string[], ref: ThreadRef, by: string): unknown {
  const body: unknown[] = [
    { type: "TextBlock", text: "S.A.M. · Management of change — draft", size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: `Drafted from this conversation for ${by}. The MOC opens at the “assessment” step for the SM; hazards and decision follow in S.A.M.`, wrap: true, isSubtle: true },
    { type: "Input.ChoiceSet", id: "entity", label: "Entity", value: d.entity, choices: entities.map((e) => ({ title: e, value: e })), style: "compact" },
    { type: "Input.Text", id: "name", label: "Change (one line)", value: d.name, maxLength: 200 },
    { type: "Input.Text", id: "description", label: "What changes", value: d.description, isMultiline: true, maxLength: 1500 },
    { type: "ColumnSet", columns: [
      { type: "Column", width: "stretch", items: [{ type: "Input.ChoiceSet", id: "domain", label: "Domain", value: d.domain || undefined, choices: DOMAINS.map((x) => ({ title: x, value: x })), style: "compact" }] },
      { type: "Column", width: "stretch", items: [{ type: "Input.ChoiceSet", id: "category", label: "Category", value: d.category, choices: Object.entries(MOC_CATEGORIES).map(([k, v]) => ({ title: v, value: k })), style: "compact" }] },
    ] },
    { type: "ColumnSet", columns: [
      { type: "Column", width: "stretch", items: [{ type: "Input.ChoiceSet", id: "change_type", label: "Permanent / temporary", value: d.change_type, choices: [{ title: "permanent", value: "permanent" }, { title: "temporary", value: "temporary" }], style: "compact" }] },
      { type: "Column", width: "stretch", items: [{ type: "Input.Date", id: "start_date", label: "Starts on", value: d.start_date || undefined }] },
    ] },
    { type: "Input.Text", id: "reason", label: "Why", value: d.reason, isMultiline: true, maxLength: 1500 },
    { type: "Input.Text", id: "requestor", label: "Requested by", value: d.requestor, maxLength: 120 },
  ];
  if (d.missing.length) body.push({ type: "TextBlock", text: `Still missing: ${d.missing.join(", ")}.`, wrap: true, color: "Attention", spacing: "Small" });
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, actions: [
    { type: "Action.Execute", title: "Open the MOC in S.A.M.", verb: "moc_create", style: "positive", data: { ref } },
    { type: "Action.Execute", title: "Discard", verb: "report_discard", data: {} }], msteams: { width: "Full" } };
}
export async function createMocFromCard(db: SupabaseClient, person: { id: string; display_name: string; entities: string[] }, data: Record<string, unknown>): Promise<{ ok: true; id: string; number: string; name: string } | { ok: false; error: string }> {
  const g = (k: string, n = 1500) => (typeof data[k] === "string" ? (data[k] as string).trim().slice(0, n) : "");
  const entity = g("entity", 3);
  if (!person.entities.includes(entity)) return { ok: false, error: "Entity outside your scope." };
  try {
    const r = await createMoc(db, { personId: person.id, name: person.display_name }, { entity, name: g("name", 200), description: g("description") || null, domain: g("domain", 40) || null, category: g("category", 20) || null, change_type: g("change_type", 10) || null, start_date: g("start_date", 10) || null, reason: g("reason") || null, requestor: g("requestor", 120) || null }, "teams");
    return { ok: true, id: r.id, number: r.number, name: g("name", 200) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Not created" }; }
}
/** Generic "created" card for an authority file or a MOC. */
export function openedCard(kind: "Authority file" | "Management of change", title: string, by: string, link: string): unknown {
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body: [
    { type: "TextBlock", text: `S.A.M. · ${kind}`, size: "Small", weight: "Bolder", color: "Accent", spacing: "None" },
    { type: "TextBlock", text: title, size: "Medium", weight: "Bolder", wrap: true },
    { type: "TextBlock", text: `Opened by ${by} from the conversation. Continue in S.A.M.`, wrap: true },
  ], actions: [{ type: "Action.OpenUrl", title: "Open in S.A.M.", url: `${origin()}${link}` }], msteams: { width: "Full" } };
}
