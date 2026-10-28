import type { SupabaseClient } from "@supabase/supabase-js";
import { ENT } from "@/lib/nav";

/** Projects › CAA applications (PRJ-01). One file = one application / notification / report to the authority. */
export type FileType = {
  code: string; family: string; name: string; entities: string[];
  routes: Record<string, { portal: string; category: string }>;
  checklist: ChecklistItem[]; closeout: string[];
  default_owner_role: string | null; needs_signature: boolean; target_days: number; ord: number; active: boolean; notes: string | null;
};
export type ChecklistItem = { key: string; label: string; role?: string | null; required?: boolean };
export type AuthorityFile = {
  id: string; entity: string; type_code: string; title: string; stage: Stage; category: string | null; authority: string | null;
  portal: string | null; portal_ref: string | null; portal_url: string | null; owner_role: string | null; owner_person: string | null;
  trigger_kind: string | null; trigger_note: string | null; revision_id: string | null; finding_ref: string | null; aircraft_reg: string | null;
  np_post_code: string | null; moc_ref: string | null; outcome: string | null; rounds: number; fee: number | null; fee_currency: string | null;
  triggered_at: string; target_date: string | null; submitted_at: string | null; decision_at: string | null; closed_at: string | null;
  lessons: string | null; created_by: string | null; created_at: string; updated_at: string; project_id?: string | null;
};
export type FileItem = { id: string; file_id: string; ord: number; key: string; label: string; role: string | null; required: boolean; done: boolean; done_by: string | null; done_at: string | null; note: string | null };
export type FileEvent = { id: number; file_id: string; at: string; kind: string; who: string | null; note: string | null; meta: Record<string, unknown> | null };
export type FileAttachment = { id: string; file_id: string; name: string; kind: string | null; path: string | null; size: number | null; at: string };
/** One exchange with the authority (DOC-09: all rounds live in the same application). Shared with the revision's Publish tab. */
export type Round = { id: string; file_id: string | null; revision_id: string | null; at: string; direction: "sent" | "received"; who: string; note: string };

export type Stage = "draft" | "compliance" | "signing" | "ready" | "submitted" | "remarks" | "approved" | "published" | "closed" | "standby";
export const STAGES: Stage[] = ["draft", "compliance", "signing", "ready", "submitted", "remarks", "approved", "published", "closed"];
export const STAGE_LABEL: Record<Stage, string> = {
  draft: "Draft", compliance: "Compliance check", signing: "Signing", ready: "Ready to submit", submitted: "At the authority",
  remarks: "Remarks to answer", approved: "Decision received", published: "Published / integrated", closed: "Closed", standby: "Standby",
};
export const STAGE_TONE: Record<Stage, string> = { draft: "", compliance: "amber", signing: "amber", ready: "amber", submitted: "", remarks: "red", approved: "green", published: "green", closed: "green", standby: "" };
export const FAMILIES = ["Manuals", "Aircraft", "People", "Airworthiness", "Approvals", "Reports"];
export const CATEGORY_LABEL: Record<string, string> = { approval: "Approval", notification: "Notification", declaration: "Declaration", derogation: "Derogation", communication: "Communication", report: "Report" };
export const TRIGGERS: [string, string][] = [["revision", "Manual revision"], ["finding", "Finding"], ["aircraft", "Aircraft"], ["np", "Nominated person"], ["regulation", "Regulation"], ["calendar", "Calendar"], ["other", "Other"]];

export const OPEN_STAGES: Stage[] = ["draft", "compliance", "signing", "ready", "submitted", "remarks", "approved", "published"];
export const AT_AUTHORITY: Stage[] = ["submitted", "remarks"];

/** Stage moves, who may make them, and what they need. */
export type Move = { to: Stage; label: string; by: "owner_or_cmm" | "cmm"; needsAllRequired?: boolean; needsRef?: boolean; needsNote?: boolean; primary?: boolean };
export function movesFrom(stage: Stage, needsSignature: boolean): Move[] {
  switch (stage) {
    case "draft": return [{ to: "compliance", label: "Hand over to Compliance", by: "owner_or_cmm", primary: true }, { to: "standby", label: "Put on standby", by: "cmm", needsNote: true }];
    case "compliance": return [
      ...(needsSignature ? [{ to: "signing" as Stage, label: "Checked — send for signature", by: "cmm" as const, needsAllRequired: true, primary: true }] : [{ to: "ready" as Stage, label: "Checked — ready to submit", by: "cmm" as const, needsAllRequired: true, primary: true }]),
      { to: "draft", label: "Send back to the author", by: "cmm", needsNote: true }, { to: "standby", label: "Put on standby", by: "cmm", needsNote: true }];
    case "signing": return [{ to: "ready", label: "Signed — ready to submit", by: "cmm", primary: true }, { to: "draft", label: "Send back to the author", by: "cmm", needsNote: true }];
    case "ready": return [{ to: "submitted", label: "Record the submission", by: "cmm", needsRef: true, primary: true }, { to: "compliance", label: "Back to Compliance check", by: "cmm" }];
    case "submitted": return [{ to: "remarks", label: "Remarks received", by: "cmm", needsNote: true }, { to: "approved", label: "Decision received", by: "cmm", primary: true }, { to: "standby", label: "Withdrawn / standby", by: "cmm", needsNote: true }];
    case "remarks": return [{ to: "submitted", label: "Reply sent (new version)", by: "cmm", needsNote: true, primary: true }, { to: "approved", label: "Decision received", by: "cmm" }];
    case "approved": return [{ to: "published", label: "Integrated and published", by: "cmm", primary: true }, { to: "closed", label: "Close (nothing to publish)", by: "cmm" }];
    case "published": return [{ to: "closed", label: "Close-out done", by: "cmm", primary: true }];
    case "standby": return [{ to: "draft", label: "Resume", by: "cmm", primary: true }, { to: "closed", label: "Close", by: "cmm", needsNote: true }];
    default: return [];
  }
}

export function routeFor(t: FileType | null | undefined, entity: string): { portal: string; category: string; authority: string } {
  const r = t?.routes?.[entity];
  return { portal: r?.portal ?? "", category: r?.category ?? "approval", authority: ENT[entity]?.auth ?? "" };
}
export const today = () => new Date().toISOString().slice(0, 10);
export function addDays(d: string, n: number): string { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
export function daysAtAuthority(f: AuthorityFile): number | null {
  if (!f.submitted_at) return null;
  return daysBetween(f.submitted_at, f.decision_at ?? today());
}
export const fr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

/** What the file is waiting for, in one line. */
export function nextAction(f: AuthorityFile, items: Pick<FileItem, "required" | "done" | "label">[] = []): string {
  const missing = items.filter((i) => i.required && !i.done);
  switch (f.stage) {
    case "draft": return missing.length ? `Dossier: ${missing.length} required item(s) to complete` : "Hand over to Compliance";
    case "compliance": return missing.length ? `Compliance check — ${missing.length} required item(s) still open` : "Compliance check — all items done, confirm";
    case "signing": return "Signatures to collect";
    case "ready": return "Submit on the portal (CMM)";
    case "submitted": { const d = daysAtAuthority(f); const late = f.target_date && f.target_date < today(); return late ? `Waiting for the authority — target date passed (${d} days), follow up` : `Waiting for the authority (${d ?? 0} days)`; }
    case "remarks": return "Answer the authority's remarks in the same application";
    case "approved": return "Integrate the return, publish, file the letter";
    case "published": return "Close-out: repository, APP - Approvals, fee";
    case "closed": return "Closed";
    case "standby": return "On standby";
  }
}

export async function loadTypes(db: SupabaseClient): Promise<FileType[]> {
  const { data } = await db.from("authority_file_types").select("*").eq("active", true).order("ord");
  return (data ?? []) as FileType[];
}
export async function loadFile(db: SupabaseClient, id: string): Promise<{ file: AuthorityFile; items: FileItem[]; events: FileEvent[]; attachments: FileAttachment[]; rounds: Round[]; type: FileType | null } | null> {
  const { data: f } = await db.from("authority_files").select("*").eq("id", id).maybeSingle();
  if (!f) return null;
  const file = f as AuthorityFile;
  const [{ data: items }, { data: events }, { data: attachments }, { data: type }, rounds] = await Promise.all([
    db.from("authority_file_items").select("*").eq("file_id", id).order("ord"),
    db.from("authority_file_events").select("*").eq("file_id", id).order("at", { ascending: false }).limit(200),
    db.from("authority_file_attachments").select("*").eq("file_id", id).order("at"),
    db.from("authority_file_types").select("*").eq("code", file.type_code).maybeSingle(),
    loadRounds(db, file),
  ]);
  return { file, items: (items ?? []) as FileItem[], events: (events ?? []) as FileEvent[], attachments: (attachments ?? []) as FileAttachment[], rounds, type: (type as FileType | null) ?? null };
}
/** Rounds of the file: its own, plus those written on its revision from the editor (same application). */
export async function loadRounds(db: SupabaseClient, f: Pick<AuthorityFile, "id" | "revision_id">): Promise<Round[]> {
  const q = db.from("authority_rounds").select("id,file_id,revision_id,at,direction,who,note");
  const { data } = f.revision_id ? await q.or(`file_id.eq.${f.id},revision_id.eq.${f.revision_id}`) : await q.eq("file_id", f.id);
  const rows = ((data ?? []) as Round[]).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows;
}
/** Records one exchange on the file (and on its revision when there is one — the trigger fills the missing side). */
export async function recordRound(db: SupabaseClient, f: Pick<AuthorityFile, "id" | "revision_id">, r: { direction: "sent" | "received"; who: string; note: string; at?: string }): Promise<void> {
  await db.from("authority_rounds").insert({ file_id: f.id, revision_id: f.revision_id, at: r.at ?? today(), direction: r.direction, who: r.who, note: r.note });
}

/** Inbox tasks follow the stage: the previous task of the file is closed, one new task per stage (PRJ-01 §6). */
export async function syncTasks(db: SupabaseClient, f: AuthorityFile): Promise<void> {
  await db.from("tasks").update({ status: "done" }).eq("ref_id", f.id).eq("status", "open");
  const link = `/proj/auth/${f.id}`;
  const base = { entity: f.entity, kind: "authority", link, ref_id: f.id, status: "open" };
  const t = (title: string, detail: string, owner: { owner_role?: string | null; owner_person?: string | null }, due: string | null) => ({ ...base, title, detail, due, owner_role: owner.owner_role ?? null, owner_person: owner.owner_person ?? null });
  const owner = f.owner_person ? { owner_person: f.owner_person } : { owner_role: f.owner_role ?? "CMM" };
  const cmm = { owner_role: "CMM" };
  const rows: ReturnType<typeof t>[] = [];
  switch (f.stage) {
    case "draft": rows.push(t(`Prepare the dossier — ${f.title}`, `${f.portal ?? f.authority ?? ""}. Complete the checklist, then hand over to Compliance.`, owner, f.target_date ? addDays(f.target_date, -14) : null)); break;
    case "compliance": rows.push(t(`Compliance check — ${f.title}`, "Route, forms and attachments: confirm every required item.", cmm, addDays(today(), 3))); break;
    case "signing": rows.push(t(`Signatures — ${f.title}`, "Collect the signatures, then mark the file ready.", cmm, addDays(today(), 5))); break;
    case "ready": rows.push(t(`Submit — ${f.title}`, `Dossier complete: submit on ${f.portal ?? "the portal"} and record the reference.`, cmm, addDays(today(), 1))); break;
    case "submitted": rows.push(t(`Follow up — ${f.title}`, `At ${f.authority ?? "the authority"} since ${fr(f.submitted_at)}${f.portal_ref ? ` (${f.portal_ref})` : ""}.`, cmm, f.target_date)); break;
    case "remarks": rows.push(t(`Answer the remarks — ${f.title}`, "Reply in the same application with the corrected version.", cmm, addDays(today(), 5)), t(`Correct the dossier after remarks — ${f.title}`, "See the authority's remarks in the file journal.", owner, addDays(today(), 3))); break;
    case "approved": rows.push(/CERT/i.test(f.type_code ?? "") // FB-032 · a certificate file has nothing to publish
      ? t(`File the certificate — ${f.title}`, "Certificate received: file it in Certificates & Validities with its expiry, then close the file.", cmm, addDays(today(), 5))
      : t(`Integrate and publish — ${f.title}`, "Letter and signed pages to file, manual to publish.", cmm, addDays(today(), 5))); break;
    case "published": rows.push(t(`Close-out — ${f.title}`, "Repository deposit, APP - Approvals, fee form, linked finding or NP record.", cmm, addDays(today(), 5))); break;
    default: break;
  }
  if (rows.length) {
    const { data: inserted } = await db.from("tasks").insert(rows).select("*");
    // TMS-01: the card goes to Teams right away (best effort)
    if (inserted?.length) { const { notifyTasks } = await import("@/lib/teams"); await notifyTasks(db, inserted as Parameters<typeof notifyTasks>[1]); }
  }
}

/**
 * DOC-09 ↔ PRJ-01: the manual revision and its CAA application move together. Sending a revision to the authority from the
 * editor opens (or readies) its file; publishing the revision closes the authority step of the file.
 */
export async function followRevision(db: SupabaseClient, who: { name: string; personId: string | null },
  rev: { id: string; rev: string; issue: number; authority_route: string | null; authority_ref: string | null },
  manual: { id: string; code: string; title: string; entity: string; needs_signature: boolean }, to: string): Promise<void> {
  const { data } = await db.from("authority_files").select("*").eq("revision_id", rev.id).not("stage", "in", "(closed,standby)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  let f = (data as AuthorityFile | null) ?? null;
  const ev = (fileId: string, kind: string, note: string, meta?: Record<string, unknown>) => db.from("authority_file_events").insert({ file_id: fileId, kind, who: who.name, actor: who.personId, note, meta: meta ?? null });
  if (to === "with_civil_aviation") {
    if (rev.authority_route !== "approval" && rev.authority_route !== "notification") return;
    const stage: Stage = rev.authority_ref ? "submitted" : "ready";
    if (!f) {
      const code = rev.authority_route === "approval" ? "OM-APP" : "OM-NOT";
      const { data: t } = await db.from("authority_file_types").select("*").eq("code", code).maybeSingle();
      const type = (t as FileType | null) ?? null;
      const route = routeFor(type, manual.entity);
      const row = { entity: manual.entity, type_code: code, title: `${manual.code} Iss ${rev.issue} Rev ${rev.rev} — ${manual.title}`, stage, category: route.category, authority: route.authority, portal: route.portal,
        owner_role: type?.default_owner_role ?? "CMM", trigger_kind: "revision", trigger_note: "sent from the revision editor", revision_id: rev.id, portal_ref: rev.authority_ref,
        submitted_at: rev.authority_ref ? today() : null, target_date: addDays(today(), type?.target_days ?? 20), created_by: who.personId };
      const { data: created } = await db.from("authority_files").insert(row).select("*").single();
      if (!created) return;
      f = created as AuthorityFile;
      if (type?.checklist?.length) await db.from("authority_file_items").insert(type.checklist.map((c, i) => ({ file_id: f!.id, ord: i + 1, key: c.key, label: c.label, role: c.role ?? null, required: c.required !== false, done: true, done_by: who.personId, done_at: new Date().toISOString(), note: "checked in the revision editor" })));
      await ev(f.id, "created", `Opened from the revision editor (${manual.code} Rev ${rev.rev} sent to the authority)`);
    } else if (["draft", "compliance", "signing", "ready"].includes(f.stage)) {
      await db.from("authority_files").update({ stage, portal_ref: f.portal_ref ?? rev.authority_ref, submitted_at: stage === "submitted" ? f.submitted_at ?? today() : f.submitted_at, updated_at: new Date().toISOString() }).eq("id", f.id);
      await ev(f.id, "stage", `Revision sent to the authority from the editor → ${STAGE_LABEL[stage]}`);
    }
  } else if (to === "published" && f && ["submitted", "remarks", "approved"].includes(f.stage)) {
    const outcome = f.outcome ?? (f.category === "notification" ? "acknowledged" : "approved");
    await db.from("authority_files").update({ stage: "published", outcome, decision_at: f.decision_at ?? today(), updated_at: new Date().toISOString() }).eq("id", f.id);
    await ev(f.id, "stage", `Revision published → close-out`);
  } else return;
  if (!f) return;
  // rounds written on the revision before its file existed (the editor records the round, then calls us) join the file
  await db.from("authority_rounds").update({ file_id: f.id }).eq("revision_id", rev.id).is("file_id", null);
  const { data: fresh } = await db.from("authority_files").select("*").eq("id", f.id).maybeSingle();
  if (fresh) await syncTasks(db, fresh as AuthorityFile);
}

/**
 * FB-030 · When a project is cancelled or deleted, the CAA applications it opened and that never reached the authority go on standby
 * (their open tasks are superseded); files already submitted are left as they are, only detached. Returns the number put on standby.
 */
export async function standbyProjectFiles(db: SupabaseClient, projectId: string, who: { name: string; personId: string | null }, why: string): Promise<number> {
  const { data } = await db.from("authority_files").select("id,stage,title").eq("project_id", projectId).in("stage", ["draft", "compliance", "signing", "ready"]);
  const files = (data ?? []) as { id: string; stage: string; title: string }[];
  for (const f of files) {
    await db.from("authority_files").update({ stage: "standby", updated_at: new Date().toISOString() }).eq("id", f.id);
    await db.from("tasks").update({ status: "superseded" }).eq("ref_id", f.id).eq("status", "open");
    await db.from("authority_file_events").insert({ file_id: f.id, kind: "stage", who: who.name, actor: who.personId, note: `Standby — ${why} (was ${f.stage})`, meta: { project_id: projectId } });
  }
  return files.length;
}
