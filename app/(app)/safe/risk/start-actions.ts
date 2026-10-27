"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addMonths, mayEditRisk, nextHazardRef } from "@/lib/risk";
import { adaptBase, baseHazards, clusterHistory, questionsFor, type Base, type Question, type TplHazard } from "@/lib/risk-start";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
async function who(entity?: string): Promise<Session> {
  const s = await getSession();
  if (!s || !mayEditRisk(s)) throw new Error("Reserved to the Safety Manager, Compliance, the AM and the nominated persons.");
  if (entity && !s.entities.includes(entity)) throw new Error("Entity outside your scope.");
  return s;
}
type R = { id: string; entity: string; kind: string; number: string; name: string; description: string | null; status: string; participants: { name: string; role: string }[]; prefill: { base?: Base; questions?: Question[]; applied?: boolean; blank?: boolean } | null; reason: string | null; affected: string | null; criticality: string | null; prior_assessments: string | null; actions_in_place: string | null };
async function raOf(id: string): Promise<R> {
  const { data } = await db().from("risk_assessments").select("id,entity,kind,number,name,description,status,participants,prefill,reason,affected,criticality,prior_assessments,actions_in_place").eq("id", id).single();
  if (!data) throw new Error("Risk assessment not found.");
  return data as R;
}
const log = (x: { assessment_id: string; kind: string; actor: string | null; note: string }) => db().from("risk_events").insert(x);
const touch = (id: string) => { revalidatePath(`/safe/risk/a/${id}`); revalidatePath("/safe/ra"); revalidatePath("/safe/moc"); revalidatePath("/safe/risk/templates"); };

/** Step 1 — choose what to start from: a template, a similar past study, or blank. SAM then asks its questions. */
export async function chooseBase(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  if (ra.status !== "draft") throw new Error("Only a draft can be started from a base.");
  const kind = str(fd, "base_kind");
  if (kind === "blank") { await db().from("risk_assessments").update({ prefill: { blank: true, applied: true } }).eq("id", ra.id); await log({ assessment_id: ra.id, kind: "started", actor: s.person?.id ?? null, note: "Started blank" }); return touch(ra.id); }
  const baseId = str(fd, "base_id"); if (!baseId || !["template", "study"].includes(kind ?? "")) return;
  let label = "", tplQ: Question[] = [];
  if (kind === "template") { const { data } = await db().from("risk_templates").select("name,questions").eq("id", baseId).single(); const t = data as { name: string; questions: Question[] }; label = `template “${t.name}”`; tplQ = t.questions ?? []; }
  else { const { data } = await db().from("risk_assessments").select("number,name,version,entity").eq("id", baseId).single(); const b = data as { number: string; name: string; version: number; entity: string }; if (b.entity !== ra.entity) throw new Error("The base belongs to another entity."); label = `${b.number} v${b.version} — ${b.name}`; }
  const base: Base = { kind: kind as Base["kind"], id: baseId, label };
  const hz = await baseHazards(base);
  const questions = await questionsFor(ra, base, tplQ, hz, s.person?.id ?? null);
  await db().from("risk_assessments").update({ prefill: { base, questions, applied: false } }).eq("id", ra.id);
  touch(ra.id);
}
export async function resetBase(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); await who(ra.entity);
  if (ra.prefill?.applied) return;
  await db().from("risk_assessments").update({ prefill: null }).eq("id", ra.id); touch(ra.id);
}

/** Step 2 — the answers: SAM adapts the base; every hazard arrives "proposed" with what changed, participants and empty MOC fields filled from the base / answers. */
export async function applyBase(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  const p = ra.prefill; if (!p?.base || p.applied) return;
  const answers = (p.questions ?? []).map((q) => ({ q: q.label, a: str(fd, q.id) ?? (fd.get(`${q.id}_dk`) ? "I don't know" : "") })).filter((x) => x.a);
  const hz = await baseHazards(p.base);
  const built = await adaptBase(ra, p.base, hz, answers, s.person?.id ?? null);
  for (const h of built.hazards) {
    const src = h.from !== null ? hz[h.from] : null;
    const ref = await nextHazardRef(db(), ra.entity);
    const { data: nh } = await db().from("hazards").insert({ entity: ra.entity, ref, title: h.title, consequence: h.consequence ?? null, source: ra.kind === "moc" ? "moc" : "other", assessment_id: ra.id, proposed: true,
      lik_before: h.lik_before, sev_before: h.sev_before, lik_after: h.lik_after, sev_after: h.sev_after, review_date: addMonths(12), created_by: s.person?.id ?? null,
      log_hazard_id: src?.log_hazard_id ?? null, prefill_note: h.note || (src ? "as in the base" : "new for this case") }).select("id").single();
    const hid = (nh as { id: string } | null)?.id; if (!hid) continue;
    const rows = [...(h.existing ?? []).filter(Boolean).map((t) => ({ hazard_id: hid, text: t, existing: true })), ...(h.mitigations ?? []).filter((m) => m?.text).map((m) => ({ hazard_id: hid, text: m.text, existing: false, owner_role: m.owner_role ?? null }))];
    if (rows.length) await db().from("hazard_mitigations").insert(rows);
  }
  const patch: Record<string, unknown> = { prefill: { ...p, applied: true, answers }, updated_at: new Date().toISOString() };
  if (p.base.kind === "study") patch.based_on_id = p.base.id; else patch.template_id = p.base.id;
  if (!(ra.participants ?? []).length && p.base.kind === "study") { const { data } = await db().from("risk_assessments").select("participants").eq("id", p.base.id).single(); patch.participants = (data as { participants: unknown[] } | null)?.participants ?? []; }
  for (const [k, v] of Object.entries(built.moc)) if (!(ra as unknown as Record<string, unknown>)[k]) patch[k] = v;
  await db().from("risk_assessments").update(patch).eq("id", ra.id);
  if (p.base.kind === "template") { const { data } = await db().from("risk_templates").select("uses").eq("id", p.base.id).single(); await db().from("risk_templates").update({ uses: ((data as { uses: number } | null)?.uses ?? 0) + 1 }).eq("id", p.base.id); }
  const dropped = built.dropped.map((d) => `“${hz[d.from].title}” (${d.why})`).join("; ");
  await log({ assessment_id: ra.id, kind: "started", actor: s.person?.id ?? null, note: `Based on ${p.base.label} — ${built.hazards.length} hazards proposed by SAM from ${answers.length} answers${dropped ? `; not kept from the base: ${dropped}` : ""}. Each hazard to be reviewed and kept for this case.` });
  touch(ra.id);
}

/** A signed study becomes a template (its hazards, ratings and mitigations; no questions yet — SAM asks its own). */
export async function saveAsTemplate(fd: FormData) {
  const ra = await raOf(String(fd.get("id"))); const s = await who(ra.entity);
  if (ra.kind === "hazard_log") throw new Error("Templates are for MOCs and risk assessments.");
  const hz = await baseHazards({ kind: "study", id: ra.id, label: ra.number });
  await db().from("risk_templates").insert({ entity: ra.entity, kind: ra.kind, name: str(fd, "name") ?? ra.name.replace(/^RA\s*-\s*/i, ""), hazards: hz, source_ids: [ra.id], status: "active", created_by: s.person?.id ?? null }).select("id").single();
  await log({ assessment_id: ra.id, kind: "template", actor: s.person?.id ?? null, note: `Saved as a template by ${s.name}` });
  touch(ra.id); redirect("/safe/risk/templates");
}

/** SAM groups the history into recurring kinds of study → proposed templates (hazards of the latest study of each kind + questions); the SM accepts or deletes them. */
export async function proposeTemplates(fd: FormData) {
  const entity = str(fd, "entity") ?? ""; const kind = str(fd, "kind") ?? "ra"; const s = await who(entity);
  const groups = await clusterHistory(entity, kind, s.person?.id ?? null);
  const { data: ex } = await db().from("risk_templates").select("name").eq("entity", entity).eq("kind", kind).neq("status", "retired");
  const have = new Set(((ex ?? []) as { name: string }[]).map((t) => t.name.toLowerCase()));
  for (const g of groups) {
    if (have.has(g.name.toLowerCase())) continue;
    const { data: mem } = await db().from("risk_assessments").select("id,number,conducted_on").eq("entity", entity).eq("kind", kind).in("number", g.members).order("conducted_on", { ascending: false });
    const ms = (mem ?? []) as { id: string; number: string }[]; if (!ms.length) continue;
    const hz: TplHazard[] = await baseHazards({ kind: "study", id: ms[0].id, label: ms[0].number });
    await db().from("risk_templates").insert({ entity, kind, name: g.name, category: g.category ?? null, description: `Built from ${ms.map((m) => m.number).join(", ")} (hazards of ${ms[0].number}, the latest).`, questions: g.questions.map((q, i) => ({ id: `t${i + 1}`, label: q })), hazards: hz, source_ids: ms.map((m) => m.id), status: "proposed", created_by: s.person?.id ?? null });
  }
  revalidatePath("/safe/risk/templates");
}
export async function setTemplateStatus(fd: FormData) {
  const id = String(fd.get("id")); const st = String(fd.get("status"));
  const { data } = await db().from("risk_templates").select("entity,status").eq("id", id).single(); const t = data as { entity: string | null; status: string };
  await who(t.entity ?? undefined);
  if (st === "delete") { if (t.status === "proposed") await db().from("risk_templates").delete().eq("id", id); }
  else if (["active", "retired"].includes(st)) await db().from("risk_templates").update({ status: st, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/safe/risk/templates");
}
export async function updateTemplate(fd: FormData) {
  const id = String(fd.get("id"));
  const { data } = await db().from("risk_templates").select("entity").eq("id", id).single(); await who((data as { entity: string | null }).entity ?? undefined);
  const qs = (str(fd, "questions") ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8).map((l, i) => ({ id: `t${i + 1}`, label: l }));
  await db().from("risk_templates").update({ name: str(fd, "name") ?? "Template", category: str(fd, "category"), questions: qs, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/safe/risk/templates");
}
