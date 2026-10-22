// Server-side Claude calls (AI-01). The key lives in Vercel only; every call is logged in ai_usage.
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AiAgent = "draft" | "rewrite" | "translate" | "check" | "route";
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
// €/M tokens, overridable from Vercel if pricing changes
const IN_RATE = Number(process.env.AI_RATE_IN_EUR ?? "2.8"), OUT_RATE = Number(process.env.AI_RATE_OUT_EUR ?? "14");

const SYSTEM = `You are the technical writer of an aviation organisation's regulatory manuals (EASA Part-CAO / Part-CAMO / AOC / ATO). You help a nominated person revise ONE chapter of a manual.
Rules:
- Write in the language of the current chapter (some manuals are in French, most group manuals are in English; never mix), in the style of the manual (same tone, same way of naming the organisation and posts, same formatting habits). Keep the existing structure and numbering of sub-chapters.
- Change only what the request requires; keep everything else word for word. Never invent regulatory references: use only those present in the chapter or given in the request.
- Output HTML limited to: p, h2, h3, h4, ul, ol, li, table, thead, tbody, tr, th, td, strong, em, figure, img (keep existing img tags unchanged).
- Answer ONLY with a JSON object: {"html": "<full revised chapter html>", "notes": [{"where": "sub-chapter or sentence", "change": "what changed", "why": "reason / reference"}]} .`;

export async function callClaude(opts: { agent: AiAgent; personId: string | null; entity: string | null; system?: string; user: string; maxTokens?: number }): Promise<{ text: string; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Vercel.");
  const db = supabaseAdmin();
  const MODEL = await writeModel();
  const body = { model: MODEL, max_tokens: opts.maxTokens ?? 8000, system: opts.system ?? SYSTEM, messages: [{ role: "user", content: opts.user }] };
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

export function parseJsonBlock(text: string): { html: string; notes: { where: string; change: string; why: string }[] } {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error("The assistant did not return a proposal.");
  const j = JSON.parse(m[0]) as { html?: string; notes?: { where: string; change: string; why: string }[] };
  if (!j.html) throw new Error("Empty proposal.");
  return { html: j.html, notes: j.notes ?? [] };
}

export function userPromptFor(agent: AiAgent, ctx: { manual: string; entity: string; chapterRef: string; chapterTitle: string; chapterHtml: string; neighbours: string[]; request: string }): string {
  const head = `Manual: ${ctx.manual} (${ctx.entity}). Chapter ${ctx.chapterRef} — ${ctx.chapterTitle}. Other chapters of this manual (for consistency): ${ctx.neighbours.join(" · ")}.\n\nCURRENT CHAPTER HTML:\n${ctx.chapterHtml}\n\n`;
  switch (agent) {
    case "draft": return head + `REQUEST FROM THE NOMINATED PERSON (may be in another language than the manual; the chapter keeps its own language):\n${ctx.request}\n\nIntegrate this request into the chapter and return the full revised chapter.`;
    case "rewrite": return head + `Rewrite the passages the nominated person typed quickly so they read like the rest of the manual (style, terminology, formatting), without changing their meaning. ${ctx.request ? "Focus: " + ctx.request : ""} Return the full chapter.`;
    case "translate": return head + `Translate into the manual's language (${ctx.request.trim() || "the language of the rest of the chapter"}) every passage written in another language, in the manual's style; keep the other passages unchanged. Return the full chapter.`;
    case "check": return head + `Do not rewrite. Review this chapter for internal consistency (posts, references to other chapters, delays, contradictions, missing cross-references, terminology) ${ctx.request ? "with attention to: " + ctx.request : ""}. Return the chapter html UNCHANGED and put every finding in "notes" (where / change = the issue / why = suggestion).`;
    default: return head + ctx.request;
  }
}
