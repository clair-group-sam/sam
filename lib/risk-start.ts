// Safety › new RA / MOC: start from a template or from a similar past study ("most used" first), answer a few factual questions,
// SAM adapts the base to the case. Everything SAM brings arrives "proposed" and must be kept hazard by hazard (nothing is signed by itself).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { KINDS, schemeOf } from "@/lib/risk-shared";

export type TplHazard = { title: string; consequence?: string | null; lik_before?: number | null; sev_before?: string | null; lik_after?: number | null; sev_after?: string | null; existing?: string[]; mitigations?: { text: string; owner_role?: string | null }[]; log_hazard_id?: string | null };
export type Question = { id: string; label: string; hint?: string };
export type Template = { id: string; entity: string | null; kind: string; name: string; category: string | null; domain: string | null; description: string | null; questions: Question[]; hazards: TplHazard[]; source_ids: string[]; status: string; uses: number };
export type Base = { kind: "template" | "study"; id: string; label: string };
export type Similar = { id: string; number: string; name: string; conducted_on: string | null; status: string; hazards: number; uses: number; score: number };

const STOP = new Set("the and for with from flight flights risk assessment management change new of to on in a an at by de du la le des".split(" "));
const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)));

/** Past studies of the same kind and entity, closest first (word overlap on name + description), "most used" as a tie-breaker. */
export async function similarStudies(entity: string, kind: string, text: string, exclude?: string): Promise<Similar[]> {
  const db = supabaseAdmin();
  const { data } = await db.from("risk_assessments").select("id,number,name,description,conducted_on,status,based_on_id,hazards(id)").eq("entity", entity).eq("kind", kind).in("status", ["accepted", "validated", "archived"]).limit(600);
  const rows = (data ?? []) as { id: string; number: string; name: string; description: string | null; conducted_on: string | null; status: string; based_on_id: string | null; hazards: { id: string }[] }[];
  const uses = new Map<string, number>(); for (const r of rows) if (r.based_on_id) uses.set(r.based_on_id, (uses.get(r.based_on_id) ?? 0) + 1);
  const q = words(text);
  return rows.filter((r) => r.id !== exclude && r.hazards.length).map((r) => {
    const w = words(`${r.name} ${(r.description ?? "").slice(0, 400)}`); let inter = 0; for (const x of q) if (w.has(x)) inter++;
    const score = q.size ? inter / Math.sqrt(q.size * Math.max(1, w.size)) : 0;
    return { id: r.id, number: r.number, name: r.name, conducted_on: r.conducted_on, status: r.status, hazards: r.hazards.length, uses: uses.get(r.id) ?? 0, score: score + Math.log1p(uses.get(r.id) ?? 0) * 0.05 };
  }).filter((r) => r.score > 0.08).sort((a, b) => b.score - a.score || (b.conducted_on ?? "").localeCompare(a.conducted_on ?? "")).slice(0, 5);
}

/** Active templates for the entity (and group templates), most used first. */
export async function templatesFor(entity: string, kind: string): Promise<Template[]> {
  const { data } = await supabaseAdmin().from("risk_templates").select("*").eq("kind", kind).eq("status", "active").or(`entity.eq.${entity},entity.is.null`).order("uses", { ascending: false }).limit(30);
  return (data ?? []) as Template[];
}

/** The hazards of a base, as template hazards. */
export async function baseHazards(base: Base): Promise<TplHazard[]> {
  const db = supabaseAdmin();
  if (base.kind === "template") { const { data } = await db.from("risk_templates").select("hazards").eq("id", base.id).single(); return ((data as { hazards: TplHazard[] } | null)?.hazards ?? []); }
  const { data } = await db.from("hazards").select("title,consequence,lik_before,sev_before,lik_after,sev_after,log_hazard_id,hazard_mitigations(text,existing,owner_role)").eq("assessment_id", base.id).eq("proposed", false).neq("status", "closed").order("created_at");
  return ((data ?? []) as unknown as (TplHazard & { hazard_mitigations: { text: string; existing: boolean; owner_role: string | null }[] })[]).map((h) => ({
    title: h.title, consequence: h.consequence, lik_before: h.lik_before, sev_before: h.sev_before, lik_after: h.lik_after, sev_after: h.sev_after, log_hazard_id: h.log_hazard_id ?? null,
    existing: h.hazard_mitigations.filter((m) => m.existing).map((m) => m.text), mitigations: h.hazard_mitigations.filter((m) => !m.existing).map((m) => ({ text: m.text, owner_role: m.owner_role })) }));
}

const json = (text: string) => { const j = /\{[\s\S]*\}/.exec(text); if (!j) throw new Error("SAM did not answer."); return JSON.parse(j[0]); };

/** 3 to 6 short factual questions about what differs from the base (the template's own questions first). */
export async function questionsFor(c: { entity: string; kind: string; name: string; description: string | null }, base: Base, tplQuestions: Question[], hz: TplHazard[], personId: string | null): Promise<Question[]> {
  const { text } = await callClaude({ agent: "safety", personId, entity: c.entity, maxTokens: 1500,
    system: `You help the Safety Manager of an EASA organisation (${c.entity}) start a ${KINDS[c.kind]} from a previous one ("${base.label}"). Ask 3 to 6 SHORT FACTUAL questions whose answers tell what is different this time (dates, aerodromes, aircraft / registration, crew experience, authority advice, NOTAM / CZIB, handling, subcontractor, staff concerned, transition period…), so the hazards and ratings of the base can be adapted. Never ask about blame or opinions; a short answer must be enough; skip what the case title already says. Keep the template questions given (reword only if unclear). Plain English. Answer ONLY JSON: {"q":[{"label":"…","hint":"example answer"}]}`,
    user: JSON.stringify({ case: { title: c.name, description: c.description }, template_questions: tplQuestions.map((q) => q.label), base_hazards: hz.map((h) => h.title).slice(0, 30) }) });
  const q = ((json(text).q ?? []) as { label: string; hint?: string }[]).filter((x) => x?.label).slice(0, 6);
  return q.map((x, i) => ({ id: `q${i + 1}`, label: String(x.label).slice(0, 200), hint: x.hint ? String(x.hint).slice(0, 120) : undefined }));
}

export type Built = { hazards: (TplHazard & { from: number | null; note: string })[]; dropped: { from: number; why: string }[]; moc: Record<string, string> };
/** SAM adapts the base hazards to the case and the answers: keeps, re-rates, drops, adds — and says what changed. */
export async function adaptBase(c: { entity: string; kind: string; name: string; description: string | null }, base: Base, hz: TplHazard[], answers: { q: string; a: string }[], personId: string | null): Promise<Built> {
  const sch = schemeOf(c.entity);
  const { text } = await callClaude({ agent: "safety", personId, entity: c.entity, maxTokens: 6000,
    system: `You help the Safety Manager of an EASA organisation (${c.entity}) prepare a ${KINDS[c.kind]} from a previous one ("${base.label}") with the hazard–consequence method of its MSM (severity A Catastrophic … E Negligible; likelihood 5 Frequent … 1 Extremely improbable; reasonably worst case${sch === "centrik" ? "; scores: green 1–10, yellow 20–100, red 300–2500" : "; ICAO tolerability table"}).
Adapt the base to THIS case using only the case title / description and the answers: keep the base hazards that still apply (give their index in "from"), re-rate them if an answer changes the exposure, remove those that do not apply (list them in "dropped" with the reason), add the hazards the answers reveal (from = null). Current mitigations: only those of the base still true or stated in the answers — never invent a barrier. Planned mitigations: with the post that owns them (AM, NPFO, NPCT, NPGO, NPCA, CMM, SM, HT, CFI…). "note": in under 20 words, what differs from the base for that hazard (empty if identical). An unknown answer ("I don't know") = keep the base value and say "to confirm" in the note.${c.kind === "moc" ? ` Also propose, from the answers only, the MOC fields that are still empty: reason, affected (regulations, domains, services), criticality, prior_assessments, actions_in_place — omit what you cannot support.` : ""} Plain English, no markdown. Answer ONLY JSON: {"hazards":[{"from":0,"title":"…","consequence":"…","lik_before":3,"sev_before":"C","existing":["…"],"mitigations":[{"text":"…","owner_role":"SM"}],"lik_after":2,"sev_after":"C","note":"…"}],"dropped":[{"from":3,"why":"…"}]${c.kind === "moc" ? `,"moc":{"reason":"…"}` : ""}}`,
    user: JSON.stringify({ case: { title: c.name, description: c.description }, answers, base_hazards: hz.map((h, i) => ({ i, title: h.title, consequence: h.consequence, pre: `${h.lik_before ?? "?"}${h.sev_before ?? "?"}`, post: `${h.lik_after ?? "?"}${h.sev_after ?? "?"}`, current: h.existing, planned: h.mitigations?.map((m) => `${m.text} (${m.owner_role ?? "?"})`) })) }) });
  const j = json(text) as { hazards?: (TplHazard & { from?: number | null; note?: string })[]; dropped?: { from: number; why: string }[]; moc?: Record<string, string> };
  const okL = (x?: number | null) => (x && x >= 1 && x <= 5 ? Math.round(x) : null); const okS = (x?: string | null) => (x && /^[A-E]$/.test(x) ? x : null);
  return {
    hazards: (j.hazards ?? []).filter((h) => h?.title).slice(0, 25).map((h) => ({ ...h, from: Number.isInteger(h.from) && hz[h.from as number] ? (h.from as number) : null, title: String(h.title).slice(0, 200), lik_before: okL(h.lik_before), sev_before: okS(h.sev_before), lik_after: okL(h.lik_after), sev_after: okS(h.sev_after), note: String(h.note ?? "").slice(0, 200) })),
    dropped: (j.dropped ?? []).filter((d) => Number.isInteger(d?.from) && hz[d.from]).slice(0, 25),
    moc: Object.fromEntries(Object.entries(j.moc ?? {}).filter(([k, v]) => ["reason", "affected", "criticality", "prior_assessments", "actions_in_place"].includes(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).slice(0, 2000)])),
  };
}

/** Recurring kinds of study in the history (e.g. CZIB flight, ferry flight, LIFUS waiver, change of NP) → proposed templates with their questions. */
export async function clusterHistory(entity: string, kind: string, personId: string | null): Promise<{ name: string; category?: string; members: string[]; questions: string[] }[]> {
  const { data } = await supabaseAdmin().from("risk_assessments").select("id,number,name,category,conducted_on").eq("entity", entity).eq("kind", kind).in("status", ["accepted", "validated", "archived"]).order("conducted_on", { ascending: false }).limit(250);
  const rows = (data ?? []) as { id: string; number: string; name: string; category: string | null }[];
  if (rows.length < 2) return [];
  const { text } = await callClaude({ agent: "safety", personId, entity, maxTokens: 4000,
    system: `You look at the past ${KINDS[kind]}s of an EASA organisation (${entity}) and find the RECURRING kinds of study (at least 2 studies each), e.g. "Flight to / over a conflict zone (CZIB)", "Ferry flight", "LIFUS reduction / waiver", "Change of nominated person", "New subcontractor". One-off subjects are ignored. For each kind: a short template name, the studies that belong to it (their numbers), and 3 to 6 short factual questions to ask next time so the previous study can be adapted (dates, place, aircraft, people, authority advice…). Plain English. Answer ONLY JSON: {"t":[{"name":"…","category":"…","members":["RA 12","RA 25"],"questions":["…"]}]}`,
    user: JSON.stringify(rows.map((r) => ({ number: r.number, title: r.name, category: r.category ?? undefined }))) });
  const nums = new Set(rows.map((r) => r.number));
  return ((json(text).t ?? []) as { name: string; category?: string; members?: string[]; questions?: string[] }[])
    .map((t) => ({ name: String(t.name ?? "").slice(0, 120), category: t.category, members: (t.members ?? []).filter((m) => nums.has(m)), questions: (t.questions ?? []).map(String).slice(0, 6) }))
    .filter((t) => t.name && t.members.length >= 2).slice(0, 15);
}
