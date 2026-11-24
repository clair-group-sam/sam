// Server-side Claude calls (AI-01). The key lives in Vercel only; every call is logged in ai_usage.
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AiAgent = "draft" | "rewrite" | "translate" | "check" | "explain" | "summary" | "route" | "file" | "coffee" | "safety" | "ask" | "plan";
const HEADERS = (key: string) => ({ "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" });
let modelCache: { id: string; at: number } | null = null;
/** Lists the models available to the group's key (ids + display names). */
export async function listModels(): Promise<{ id: string; display_name?: string; created_at?: string }[]> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return [];
  const r = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: HEADERS(key) });
  const j = (await r.json()) as { data?: { id: string; display_name?: string; created_at?: string }[] };
  return j.data ?? [];
}
/** Writing model: AI_MODEL_WRITE if set, else the newest Sonnet available to the key (refreshed hourly). */
export async function writeModel(): Promise<string> {
  if (process.env.AI_MODEL_WRITE) return process.env.AI_MODEL_WRITE;
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.id;
  const models = await listModels();
  const pick = (re: RegExp) => models.filter((m) => re.test(m.id)).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0]?.id;
  const id = pick(/sonnet/i) ?? pick(/opus/i) ?? pick(/claude/i) ?? "claude-sonnet-4-5";
  modelCache = { id, at: Date.now() };
  return id;
}
let researchCache: { id: string; at: number } | null = null;
/** Research model (Plan with S.A.M.): AI_MODEL_RESEARCH if set, else the newest Opus available to the key, else the writing model. */
export async function researchModel(): Promise<string> {
  if (process.env.AI_MODEL_RESEARCH) return process.env.AI_MODEL_RESEARCH;
  if (researchCache && Date.now() - researchCache.at < 3_600_000) return researchCache.id;
  const id = (await listModels()).filter((m) => /opus/i.test(m.id)).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0]?.id ?? await writeModel();
  researchCache = { id, at: Date.now() };
  return id;
}
// €/M tokens, overridable from Vercel if pricing changes (Opus has its own rates)
const OPUS_IN = Number(process.env.AI_RATE_OPUS_IN_EUR ?? "4.7"), OPUS_OUT = Number(process.env.AI_RATE_OPUS_OUT_EUR ?? "23.5");
const IN_RATE = Number(process.env.AI_RATE_IN_EUR ?? "2.8"), OUT_RATE = Number(process.env.AI_RATE_OUT_EUR ?? "14");

const SYSTEM = `You are the technical writer of an aviation organisation's regulatory manuals (EASA Part-CAO / Part-CAMO / AOC / ATO). You help a nominated person revise ONE chapter of a manual.
Rules:
- Write in the language of the current chapter (some manuals are in French, most group manuals are in English; never mix), in the style of the manual (same tone, same way of naming the organisation and posts, same formatting habits). Keep the existing structure and numbering of sub-chapters.
- Change only what the request requires; keep everything else word for word. Never invent regulatory references: use only those present in the chapter or given in the request.
- Output HTML limited to: p, h2, h3, h4, ul, ol, li, table, thead, tbody, tr, th, td, strong, em, figure, img (keep existing img tags unchanged).
- Answer ONLY with a JSON object: {"html": "<full revised chapter html>", "notes": [{"where": "sub-chapter or sentence", "change": "what changed", "why": "reason / reference"}]} .`;

export async function callClaude(opts: { agent: AiAgent; personId: string | null; entity: string | null; system?: string; user: string; maxTokens?: number; attachments?: { type: "document" | "image"; mediaType: string; b64: string }[] }): Promise<{ text: string; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Vercel.");
  const db = supabaseAdmin();
  const MODEL = await writeModel();
  const body = { model: MODEL, max_tokens: opts.maxTokens ?? 8000, system: opts.system ?? SYSTEM, messages: [{ role: "user", content: opts.attachments?.length
    ? [...opts.attachments.map((a) => ({ type: a.type, source: { type: "base64", media_type: a.mediaType, data: a.b64 } })), { type: "text", text: opts.user }]
    : opts.user }] };
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: HEADERS(key), body: JSON.stringify(body) });
  const j = (await r.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number }; error?: { message: string } };
  const inT = j.usage?.input_tokens ?? 0, outT = j.usage?.output_tokens ?? 0;
  const cost = (inT * IN_RATE + outT * OUT_RATE) / 1_000_000;
  const ok = r.ok && !j.error;
  await db.from("ai_usage").insert({ person_id: opts.personId, entity: opts.entity, agent: opts.agent, model: MODEL, input_tokens: inT, output_tokens: outT, cost_eur: cost, ok, error: ok ? null : (j.error?.message ?? `HTTP ${r.status}`) });
  if (!ok) throw new Error(j.error?.message ?? `Claude API error ${r.status}`);
  const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, model: MODEL };
}

export type WebSource = { url: string; title: string };
const SEARCH_RATE = Number(process.env.AI_RATE_SEARCH_EUR ?? "0.0093"); // per web search (10 USD / 1000)
/** A Claude call that may search the web (Anthropic server tool, the searches run at Anthropic, not from S.A.M.).
 *  Returns the text and every page the searches returned. If web search is not enabled for the key, it answers without it and says so. */
export async function callClaudeResearch(opts: { agent: AiAgent; personId: string | null; entity: string | null; system: string; user: string; maxTokens?: number; web: boolean; maxSearches?: number }): Promise<{ text: string; model: string; sources: WebSource[]; searches: number; webNote: string | null }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Vercel.");
  const db = supabaseAdmin();
  const MODEL = await researchModel();
  const opus = /opus/i.test(MODEL); const inRate = opus ? OPUS_IN : IN_RATE, outRate = opus ? OPUS_OUT : OUT_RATE;
  type Block = { type: string; text?: string; content?: unknown };
  type Resp = { content?: Block[]; stop_reason?: string; usage?: { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests?: number } }; error?: { message: string } };
  const run = async (web: boolean) => {
    const messages: { role: string; content: unknown }[] = [{ role: "user", content: opts.user }];
    const blocks: Block[] = []; let inT = 0, outT = 0, searches = 0, err: string | null = null, ok = true;
    for (let turn = 0; turn < 3; turn++) { // a long search turn may pause: it is sent back as it is to be continued
      const body: Record<string, unknown> = { model: MODEL, max_tokens: opts.maxTokens ?? 8000, system: opts.system, messages };
      if (web) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: opts.maxSearches ?? 6 }];
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: HEADERS(key), body: JSON.stringify(body) });
      const j = (await r.json()) as Resp;
      inT += j.usage?.input_tokens ?? 0; outT += j.usage?.output_tokens ?? 0; searches += j.usage?.server_tool_use?.web_search_requests ?? 0;
      if (!r.ok || j.error) { ok = false; err = j.error?.message ?? `HTTP ${r.status}`; break; }
      blocks.push(...(j.content ?? []));
      if (j.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: j.content });
    }
    await db.from("ai_usage").insert({ person_id: opts.personId, entity: opts.entity, agent: opts.agent, model: MODEL, input_tokens: inT, output_tokens: outT, cost_eur: (inT * inRate + outT * outRate) / 1_000_000 + searches * SEARCH_RATE, ok, error: err });
    return { ok, err, blocks, searches };
  };
  let res = await run(opts.web); let webNote: string | null = null;
  if (!res.ok && opts.web && /web_search|tool|not enabled|not supported|permission/i.test(res.err ?? "")) { webNote = `Web search is not available for S.A.M.'s key (${(res.err ?? "").slice(0, 140)}): plan built from S.A.M. data and the model's knowledge only.`; res = await run(false); }
  if (!res.ok) throw new Error(res.err ?? "Claude API error");
  const sources: WebSource[] = []; const seen = new Set<string>();
  for (const b of res.blocks) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const x of b.content as { type?: string; url?: string; title?: string }[]) if (x.type === "web_search_result" && x.url && !seen.has(x.url)) { seen.add(x.url); sources.push({ url: x.url, title: x.title ?? x.url }); }
  const text = res.blocks.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, model: MODEL, sources, searches: res.searches, webNote };
}

export function parseJsonBlock(text: string, opts?: { allowEmptyHtml?: boolean }): { html: string; notes: { where: string; change: string; why: string }[] } {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error("The assistant did not return a proposal.");
  let j: { html?: string; notes?: { where: string; change: string; why: string }[] };
  try { j = JSON.parse(m[0]); }
  catch { throw new Error("SAM's answer was cut before the end (chapter too long for one pass). Ask again on a sub-chapter, or with a narrower request."); } // FB-069 · a truncated answer said "Expected ',' or ']' in JSON"
  if (!j.html && !opts?.allowEmptyHtml) throw new Error("Empty proposal.");
  return { html: j.html ?? "", notes: j.notes ?? [] };
}

export function userPromptFor(agent: AiAgent, ctx: { manual: string; entity: string; chapterRef: string; chapterTitle: string; chapterHtml: string; neighbours: string[]; request: string; officialTexts?: string }): string {
  // FB-050 · the official text of the rules cited (IR + AMC/GM, from the Easy Access Rules loaded in S.A.M.) goes with the chapter
  const head = `Manual: ${ctx.manual} (${ctx.entity}). Chapter ${ctx.chapterRef} — ${ctx.chapterTitle}. Other chapters of this manual (for consistency): ${ctx.neighbours.join(", ")}.\n\nCURRENT CHAPTER HTML:\n${ctx.chapterHtml}\n\n${ctx.officialTexts ? `OFFICIAL TEXT OF THE RULES CITED (EASA Easy Access Rules as loaded in S.A.M. — quote them, do not say the text was not supplied):\n${ctx.officialTexts}\n\n` : ""}`;
  switch (agent) {
    case "draft": return head + `REQUEST FROM THE NOMINATED PERSON (may be in another language than the manual; the chapter keeps its own language):\n${ctx.request}\n\nIntegrate this request into the chapter and return the full revised chapter.`;
    case "rewrite": return head + `Rewrite the passages the nominated person typed quickly so they read like the rest of the manual (style, terminology, formatting), without changing their meaning. ${ctx.request ? "Focus: " + ctx.request : ""} Return the full chapter.`;
    case "translate": return head + `Translate into the manual's language (${ctx.request.trim() || "the language of the rest of the chapter"}) every passage written in another language, in the manual's style; keep the other passages unchanged. Return the full chapter.`;
    case "check": return head + `Do not rewrite. Review this chapter for internal consistency (posts, references to other chapters, delays, contradictions, missing cross-references, terminology) ${ctx.request ? "with attention to: " + ctx.request : ""}. Do NOT return the chapter: answer {"html": "", "notes": [...]} with every finding in "notes" (where / change = the issue / why = suggestion), 12 findings at most, the most important first.`;
    case "explain": return head + `Do not rewrite. The nominated person asks what a requirement means for this chapter: "${ctx.request.trim() || "the regulatory references cited in this chapter"}". Explain, in plain professional English, what the requirement (EASA / national rule, AMC/GM) actually asks for, how this chapter answers it today and where it falls short or is silent. Do NOT return the chapter: answer {"html": "", "notes": [...]} with the explanation in the notes (12 notes at most): one note per point, where = the requirement or sub-chapter, change = what it requires, why = how the chapter stands against it. No invented references: cite only what the request or the chapter names.`;
    default: return head + ctx.request;
  }
}

const SUMMARY_SYSTEM = `You write the revision summary of an aviation organisation's manual for its readers (crews, instructors, staff): what changed in this revision, in plain English, so that they know what to read and what they must now do differently. 3 to 8 short bullet-like sentences, one per change, chapter reference first ("5.2 — …"). No marketing, no judgement, nothing invented: only what the differences show. Mention the reason only when the author gives it. Answer ONLY with JSON: {"summary":"text with line breaks"}.`;
/** Drafts the "What changed" summary of a revision from the chapters that changed (old vs new text). */
export async function draftSummary(opts: { personId: string | null; entity: string; manual: string; rev: string; reason?: string | null; changes: { ref: string; title: string; before: string; after: string }[] }): Promise<{ summary: string; model: string }> {
  const parts = opts.changes.slice(0, 25).map((c) => `CHAPTER ${c.ref} — ${c.title}\nBEFORE: ${c.before.slice(0, 2500) || "(new chapter)"}\nAFTER: ${c.after.slice(0, 2500) || "(chapter removed)"}`).join("\n\n");
  const user = `Manual: ${opts.manual} (${opts.entity}), revision ${opts.rev}.${opts.reason ? ` Reason given by the author: ${opts.reason}` : ""}\n\n${parts}`;
  const { text, model } = await callClaude({ agent: "summary", personId: opts.personId, entity: opts.entity, system: SUMMARY_SYSTEM, user, maxTokens: 1500 });
  const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error("No summary returned.");
  return { summary: String((JSON.parse(m[0]) as { summary?: string }).summary ?? "").trim(), model };
}
