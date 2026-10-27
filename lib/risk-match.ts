// Safety › Risk register: SAM (AI) matching against the hazard log — a study hazard (MOC / RA) or a safety report → the log hazards it is about,
// and log hazards that look like duplicates of each other. Suggestions only: the safety desk links, keeps local or adds to the log.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";

export type Suggestion = { id: string; ref: string; title: string; score: number; why: string };
export type LogHazard = { id: string; ref: string; title: string; consequence: string | null; domain: string | null; number: string };
type Subject = { key: string; title: string; consequence?: string | null; context?: string | null };

/** Live hazards of the hazard log of an entity (hazards of a 'hazard_log' assessment that is not archived / cancelled). */
export async function logHazards(entity: string): Promise<LogHazard[]> {
  const { data } = await supabaseAdmin().from("hazards").select("id,ref,title,consequence,risk_assessments!inner(kind,status,domain,number)").eq("entity", entity).eq("proposed", false).neq("status", "closed").eq("risk_assessments.kind", "hazard_log").not("risk_assessments.status", "in", "(archived,cancelled)");
  return ((data ?? []) as unknown as { id: string; ref: string; title: string; consequence: string | null; risk_assessments: { domain: string | null; number: string } }[])
    .map((h) => ({ id: h.id, ref: h.ref, title: h.title, consequence: h.consequence, domain: h.risk_assessments?.domain ?? null, number: h.risk_assessments?.number ?? "" }));
}

/** One Claude call per batch of 25 subjects; returns up to 3 log hazards per subject (score 0–1), the subject itself excluded. */
export async function matchToLog(entity: string, subjects: Subject[], personId: string | null, log?: LogHazard[], mode: "match" | "duplicate" = "match"): Promise<Record<string, Suggestion[]>> {
  const lg = log ?? await logHazards(entity);
  const out: Record<string, Suggestion[]> = {};
  if (!lg.length || !subjects.length) return out;
  const byRef = new Map(lg.map((h) => [h.ref, h]));
  const catalogue = lg.map((h) => ({ ref: h.ref, hazard: h.title, consequence: h.consequence ?? undefined, domain: h.domain ?? undefined }));
  const batches: Subject[][] = []; for (let i = 0; i < subjects.length; i += 25) batches.push(subjects.slice(i, i + 25));
  const runOne = async (batch: Subject[]) => {
    const { text } = await callClaude({ agent: "safety", personId, entity, maxTokens: 3000,
      system: `You maintain the hazard log of an EASA organisation (${entity}). The hazard log lists each lasting hazard once (hazard → consequence). ` +
        (mode === "duplicate"
          ? "For each subject (itself a hazard of the log), list the OTHER hazards of the log that describe the same hazard in the same operational context and should be merged with it. Do not list related-but-different hazards."
          : "For each subject (a hazard written in a management of change, a one-off risk assessment, or a safety report), list the hazards of the log it is about: same hazard, same operational context — the log hazard whose rating it should update. Do not match on a shared generic word only (e.g. 'fatigue' in crew rostering vs. in maintenance).") +
        ` Score 0–1 (0.8+ = clearly the same, 0.5–0.8 = probably). At most 3 per subject, best first; none if nothing fits. Plain English, reason in under 15 words. Answer ONLY JSON: {"m":[{"k":"subject key","r":[{"ref":"log ref","s":0.9,"why":"…"}]}]}`,
      user: JSON.stringify({ log: catalogue, subjects: batch.map((b) => ({ k: b.key, hazard: b.title, consequence: b.consequence ?? undefined, context: b.context ?? undefined })) }) });
    const j = /\{[\s\S]*\}/.exec(text); if (!j) return;
    let parsed: { m?: { k: string; r?: { ref: string; s?: number; why?: string }[] }[] } = {};
    try { parsed = JSON.parse(j[0]); } catch { return; }
    for (const m of parsed.m ?? []) {
      const subj = batch.find((b) => b.key === m.k); if (!subj) continue;
      out[m.k] = (m.r ?? []).map((r) => ({ h: byRef.get(r.ref), s: Math.max(0, Math.min(1, Number(r.s) || 0)), why: String(r.why ?? "").slice(0, 160) }))
        .filter((x) => x.h && x.h.id !== subj.key && x.s >= 0.5).slice(0, 3)
        .map((x) => ({ id: x.h!.id, ref: x.h!.ref, title: x.h!.title, score: Math.round(x.s * 100) / 100, why: x.why }));
    }
  };
  const queue = [...batches]; // 4 calls at a time: a big log (Centrik) stays within the page time limit
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { try { await runOne(queue.shift()!); } catch { /* next batch */ } } }));
  return out;
}

/** Study hazards (MOC / RA) of an entity not linked to the log, not kept local, without suggestions yet (or all with force) → stored in risk_matches. */
export async function matchPending(entity: string, personId: string | null, opts: { force?: boolean; hazardIds?: string[]; limit?: number } = {}): Promise<number> {
  const db = supabaseAdmin();
  let q = db.from("hazards").select("id,title,consequence,risk_assessments!inner(kind,number,name)").eq("entity", entity).eq("proposed", false).eq("local_only", false).is("log_hazard_id", null).neq("status", "closed").in("risk_assessments.kind", ["moc", "ra"]);
  if (opts.hazardIds?.length) q = q.in("id", opts.hazardIds);
  const { data } = await q;
  let rows = (data ?? []) as unknown as { id: string; title: string; consequence: string | null; risk_assessments: { kind: string; number: string; name: string } }[];
  if (!opts.force && !opts.hazardIds?.length) {
    // already checked = checked after the latest change of the log (an import adds or rewrites log hazards: earlier checks are stale)
    const { data: last } = await db.from("hazards").select("updated_at,risk_assessments!inner(kind)").eq("entity", entity).eq("risk_assessments.kind", "hazard_log").order("updated_at", { ascending: false }).limit(1);
    const since = ((last ?? []) as { updated_at: string }[])[0]?.updated_at ?? "1970-01-01"; // newest change in the log (import, edit)
    const seenIds = new Set<string>();
    for (let i = 0; i < rows.length; i += 300) { const { data: done } = await db.from("risk_matches").select("subject_id").eq("subject_kind", "hazard").gte("ran_at", since).in("subject_id", rows.slice(i, i + 300).map((r) => r.id)); for (const d of (done ?? []) as { subject_id: string }[]) seenIds.add(d.subject_id); }
    rows = rows.filter((r) => !seenIds.has(r.id));
  }
  rows = rows.slice(0, opts.limit ?? 150);
  if (!rows.length) return 0;
  const res = await matchToLog(entity, rows.map((r) => ({ key: r.id, title: r.title, consequence: r.consequence, context: `${r.risk_assessments.number} ${r.risk_assessments.name}` })), personId);
  const now = new Date().toISOString();
  await db.from("risk_matches").upsert(rows.map((r) => ({ subject_kind: "hazard", subject_id: r.id, entity, suggestions: res[r.id] ?? [], ran_at: now })));
  return rows.length;
}

/** Safety report → log hazards (run after the report analysis). */
export async function matchReport(report: { id: string; entity: string; headline: string; narrative?: string | null; primary_hazard?: string | null }, personId: string | null): Promise<Suggestion[]> {
  const res = await matchToLog(report.entity, [{ key: report.id, title: report.primary_hazard ?? report.headline, consequence: null, context: `${report.headline}. ${(report.narrative ?? "").slice(0, 1200)}` }], personId);
  const sug = res[report.id] ?? [];
  await supabaseAdmin().from("risk_matches").upsert({ subject_kind: "report", subject_id: report.id, entity: report.entity, suggestions: sug, ran_at: new Date().toISOString() });
  return sug;
}

/** Possible duplicates inside the hazard log (useful after importing Centrik + Monday / Excel). */
export async function findDuplicates(entity: string, personId: string | null): Promise<number> {
  const lg = await logHazards(entity);
  const res = await matchToLog(entity, lg.map((h) => ({ key: h.id, title: h.title, consequence: h.consequence, context: h.domain })), personId, lg, "duplicate");
  const db = supabaseAdmin(); const now = new Date().toISOString();
  await db.from("risk_matches").delete().eq("subject_kind", "duplicate").eq("entity", entity);
  const rows = lg.filter((h) => res[h.id]?.length).map((h) => ({ subject_kind: "duplicate", subject_id: h.id, entity, suggestions: res[h.id], ran_at: now }));
  if (rows.length) await db.from("risk_matches").insert(rows);
  return rows.length;
}
