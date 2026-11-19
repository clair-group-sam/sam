import type { SupabaseClient } from "@supabase/supabase-js";
import { ballOf, routeFor, syncTasks, type AuthorityFile, type FileType, type Stage } from "@/lib/authority";
import { applyMove } from "@/lib/authority-moves";

/* PRJ-05 · Reconciling a portal reading with S.A.M. A line = one application or one finding as the portal shows it. Accepted keys are
 * the ones of the CAA point (French) or their English names: ref, entite/entity, nature/kind, numero/number, objet/title, statut/status,
 * autorite/assessor, niveau/level, echeance/due, balle/turn, dernier/last_exchange, a_faire/next_task, qui/who.
 * Nothing is changed by the plan: it lists, per line, what S.A.M. holds and what would change. The desk ticks, then applies.
 * A stage is never moved by a reading (the stage carries tasks and signatures): the portal's wording is stored beside it. */
export type PortalLine = { key: string; entity: string; kind: "file" | "finding" | "info"; number: string; title: string; status: string; assessor: string | null; level: string | null; due: string | null; turn: "us" | "authority" | null; last: string | null; lastOn: string | null; next: string | null; who: string | null; url: string | null; submitted: string | null; hint: string | null;
  /** a finding as the authority wrote it (METEOR): text, regulatory reference, date notified, surveillance act */ description: string | null; requirement: string | null; notified: string | null; origin: string | null };
const ENT: Record<string, string> = { AJD: "ASJMT", ASJ: "ASJFR", ASF: "ASFFR", TEC: "ASTFR", ASJMT: "ASJMT", ASJFR: "ASJFR", ASFFR: "ASFFR", ASTFR: "ASTFR" };
const s = (v: unknown) => { const t = v == null ? "" : String(v).trim(); return t && t !== "—" && t !== "None" && t !== "null" ? t : ""; };
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : null);
export function parseLines(raw: unknown): PortalLine[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { rows?: unknown[] })?.rows) ? (raw as { rows: unknown[] }).rows : [];
  return (arr as Record<string, unknown>[]).map((r, i) => {
    const nature = s(r.nature ?? r.kind).toLowerCase(); const counted = r.compte === undefined ? true : Number(r.compte) === 1;
    const kind: PortalLine["kind"] = nature === "info" ? "info" : /cart|finding/.test(nature) ? (counted ? "finding" : "info") : /dossier|file|application/.test(nature) ? (counted || /approuv|approved|clos/i.test(s(r.statut ?? r.status)) ? "file" : "info") : "info";
    const turn = s(r.balle ?? r.turn).toLowerCase();
    const due = s(r.echeance ?? r.due);
    return { key: s(r.ref) || `L${i + 1}`, entity: ENT[s(r.entite ?? r.entity).toUpperCase()] ?? s(r.entite ?? r.entity), kind, number: s(r.numero ?? r.number), title: s(r.objet ?? r.title), status: s(r.statut ?? r.status),
      assessor: s(r.autorite ?? r.assessor) || null, level: s(r.niveau ?? r.level) || null, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      turn: (/nous|us|ours/.test(turn) ? "us" : /autorit|authority/.test(turn) ? "authority" : null) as PortalLine["turn"], last: s(r.dernier ?? r.last_exchange) || null, next: s(r.a_faire ?? r.next_task) || null, who: s(r.qui ?? r.who) || null,
      lastOn: day(r.last_exchange_on), url: /^https:\/\//.test(s(r.url)) ? s(r.url) : null, submitted: day(r.submitted_on), hint: s(r.type_hint) || null,
      description: s(r.description) || null, requirement: s(r.requirement) || null, notified: day(r.notified), origin: s(r.origin) || null };
  }).filter((l) => l.entity && (l.number || l.title));
}
/** The numbers a portal reference is recognised by: every run of 4+ digits ("APP/AJD/OPS_6/36884" → 36884, "#252470" → 252470), or "2026-605". */
export const refTokens = (ref: string | null | undefined) => [...new Set([...(ref ?? "").matchAll(/\b20\d\d-\d{2,4}\b|\d{4,}/g)].map((m) => m[0]))].filter((t) => !/^20\d\d$/.test(t));
export function stageFromPortal(status: string): Stage {
  const t = status.toLowerCase();
  if (/standby/.test(t)) return "standby";
  if (/approuv|approved|pre-publish|clos\b|closed/.test(t)) return "approved";
  if (/requires info|remarque|remarks|à traiter/.test(t)) return "remarks";
  if (/draft|brouillon/.test(t)) return "draft";
  return "submitted";
}
/** A type for a file S.A.M. does not hold yet, guessed from the words of the portal; the desk corrects it in the review. */
export function guessType(l: PortalLine, types: FileType[]): string | null {
  const offered = types.filter((t) => t.active !== false && t.entities.includes(l.entity)); const t = `${l.number} ${l.title} ${l.hint ?? ""}`.toLowerCase();
  const pick = (...codes: string[]) => codes.find((c) => offered.some((o) => o.code === c)) ?? null;
  const byName = (re: RegExp) => offered.find((o) => re.test(`${o.code} ${o.name}`.toLowerCase()))?.code ?? null;
  return (/\bmel\b/.test(t) && (pick("MEL") ?? byName(/\bmel\b/))) || (/\bamp\b/.test(t) && (pick("AMP") ?? byName(/\bamp\b/))) || (/\bcame\b/.test(t) && pick("CAME"))
    || (/addition of|new aircraft|ajout/.test(t) && (pick("AC-IN", "AC-ADD") ?? byName(/addition|new aircraft|add an aircraft/))) || (/removal/.test(t) && (pick("AC-OUT") ?? byName(/removal|leaves/)))
    || (/registration|immatric|cofa|c of a|ac-reg|aw01/.test(t) && (pick("AW-CERT") ?? byName(/certificate|registration/)))
    || (/nomination|changement de|ctki|deputy|\bnp\b/.test(t) && (pick("NP", "NP-CHG") ?? byName(/nominated|nomination|post holder/)))
    || (/dérogation|derogation|dépassement|exemption/.test(t) && (pick("DEROG") ?? byName(/derog|exemption/)))
    || (/\bom\b|om-|om\.|gom|manual|manuel|msm|base training|rvsm|approval/.test(t) && (pick("OM", "OM-REV") ?? byName(/manual|\bom\b/)))
    || offered[0]?.code || null;
}
export type Change = { field: string; label: string; from: string | null; to: string | null };
export type Proposal = { line: PortalLine; object: "file" | "finding" | "none"; id: string | null; href: string | null; holds: string | null; action: "create" | "update" | "same" | "missing" | "info"; changes: Change[]; note: string | null; typeGuess: string | null; applied: boolean };
type FRow = AuthorityFile; type Fnd = { id: string; entity: string; number: string; title: string; status: string; due: string | null; authority_ref: string | null; audit_ref: string | null; portal_status: string | null; portal_read_on: string | null; description: string | null; requirement: string | null; notified: string | null };

export async function planSync(db: SupabaseClient, lines: PortalLine[], readOn: string, applied: Record<string, unknown> = {}): Promise<{ proposals: Proposal[]; unseen: { id: string; entity: string; ref: string; title: string; stage: string }[]; types: FileType[] }> {
  const ents = [...new Set(lines.map((l) => l.entity))];
  const [{ data: fl }, { data: fd }, { data: ty }] = await Promise.all([
    db.from("authority_files").select("*").in("entity", ents).limit(3000),
    db.from("findings").select("id,entity,number,title,status,due,authority_ref,audit_ref,portal_status,portal_read_on,description,requirement,notified").in("entity", ents).limit(5000),
    db.from("authority_file_types").select("*").order("ord"),
  ]);
  const files = (fl ?? []) as FRow[]; const finds = (fd ?? []) as Fnd[]; const types = (ty ?? []) as FileType[];
  const seen = new Set<string>(); const out: Proposal[] = [];
  const ch = (changes: Change[], field: string, label: string, from: string | null | undefined, to: string | null | undefined) => { if (to && (from ?? "") !== to) changes.push({ field, label, from: from ?? null, to }); };
  for (const l of lines) {
    const toks = refTokens(l.number); const done = l.key in applied;
    if (l.kind === "info") { out.push({ line: l, object: "none", id: null, href: null, holds: null, action: "info", changes: [], note: "For information: not followed as an open item", typeGuess: null, applied: done }); continue; }
    if (l.kind === "file") {
      const f = files.find((x) => x.entity === l.entity && toks.some((t) => refTokens(x.portal_ref).includes(t)));
      if (!f) { out.push({ line: l, object: "file", id: null, href: null, holds: null, action: "create", changes: [], note: `Not in S.A.M.: would be opened as « ${stageFromPortal(l.status)} »`, typeGuess: guessType(l, types), applied: done }); continue; }
      seen.add(f.id); const c: Change[] = [];
      ch(c, "portal_status", "Status on the portal", f.portal_status, l.status); ch(c, "target_date", "Target date", f.target_date, l.due); ch(c, "assessor", "Assessor", f.assessor, l.assessor);
      ch(c, "last_exchange", "Last exchange", f.last_exchange, l.last); ch(c, "last_exchange_on", "Exchange on", f.last_exchange_on, l.lastOn); ch(c, "portal_url", "Portal link", f.portal_url, l.url); ch(c, "next_task", "Next task", f.next_task, l.next); ch(c, "next_owner", "Who", f.next_owner, l.who);
      if (l.turn && ballOf(f) !== l.turn) c.push({ field: "ball_override", label: "Whose turn", from: ballOf(f), to: l.turn });
      const want = stageFromPortal(l.status); const note = want !== f.stage && !(want === "submitted" && f.stage === "remarks") ? `S.A.M. stage « ${f.stage} », the portal reads « ${l.status} »: move the stage on the file if it is right` : null;
      out.push({ line: l, object: "file", id: f.id, href: `/proj/auth/${f.id}`, holds: `${f.portal_ref ?? ""} ${f.title}`.trim(), action: c.length ? "update" : "same", changes: c, note, typeGuess: null, applied: done });
    } else {
      const f = finds.find((x) => x.entity === l.entity && toks.some((t) => refTokens(`${x.authority_ref ?? ""} ${x.audit_ref ?? ""}`).includes(t)))
        ?? finds.find((x) => x.entity === l.entity && l.title.length > 12 && x.title.toLowerCase().includes(l.title.toLowerCase().slice(0, 28)));
      if (!f) { out.push({ line: l, object: "finding", id: null, href: "/comp/find", holds: null, action: "missing", changes: [], note: "Not in S.A.M.: open it from here with the text of the authority, or raise it by hand in Compliance › Findings", typeGuess: null, applied: done }); continue; }
      const c: Change[] = []; ch(c, "portal_status", "Status at the authority", f.portal_status, l.status); ch(c, "due", "Due date", f.due, l.due);
      // the authority's own text fills what S.A.M. does not hold yet; what was written in S.A.M. is never overwritten
      if (!f.description) ch(c, "description", "Text of the finding", null, l.description); if (!f.requirement) ch(c, "requirement", "Regulatory reference", null, l.requirement); if (!f.notified) ch(c, "notified", "Notified on", null, l.notified);
      if (!refTokens(`${f.authority_ref ?? ""}`).some((t) => toks.includes(t))) ch(c, "authority_ref", "Authority reference", f.authority_ref, l.number);
      const closedThere = /clos|closed/i.test(l.status) && !/ready to close|pour clôture|soumis/i.test(l.status); const openHere = !["closed", "cancelled"].includes(f.status);
      out.push({ line: l, object: "finding", id: f.id, href: `/comp/find/${f.id}`, holds: `${f.number} ${f.title}`, action: c.length ? "update" : "same", changes: c, note: closedThere && openHere ? "Closed at the authority, still open in S.A.M.: close it on the finding" : null, typeGuess: null, applied: done });
    }
  }
  const unseen = files.filter((f) => !seen.has(f.id) && f.portal_ref && !["closed", "draft", "compliance", "signing", "ready"].includes(f.stage)).map((f) => ({ id: f.id, entity: f.entity, ref: f.portal_ref!, title: f.title, stage: f.stage }));
  return { proposals: out, unseen, types };
}

export async function applySync(db: SupabaseClient, actor: { personId: string | null; name: string }, readingId: string, picks: { key: string; type?: string | null; title?: string | null }[]): Promise<{ created: number; updated: number }> {
  const { data: rd } = await db.from("portal_readings").select("*").eq("id", readingId).maybeSingle();
  const reading = rd as { id: string; read_on: string; lines: unknown; applied: Record<string, unknown> } | null; if (!reading) throw new Error("Reading not found");
  const { proposals, types } = await planSync(db, parseLines(reading.lines), reading.read_on, {});
  let created = 0, updated = 0; const applied = { ...(reading.applied ?? {}) }; const stamp = (key: string, what: string) => { applied[key] = { at: new Date().toISOString(), by: actor.name, what }; };
  for (const pk of picks) {
    const p = proposals.find((x) => x.line.key === pk.key); if (!p) continue; const l = p.line;
    if (p.action === "create" && p.object === "file") {
      const type = types.find((t) => t.code === (pk.type || p.typeGuess)); if (!type || !type.entities.includes(l.entity)) throw new Error(`${l.key}: choose a type offered for ${l.entity}`);
      const route = routeFor(type, l.entity); const stage = stageFromPortal(l.status); const authority = route.authority;
      const row = { entity: l.entity, type_code: type.code, title: (pk.title || l.title).slice(0, 200), stage, category: route.category, authority, portal: route.portal || null, portal_ref: l.number, owner_role: type.default_owner_role,
        trigger_kind: "other", trigger_note: `Read on the portal on ${reading.read_on}`, triggered_at: l.submitted ?? reading.read_on, target_date: l.due, submitted_at: stage === "draft" ? null : l.submitted ?? reading.read_on, portal_url: l.url, decision_at: stage === "approved" ? reading.read_on : null, outcome: stage === "approved" ? "approved" : null,
        ball_override: l.turn && l.turn !== (stage === "submitted" ? "authority" : "us") ? l.turn : null, next_task: l.next, next_owner: l.who, assessor: l.assessor, portal_status: l.status, portal_read_on: reading.read_on, last_exchange: l.last, last_exchange_on: l.lastOn, imported_from: `portal reading ${reading.read_on}`, created_by: actor.personId };
      const { data: cf, error } = await db.from("authority_files").insert(row).select("*").single(); if (error || !cf) throw new Error(`${l.key}: ${error?.message ?? "not created"}`);
      const f = cf as AuthorityFile;
      await db.from("authority_file_events").insert({ file_id: f.id, kind: "created", who: actor.name, actor: actor.personId, note: `File mirrored from the portal reading of ${reading.read_on} (${l.status})`, meta: { reading: reading.id, line: l.key } });
      await db.from("audit_log").insert({ actor: actor.personId, entity: f.entity, object_type: "authority_file", object_id: f.id, action: "authority_file_created", after: { ...row, via: "portal_reading" } });
      await syncTasks(db, f); created++; stamp(l.key, "created");
    } else if (p.action === "update" && p.id) {
      const patch: Record<string, unknown> = {}; for (const c of p.changes) patch[c.field] = c.to;
      if (p.object === "file") {
        patch.portal_read_on = reading.read_on; patch.updated_at = new Date().toISOString();
        await db.from("authority_files").update(patch).eq("id", p.id);
        await db.from("authority_file_events").insert({ file_id: p.id, kind: "note", who: actor.name, actor: actor.personId, note: `Portal reading of ${reading.read_on}: ${p.changes.map((c) => c.label.toLowerCase()).join(", ")}`, meta: { reading: reading.id, patch } });
        await db.from("audit_log").insert({ actor: actor.personId, entity: l.entity, object_type: "authority_file", object_id: p.id, action: "authority_file_updated", after: { ...patch, via: "portal_reading" } });
      } else {
        patch.portal_read_on = reading.read_on;
        await db.from("findings").update(patch).eq("id", p.id);
        await db.from("audit_log").insert({ actor: actor.personId, entity: l.entity, object_type: "finding", object_id: p.id, action: "finding_portal_reading", after: { ...patch, reading: reading.id } });
      }
      updated++; stamp(l.key, "updated");
    } else if (p.action === "same" && p.id) { await db.from(p.object === "file" ? "authority_files" : "findings").update({ portal_read_on: reading.read_on }).eq("id", p.id); stamp(l.key, "confirmed"); }
  }
  await db.from("portal_readings").update({ applied }).eq("id", readingId);
  return { created, updated };
}

/** The automatic path (button « Read the portals »): everything that mirrors the portal is applied at once — files opened, status,
 *  date, turn, last exchange. What needs a person comes back as exceptions: a finding S.A.M. does not hold, a file S.A.M. believes at
 *  the authority that the portal no longer lists, a stage that disagrees with the portal's wording. */
export async function autoApply(db: SupabaseClient, actor: { personId: string | null; name: string }, readingId: string): Promise<{ created: number; updated: number; same: number; info: number; exceptions: { kind: string; ref: string; text: string; href: string | null }[] }> {
  const { data: rd } = await db.from("portal_readings").select("read_on,lines").eq("id", readingId).maybeSingle();
  const reading = rd as { read_on: string; lines: unknown } | null; if (!reading) throw new Error("Reading not found");
  const plan = await planSync(db, parseLines(reading.lines), reading.read_on, {});
  const ex: { kind: string; ref: string; text: string; href: string | null }[] = [];
  const picks = plan.proposals.filter((p) => (p.action === "create" && p.typeGuess) || p.action === "update" || (p.action === "same" && p.id)).map((p) => ({ key: p.line.key }));
  for (const p of plan.proposals) {
    if (p.action === "create" && !p.typeGuess) ex.push({ kind: "No type offered", ref: p.line.number, text: `${p.line.title}: no application type is offered for ${p.line.entity}, open it by hand`, href: "/proj/auth/new" });
    if (p.action === "missing") ex.push({ kind: "Finding not in S.A.M.", ref: p.line.number, text: `${p.line.title}: open it in S.A.M. from the reading, in one click, with the authority's text`, href: `/proj/auth/sync/${readingId}` });
    if (p.note && p.action !== "create" && p.action !== "missing" && p.action !== "info") ex.push({ kind: "To check", ref: p.line.number, text: p.note, href: p.href });
  }
  // a file S.A.M. still holds at the authority and the portal lists as decided: the portal's wording is stored on the file, the close-out stays a decision
  const norm = (x: string) => x.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const decided = new Map(plan.proposals.filter((p) => p.line.kind === "info" && p.line.number && p.line.status).map((p) => [norm(p.line.number), p.line]));
  for (const u of plan.unseen) {
    const c = decided.get(norm(u.ref));
    if (c && (u.stage === "approved" || u.stage === "published")) continue;   // the decision is already recorded here: only the close-out remains, no need to say it at every reading
    if (c) { await db.from("authority_files").update({ portal_status: c.status, portal_read_on: reading.read_on }).eq("id", u.id);
      ex.push({ kind: "Decided on the portal", ref: u.ref, text: `${u.title}: “${c.status}” on the portal, still “${u.stage}” in S.A.M. Record the decision and close the file.`, href: `/proj/auth/${u.id}` }); }
    else ex.push({ kind: "No longer on the portal", ref: u.ref, text: `${u.title}: at the authority in S.A.M. (${u.stage}), absent from the open applications read. Decision received?`, href: `/proj/auth/${u.id}` });
  }
  const r = picks.length ? await applySync(db, actor, readingId, picks) : { created: 0, updated: 0 };
  // 19/11 (Guillaume): S.A.M. reads the portal, so it is not for the user to tell it what the portal says. When the wording of the
  // portal is unambiguous, the reading moves the file itself: remarks received, decision received, reply sent. The close-out stays a human act.
  const want = new Map<string, { to: Stage; status: string; last: string | null }>();
  for (const p of plan.proposals) if (p.object === "file" && p.id && p.line.kind === "file") want.set(p.id, { to: stageFromPortal(p.line.status), status: p.line.status, last: p.line.turn === "authority" ? "authority" : p.line.last });
  for (const u of plan.unseen) { const c = decided.get(norm(u.ref)); if (c) want.set(u.id, { to: "approved", status: c.status, last: null }); }
  const turnOf = new Map(plan.proposals.filter((p) => p.id).map((p) => [p.id!, p.line.turn]));
  if (want.size) {
    const { data: fs } = await db.from("authority_files").select("*").in("id", [...want.keys()]);
    for (const f of (fs ?? []) as AuthorityFile[]) {
      const w = want.get(f.id)!; let to: Stage | null = null;
      if (f.stage === "submitted" && w.to === "remarks") to = "remarks";
      // a favourable decision only: a refusal, a withdrawal or a replaced dossier is left to the desk, with the portal's wording
      else if ((f.stage === "submitted" || f.stage === "remarks") && w.to === "approved" && /approuv|approved|signed off|accept|accus[ée]\W*(de\W*)?r[ée]ception|acknowledg|completed|publish/i.test(w.status) && !/refus|reject|withdraw|cancel|annul|remplac/i.test(w.status)) to = "approved";
      else if (f.stage === "remarks" && w.to === "submitted" && turnOf.get(f.id) === "authority") to = "submitted";
      const ref = f.portal_ref ?? f.title;
      // the portal is normally right, but S.A.M. is not rewound without a yes: a dossier held as submitted that the portal shows as not sent is a question
      if (f.stage === "submitted" && /not sent|non envoy|\bdraft\b|brouillon/i.test(w.status)) { ex.push({ kind: "Portal contradicts S.A.M.", ref, text: `${f.title}: submitted in S.A.M., “${w.status}” on the portal, so the turn is ours. Open the file to update S.A.M. or keep it.`, href: `/proj/auth/${f.id}` }); continue; }
      if (!to) continue;
      try {
        await applyMove(db, { personId: actor.personId, name: `${actor.name} (portal reading)`, cmm: true, owner: false }, f, to, { note: `Read on the portal on ${reading.read_on}: “${w.status}”.${f.last_exchange ? ` Last exchange: ${f.last_exchange.slice(0, 300)}` : ""}`, decision_at: to === "approved" ? reading.read_on : null });
        for (let i = ex.length - 1; i >= 0; i--) if (ex[i].href === `/proj/auth/${f.id}`) ex.splice(i, 1);
        ex.push({ kind: "Stage moved", ref, text: `${f.title}: the portal reads “${w.status}”. ${to === "remarks" ? "Passed to “Remarks to answer”: the reply is ours." : to === "approved" ? "Passed to “Decision received”: publication and close-out remain." : "Reply seen on the portal: back with the authority."}`, href: `/proj/auth/${f.id}` });
      } catch (e) { ex.push({ kind: "To check", ref, text: `${f.title}: the portal reads “${w.status}” but the file could not be moved (${e instanceof Error ? e.message : "error"})`, href: `/proj/auth/${f.id}` }); }
    }
  }
  return { ...r, same: plan.proposals.filter((p) => p.action === "same").length, info: plan.proposals.filter((p) => p.action === "info").length, exceptions: ex };
}
