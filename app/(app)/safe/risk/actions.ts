"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { addMonths, mayApproveMoc, mayEditRisk, nextHazardRef, nextMocRef, tolerability } from "@/lib/risk";

const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
async function who(entity?: string) {
  const s = await getSession();
  if (!s || !mayEditRisk(s)) throw new Error("Reserved to the Safety Manager, Compliance, the AM and the nominated persons.");
  if (entity && !s.entities.includes(entity)) throw new Error("Entity outside your scope.");
  return s;
}
const db = () => supabaseAdmin();
const log = (x: { hazard_id?: string | null; moc_id?: string | null; kind: string; actor: string | null; note: string }) => db().from("risk_events").insert(x);
async function hazardOf(id: string) {
  const { data } = await db().from("hazards").select("id,entity,moc_id,proposed,report_id,ref,title").eq("id", id).maybeSingle();
  if (!data) throw new Error("Hazard not found.");
  return data as { id: string; entity: string; moc_id: string | null; proposed: boolean; report_id: string | null; ref: string; title: string };
}
const touch = (h: { id: string; moc_id: string | null }) => { revalidatePath(`/safe/risk/${h.id}`); revalidatePath("/safe/risk"); if (h.moc_id) revalidatePath(`/safe/moc/${h.moc_id}`); };

// ── Hazards ──────────────────────────────────────────────────────────────
export async function createHazard(fd: FormData) {
  const entity = str(fd, "entity") ?? ""; const s = await who(entity);
  const title = str(fd, "title"); if (!title) return;
  const moc = str(fd, "moc_id"); const report = str(fd, "report_id");
  const ref = await nextHazardRef(db(), entity);
  const { data, error } = await db().from("hazards").insert({ entity, ref, title, description: str(fd, "description"), consequence: str(fd, "consequence"), source: moc ? "moc" : report ? "report" : (str(fd, "source") ?? "other"), report_id: report, moc_id: moc, owner_role: str(fd, "owner_role"), review_date: addMonths(12), created_by: s.person?.id ?? null }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "not created");
  const id = (data as { id: string }).id;
  await log({ hazard_id: id, moc_id: moc, kind: "created", actor: s.person?.id ?? null, note: `${ref} created${report ? ` from safety report ${report}` : ""}` });
  if (report) await db().from("report_events").insert({ report_id: report, kind: "risk", actor: s.person?.id ?? null, note: `Added to the risk register as ${ref}` });
  revalidatePath("/safe/risk");
  if (moc && fd.get("stay")) { revalidatePath(`/safe/moc/${moc}`); return; }
  redirect(`/safe/risk/${id}`);
}

export async function updateHazard(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "description", "consequence", "owner_role", "review_date"]) if (fd.has(k)) patch[k] = str(fd, k);
  if (fd.has("status")) { const st = str(fd, "status"); if (st && ["open", "monitoring", "closed"].includes(st)) patch.status = st; }
  if (!patch.title && fd.has("title")) delete patch.title;
  await db().from("hazards").update({ ...patch, proposed: false }).eq("id", h.id);
  await log({ hazard_id: h.id, moc_id: h.moc_id, kind: "updated", actor: s.person?.id ?? null, note: fd.has("status") ? `Status: ${patch.status}` : "Details updated" });
  touch(h);
}

export async function setRating(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  const which = fd.get("which") === "after" ? "after" : "before"; const lik = Number(fd.get("lik")); const sev = String(fd.get("sev"));
  if (!(lik >= 1 && lik <= 5) || !"ABCDE".includes(sev) || sev.length !== 1) return;
  await db().from("hazards").update({ [`lik_${which}`]: lik, [`sev_${which}`]: sev, proposed: false, updated_at: new Date().toISOString() }).eq("id", h.id);
  await log({ hazard_id: h.id, moc_id: h.moc_id, kind: "rating", actor: s.person?.id ?? null, note: `${which === "before" ? "Initial" : "Residual"} risk set to ${lik}${sev} (${tolerability(lik, sev)})` });
  touch(h);
}

export async function keepHazard(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); const s = await who(h.entity);
  await db().from("hazards").update({ proposed: false }).eq("id", h.id);
  // the mitigations SAM proposed with an owner become Inbox items once a person keeps the hazard
  const { data: ms } = await db().from("hazard_mitigations").select("text,owner_role,due").eq("hazard_id", h.id).eq("existing", false).is("done_at", null).not("owner_role", "is", null);
  for (const x of (ms ?? []) as { text: string; owner_role: string; due: string | null }[])
    await db().from("tasks").insert({ entity: h.entity, kind: "mitigation", title: `Mitigation — ${x.text.slice(0, 120)}`, detail: `${h.ref} · ${h.title}`, due: x.due, owner_role: x.owner_role, status: "open", link: `/safe/risk/${h.id}`, ref_id: h.id });
  await log({ hazard_id: h.id, moc_id: h.moc_id, kind: "kept", actor: s.person?.id ?? null, note: "Proposed hazard kept" });
  touch(h);
}
/** Only a hazard proposed by SAM and not kept yet can be discarded; anything else is closed, never deleted. */
export async function discardHazard(fd: FormData) {
  const h = await hazardOf(String(fd.get("id"))); await who(h.entity);
  if (!h.proposed) return;
  await db().from("hazards").delete().eq("id", h.id);
  touch(h);
}

export async function addMitigation(fd: FormData) {
  const h = await hazardOf(String(fd.get("hazard_id"))); const s = await who(h.entity);
  const text = str(fd, "text"); if (!text) return;
  const existing = fd.get("existing") === "1"; const owner = str(fd, "owner_role"); const due = str(fd, "due");
  await db().from("hazard_mitigations").insert({ hazard_id: h.id, text, existing, owner_role: owner, due });
  if (!existing && owner) await db().from("tasks").insert({ entity: h.entity, kind: "mitigation", title: `Mitigation — ${text.slice(0, 120)}`, detail: `${h.ref} · ${h.title}`, due, owner_role: owner, status: "open", link: `/safe/risk/${h.id}`, ref_id: h.id });
  await log({ hazard_id: h.id, moc_id: h.moc_id, kind: "mitigation", actor: s.person?.id ?? null, note: `${existing ? "Existing barrier" : "Mitigation to put in place"}: ${text}${owner ? ` (${owner}${due ? `, by ${due}` : ""})` : ""}` });
  touch(h);
}
export async function doneMitigation(fd: FormData) {
  const id = String(fd.get("id"));
  const { data } = await db().from("hazard_mitigations").select("id,hazard_id,text").eq("id", id).maybeSingle();
  const m = data as { id: string; hazard_id: string; text: string } | null; if (!m) return;
  const h = await hazardOf(m.hazard_id); const s = await who(h.entity);
  await db().from("hazard_mitigations").update({ done_at: new Date().toISOString() }).eq("id", id);
  await db().from("tasks").update({ status: "done" }).eq("kind", "mitigation").eq("ref_id", h.id).eq("status", "open").like("title", `%${m.text.slice(0, 60).replace(/[%_]/g, "")}%`);
  await log({ hazard_id: h.id, moc_id: h.moc_id, kind: "mitigation_done", actor: s.person?.id ?? null, note: `In place: ${m.text}` });
  touch(h);
}

// ── Management of change ─────────────────────────────────────────────────
export async function createMoc(fd: FormData) {
  const entity = str(fd, "entity") ?? ""; const s = await who(entity);
  const title = str(fd, "title"); if (!title) return;
  const ref = await nextMocRef(db(), entity);
  const project = str(fd, "project_id"); const task = str(fd, "project_task_id");
  const { data, error } = await db().from("mocs").insert({ entity, ref, title, description: str(fd, "description"), category: str(fd, "category") ?? "other", owner_role: str(fd, "owner_role"), target_date: str(fd, "target_date"), project_id: project, project_task_id: task, authority_file_id: str(fd, "authority_file_id"), created_by: s.person?.id ?? null, status: "assessment" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "not created");
  const id = (data as { id: string }).id;
  if (task) await db().from("project_tasks").update({ link_kind: "moc", link_id: id, status: "in_progress", updated_at: new Date().toISOString() }).eq("id", task);
  await log({ moc_id: id, kind: "created", actor: s.person?.id ?? null, note: `${ref} opened — risk assessment to do` });
  revalidatePath("/safe/moc");
  if (project) revalidatePath(`/proj/boards/${project}`);
  redirect(`/safe/moc/${id}`);
}

export async function updateMoc(fd: FormData) {
  const id = String(fd.get("id"));
  const { data } = await db().from("mocs").select("entity").eq("id", id).maybeSingle(); if (!data) return;
  const s = await who((data as { entity: string }).entity);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "description", "category", "owner_role", "target_date"]) if (fd.has(k)) patch[k] = str(fd, k);
  if (!patch.title) delete patch.title;
  await db().from("mocs").update(patch).eq("id", id);
  await log({ moc_id: id, kind: "updated", actor: s.person?.id ?? null, note: "Details updated" });
  revalidatePath(`/safe/moc/${id}`);
}

/** MOC steps. Approval (SM) needs at least one hazard, all kept and rated after mitigation, none intolerable. */
export async function mocStep(fd: FormData) {
  const id = String(fd.get("id")); const to = String(fd.get("to"));
  const { data } = await db().from("mocs").select("id,entity,status,project_id,project_task_id,ref").eq("id", id).maybeSingle();
  const m = data as { id: string; entity: string; status: string; project_id: string | null; project_task_id: string | null; ref: string } | null; if (!m) return;
  const s = await who(m.entity);
  if (!["assessment", "approved", "implemented", "closed", "cancelled"].includes(to)) return;
  if (to === "approved") {
    if (!mayApproveMoc(s)) throw new Error("Only the Safety Manager approves a MOC.");
    const { data: hz } = await db().from("hazards").select("proposed,lik_after,sev_after").eq("moc_id", id);
    const hs = (hz ?? []) as { proposed: boolean; lik_after: number | null; sev_after: string | null }[];
    if (!hs.length || hs.some((h) => h.proposed || !h.lik_after || !h.sev_after || tolerability(h.lik_after, h.sev_after) === "intolerable")) throw new Error("Every hazard must be kept and rated after mitigation, and none may stay intolerable.");
  }
  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };
  if (to === "approved") { patch.approved_by = s.person?.id ?? null; patch.approved_at = new Date().toISOString(); patch.decision = str(fd, "decision"); }
  await db().from("mocs").update(patch).eq("id", id);
  await log({ moc_id: id, kind: "status", actor: s.person?.id ?? null, note: { assessment: "Back to risk assessment", approved: `Approved by the SM${patch.decision ? " — " + patch.decision : ""}`, implemented: "Change implemented", closed: "Closed", cancelled: "Cancelled" }[to]! });
  if (m.project_task_id && ["approved", "implemented", "closed"].includes(to)) await db().from("project_tasks").update({ status: "done", done_at: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq("id", m.project_task_id).neq("status", "done");
  revalidatePath(`/safe/moc/${id}`); revalidatePath("/safe/moc");
  if (m.project_id) revalidatePath(`/proj/boards/${m.project_id}`);
}

/** SAM proposes the hazards of a change, rated before / after with mitigations; each stays "proposed" until a person keeps it. */
export async function proposeHazards(fd: FormData) {
  const id = String(fd.get("id"));
  const { data } = await db().from("mocs").select("id,entity,title,description,category,ref").eq("id", id).maybeSingle();
  const m = data as { id: string; entity: string; title: string; description: string | null; category: string; ref: string } | null; if (!m) return;
  const s = await who(m.entity);
  const { data: ex } = await db().from("hazards").select("title").eq("moc_id", id);
  const { text } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity: m.entity, maxTokens: 3500,
    system: `You help the Safety Manager of an EASA operator write the risk assessment of a management of change (ORO.GEN.200(a)(3) / ORO.GEN.130). Use the ICAO matrix: severity A Catastrophic, B Hazardous, C Major, D Minor, E Negligible; likelihood 5 Frequent, 4 Occasional, 3 Remote, 2 Improbable, 1 Extremely improbable. Propose 3 to 6 hazards specific to this change (not generic), each with the worst credible consequence, the initial rating, existing barriers, mitigations to put in place with the post that owns them (AM, NPFO, NPCT, NPGO, NPCA, CMM, SM, CFI…), and the residual rating. Plain English, no markdown. Answer ONLY JSON: {"hazards":[{"title":"…","consequence":"…","lik_before":4,"sev_before":"C","existing":["…"],"mitigations":[{"text":"…","owner_role":"NPFO"}],"lik_after":2,"sev_after":"C"}]}`,
    user: JSON.stringify({ change: m.title, description: m.description, category: m.category, already_listed: ((ex ?? []) as { title: string }[]).map((x) => x.title) }) });
  const j = /\{[\s\S]*\}/.exec(text); if (!j) throw new Error("SAM did not return hazards.");
  type P = { title: string; consequence?: string; lik_before?: number; sev_before?: string; existing?: string[]; mitigations?: { text: string; owner_role?: string }[]; lik_after?: number; sev_after?: string };
  const list = ((JSON.parse(j[0]) as { hazards?: P[] }).hazards ?? []).slice(0, 6);
  const okL = (x?: number) => (x && x >= 1 && x <= 5 ? Math.round(x) : null); const okS = (x?: string) => (x && /^[A-E]$/.test(x) ? x : null);
  for (const p of list) {
    if (!p?.title) continue;
    const ref = await nextHazardRef(db(), m.entity);
    const { data: h } = await db().from("hazards").insert({ entity: m.entity, ref, title: p.title.slice(0, 200), consequence: p.consequence ?? null, source: "moc", moc_id: id, proposed: true, lik_before: okL(p.lik_before), sev_before: okS(p.sev_before), lik_after: okL(p.lik_after), sev_after: okS(p.sev_after), review_date: addMonths(12), created_by: s.person?.id ?? null }).select("id").single();
    const hid = (h as { id: string } | null)?.id; if (!hid) continue;
    const rows = [...(p.existing ?? []).map((t) => ({ hazard_id: hid, text: t, existing: true })), ...(p.mitigations ?? []).map((x) => ({ hazard_id: hid, text: x.text, existing: false, owner_role: x.owner_role ?? null }))].filter((r) => r.text);
    if (rows.length) await db().from("hazard_mitigations").insert(rows);
  }
  await log({ moc_id: id, kind: "proposal", actor: s.person?.id ?? null, note: `${list.length} hazards proposed by SAM — to keep or discard` });
  revalidatePath(`/safe/moc/${id}`);
}
