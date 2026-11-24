"use server";
import { fail } from "@/lib/fail";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isCmm } from "@/lib/revisions";
import { applySync, autoApply, parseLines } from "@/lib/portal-sync";
import { basePost } from "@/lib/session";

/* PRJ-05 · portal readings: record what was read, then apply the lines the Compliance desk ticked. */
async function desk() { const s = await getSession(); if (!s) redirect("/login"); if (!isCmm(s)) fail("Compliance desk only."); return s; }
export async function recordReading(fd: FormData) {
  const s = await desk();
  const read_on = String(fd.get("read_on") ?? "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(read_on)) fail("Date of the reading missing.");
  let raw: unknown; try { raw = JSON.parse(String(fd.get("lines") ?? "")); } catch { fail("The reading is not valid JSON: paste the list as the CAA point produced it."); }
  const lines = parseLines(raw); if (!lines.length) fail("No line recognised (expected: entity, number or title, status…).");
  const out = lines.filter((l) => !s.group && !s.entities.includes(l.entity)); if (out.length) fail(`Out of your scope: ${[...new Set(out.map((l) => l.entity))].join(", ")}.`);
  const { data, error } = await supabaseAdmin().from("portal_readings").insert({ read_on, source: String(fd.get("source") ?? "").trim() || null, entities: [...new Set(lines.map((l) => l.entity))], lines: raw, created_by: s.person?.id ?? null }).select("id").single();
  if (error || !data) redirect(`/proj/auth/sync?err=${encodeURIComponent(`Reading not saved: ${error?.message ?? "unknown"}`)}`);
  redirect(`/proj/auth/sync/${(data as unknown as { id: string }).id}`);
}
/** A finding of the authority that S.A.M. does not hold: opened as the portal reads it (title, text, level, reference, dates), to analyse.
 *  One click by Compliance; the owner post is Compliance until it names the nominated person who answers. */
export async function openFindingFromReading(fd: FormData) {
  const s = await desk(); const id = String(fd.get("id")); const key = String(fd.get("open") ?? "");
  const db = supabaseAdmin();
  const { data: rd } = await db.from("portal_readings").select("read_on,source,lines").eq("id", id).maybeSingle();
  const reading = rd as { read_on: string; source: string | null; lines: unknown } | null; if (!reading) fail("Reading not found");
  const l = parseLines(reading.lines).find((x) => x.key === key && x.kind === "finding"); if (!l) fail("Line not found");
  if (!s.group && !s.entities.includes(l.entity)) fail("Out of scope");
  const { data: dup } = await db.from("findings").select("id").eq("entity", l.entity).eq("authority_ref", l.number).limit(1);
  if (dup?.length) redirect(`/comp/find/${(dup[0] as { id: string }).id}`);
  const { nextFindingNumber, syncFindingTasks } = await import("@/lib/findings");
  const lv = /obs/i.test(l.level ?? "") ? "obs" : (/([123])/.exec(l.level ?? "") ?? [])[1] ?? "2";
  const authority = /meteor|dsac/i.test(`${reading.source} ${l.url ?? ""}`) ? "DSAC" : /tmcad|centrik/i.test(`${reading.source} ${l.url ?? ""}`) ? "TM-CAD" : null;
  const row = { entity: l.entity, number: await nextFindingNumber(db, l.entity), source: "authority", authority, authority_ref: l.number, audit_ref: l.origin, level: lv, requirement: l.requirement, title: l.title.slice(0, 300), description: l.description,
    owner_role: "CMM", notified: l.notified ?? reading.read_on, due: l.due, status: "open", portal_status: l.status, portal_read_on: reading.read_on, imported_from: `portal reading ${reading.read_on}`, created_by: s.person?.id ?? null };
  const { data, error } = await db.from("findings").insert(row).select("*").single();
  if (error || !data) fail(error?.message ?? "Finding not created");
  await syncFindingTasks(db, data as never);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: l.entity, object_type: "finding", object_id: (data as { id: string }).id, action: "finding_created", after: { ...row, via: "portal_reading", reading: id } });
  revalidatePath("/comp/find"); revalidatePath(`/proj/auth/sync/${id}`); revalidatePath("/home/tasks");
  redirect(`/comp/find/${(data as { id: string }).id}`);
}
/** 24/11 · a finding the authority has closed and S.A.M. still holds open: closed here by the desk, in one click, with the date the
 *  authority closed it (the date of the reading unless another is given) written on the finding. */
export async function closeFindingFromReading(fd: FormData) {
  const s = await desk(); const id = String(fd.get("id")); const key = String(fd.get("close") ?? "");
  const db = supabaseAdmin();
  const { data: rd } = await db.from("portal_readings").select("read_on,source,lines,applied").eq("id", id).maybeSingle();
  const reading = rd as { read_on: string; source: string | null; lines: unknown; applied: Record<string, unknown> | null } | null; if (!reading) fail("Reading not found");
  const lines = parseLines(reading.lines); const l = lines.find((x) => x.key === key && x.kind === "finding" && x.closed); if (!l) fail("Line not found");
  if (!s.group && !s.entities.includes(l.entity)) fail("Out of scope");
  const { planSync } = await import("@/lib/portal-sync");
  const p = (await planSync(db, lines, reading.read_on, {})).proposals.find((x) => x.line.key === key);
  if (!p?.id) redirect(`/proj/auth/sync/${id}?msg=${encodeURIComponent("Already closed in S.A.M.")}`);
  const given = String(fd.get(`closed_on_${key}`) ?? ""); const on = /^\d{4}-\d{2}-\d{2}$/.test(given) && given <= reading.read_on ? given : reading.read_on;
  const authority = /meteor|dsac/i.test(`${reading.source} ${l.url ?? ""}`) ? "DSAC" : /tmcad|centrik/i.test(`${reading.source} ${l.url ?? ""}`) ? "TM-CAD" : "the authority";
  const now = new Date().toISOString(); const { fr: frd } = await import("@/lib/dates");
  const patch = { status: "closed", closed_at: now, closed_by: s.person?.id ?? null, closed_note: `Closed by ${authority} on ${frd(on)} (“${l.status}” read on the portal on ${frd(reading.read_on)})`, effective_closed_on: on, portal_status: l.status, portal_read_on: reading.read_on, updated_at: now };
  const { data, error } = await db.from("findings").update(patch).eq("id", p!.id!).select("*").single();
  if (error || !data) fail(error?.message ?? "Finding not closed");
  const { syncFindingTasks } = await import("@/lib/findings");
  await syncFindingTasks(db, data as never);
  await db.from("audit_log").insert({ actor: s.person?.id ?? null, entity: l.entity, object_type: "finding", object_id: p!.id!, action: "finding_close", after: { ...patch, via: "portal_reading", reading: id } });
  revalidatePath("/comp/find"); revalidatePath(`/comp/find/${p!.id}`); revalidatePath(`/proj/auth/sync/${id}`); revalidatePath("/home/tasks");
  redirect(`/proj/auth/sync/${id}?msg=${encodeURIComponent(`${p!.holds}: closed in S.A.M., closed by ${authority} on ${frd(on)}.`)}`);
}
export async function applyReading(fd: FormData) {
  const s = await desk(); const id = String(fd.get("id"));
  const picks = fd.getAll("pick").map(String).map((key) => ({ key, type: String(fd.get(`type_${key}`) ?? "") || null, title: String(fd.get(`title_${key}`) ?? "").trim() || null }));
  if (!picks.length) fail("Tick at least one line.");
  const r = await applySync(supabaseAdmin(), { personId: s.person?.id ?? null, name: s.name }, id, picks);
  revalidatePath("/proj/auth"); revalidatePath("/comp/find"); revalidatePath("/dash/due"); revalidatePath("/home/tasks");
  redirect(`/proj/auth/sync/${id}?msg=${encodeURIComponent(`${r.created} file(s) opened, ${r.updated} updated`)}`);
}

/** Who may read the portals from S.A.M.: the CMM, the deputy CMM, and the people named in Settings › Parameters (portal_readers). */
export async function mayReadPortals(): Promise<boolean> {
  const s = await getSession(); if (!s) return false;
  if (s.roles.some((r) => ["CMM", "SUPERADMIN"].includes(basePost(r)))) return true;
  const { data } = await supabaseAdmin().from("app_params").select("value").eq("key", "portal_readers").maybeSingle();
  const allowed = String((data as { value?: string } | null)?.value ?? "").toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return !!s.email && allowed.includes(s.email.toLowerCase());
}
/** Called by the « Read the portals » button with what the S.A.M. Reader extension read in the person's own session. */
export async function receivePortalReading(payload: { portal: string; label?: string; account?: string | null; lines: unknown[] }[]): Promise<{ ok: boolean; error?: string; id?: string; created?: number; updated?: number; same?: number; info?: number; exceptions?: { kind: string; ref: string; text: string; href: string | null }[] }> {
  const s = await getSession(); if (!s) return { ok: false, error: "Not signed in" };
  if (!(await mayReadPortals())) return { ok: false, error: "Reading the portals is reserved to the Compliance desk." };
  const raw = payload.flatMap((p) => (Array.isArray(p.lines) ? p.lines : [])); const lines = parseLines(raw);
  if (!lines.length) return { ok: false, error: "The portals returned no line." };
  if (lines.some((l) => !s.group && !s.entities.includes(l.entity))) return { ok: false, error: "The portal read belongs to an entity outside your scope." };
  const db = supabaseAdmin(); const read_on = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from("portal_readings").insert({ read_on, source: payload.map((p) => p.label ?? p.portal).join(", ") + " (S.A.M. Reader)", entities: [...new Set(lines.map((l) => l.entity))], lines: raw, created_by: s.person?.id ?? null }).select("id").single();
  if (error || !data) return { ok: false, error: `Reading not saved: ${error?.message ?? "unknown"}` };
  const id = (data as unknown as { id: string }).id;
  try {
    // FB-158: the tasks the reading creates stay in the Inbox without a card each; the reader gets one card of synthesis
    const { quietTeams } = await import("@/lib/quiet");
    const { result: r } = await quietTeams(() => autoApply(db, { personId: s.person?.id ?? null, name: s.name }, id));
    if (s.person && (r.created || r.updated || r.exceptions.length)) { try { const { ensureConversation, sendCard, readingCard, teamsConfigured } = await import("@/lib/teams");
      if (teamsConfigured()) { const conv = await ensureConversation(db, { id: s.person.id, email: s.email }); if (conv) await sendCard(conv, readingCard(r, `/proj/auth/sync/${id}`), "Portal reading"); } } catch { /* the card is a courtesy: the reading is saved */ } }
    revalidatePath("/proj/auth"); revalidatePath("/comp/find"); revalidatePath("/dash/due"); revalidatePath("/home/tasks");
    return { ok: true, id, ...r }; }
  catch (e) { return { ok: false, id, error: (e as Error).message }; }
}
