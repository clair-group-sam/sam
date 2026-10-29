import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { basePost } from "@/lib/session";
import { ANSWERABLE_KINDS, cardFor, ensureConversation, infoCard, personFor, refreshCards, sendCard, sendText, stateOf, submitConfirmCard, taskCard, teamsConfigured, verifyBotJwt, type TaskRow } from "@/lib/teams";
import { applyMove } from "@/lib/authority-moves";
import { completeAction, verifyActionCore } from "@/lib/actions-core";
import type { Action } from "@/lib/actions";
import { syncTasks, type AuthorityFile } from "@/lib/authority";
import { after } from "next/server";
import { authorityCard, classifyIntent, createAuthorityFromCard, createFromCard, createMocFromCard, createdCard, discardedCard, draftAuthority, draftCard, draftMoc, draftReport, mocCard, openedCard, readThread, threadRefOf } from "@/lib/teams-draft";
import { runAnalysis } from "@/lib/safety-analysis";
import { attachCard, attachFile, attachableTasks, attachedCard, discardFile, saveIncomingFiles } from "@/lib/teams-files";

// TMS-01 · the bot's messaging endpoint (Azure Bot → here). Three kinds of activity: the person opens the bot (install),
// writes to it, or presses a button on a card (Universal Action). Every answer is written in S.A.M. "via Teams".
export const maxDuration = 25;

type Activity = {
  type: string; id?: string; name?: string; text?: string; serviceUrl: string; channelId?: string;
  from: { id: string; name?: string; aadObjectId?: string }; recipient?: { id: string };
  conversation: { id: string; conversationType?: string; tenantId?: string };
  membersAdded?: { id: string; aadObjectId?: string }[];
  attachments?: { contentType: string; contentUrl?: string; name?: string; content?: { downloadUrl?: string; fileType?: string; uniqueId?: string } }[];
  replyToId?: string; channelData?: { team?: { id?: string; aadGroupId?: string; name?: string }; channel?: { id?: string; name?: string } };
  value?: { action?: { verb?: string; data?: Record<string, string>; type?: string }; comment?: string } & Record<string, unknown>;
  entities?: { type: string; mentioned?: { id: string } }[];
};
const json = (v: unknown, status = 200) => Response.json(v, { status });
const cardResponse = (card: unknown) => json({ statusCode: 200, type: "application/vnd.microsoft.card.adaptive", value: card });
const msgResponse = (text: string) => json({ statusCode: 200, type: "application/vnd.microsoft.activity.message", value: text });
const now = () => new Date().toISOString();
const hhmm = () => { const d = new Date(); return `${d.toISOString().slice(0, 10).split("-").reverse().join("/")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };

export async function POST(req: NextRequest) {
  if (!teamsConfigured()) return new Response("teams not configured", { status: 503 });
  const jwt = await verifyBotJwt(req.headers.get("authorization"));
  const db = supabaseAdmin();
  if (!jwt.ok) {
    // keep a trace of what was refused (type of activity, reason) — the only visibility we have without the platform logs
    if (jwt.reason !== "no token") { const a0 = (await req.json().catch(() => ({}))) as Partial<Activity>; await db.from("teams_inbound").insert({ kind: "rejected", text: jwt.reason ?? null, meta: { type: a0.type, conversation: a0.conversation?.id } }); }
    return new Response(`unauthorized: ${jwt.reason}`, { status: 401 });
  }
  const a = (await req.json()) as Activity;
  const ref = { conversation_id: a.conversation.id, service_url: a.serviceUrl };
  const personal = (a.conversation.conversationType ?? "personal") === "personal";

  // 1 · the person opened the bot (or S.A.M. installed it for them): keep the conversation, say hello
  if (a.type === "conversationUpdate") {
    const added = (a.membersAdded ?? []).find((m) => m.id !== a.recipient?.id);
    if (added && personal) {
      const p = await personFor(db, { id: added.id, aadObjectId: added.aadObjectId }, ref, a.conversation.tenantId, "user");
      await db.from("teams_inbound").insert({ person_id: p?.id ?? null, aad_object_id: added.aadObjectId ?? null, kind: "install", meta: { conversation: a.conversation.id } });
      await sendCard(ref, p
        ? infoCard(`Hello ${p.display_name.split(" ")[0]}`, "I am S.A.M. I will send you here what needs you — a dossier to prepare, a manual to read, a finding to answer — with buttons to answer without opening the app. Write “tasks” to see what is waiting for you.", "/home/tasks")
        : infoCard("Hello", "I am S.A.M., but your Teams account is not attached to a person in S.A.M. yet. Ask the Compliance department to add you, then write to me again."));
    }
    return json({});
  }

  // 2 · a button on a card (Universal Action)
  if (a.type === "invoke" && a.name === "adaptiveCard/action") {
    const verb = a.value?.action?.verb ?? ""; const data = a.value?.action?.data ?? {};
    const comment = String((a.value?.action?.data as Record<string, unknown> | undefined)?.comment ?? a.value?.comment ?? "").trim();
    const p = await personFor(db, a.from, ref, a.conversation.tenantId);
    if (!p) return msgResponse("Your Teams account is not attached to a person in S.A.M. — ask the Compliance department.");
    if (verb === "task_done" || verb === "task_not_yet") {
      const { data: t } = await db.from("tasks").select("*").eq("id", data.taskId ?? "").maybeSingle();
      const task = t as TaskRow | null;
      if (!task) return msgResponse("This task no longer exists.");
      const mine = task.owner_person ? task.owner_person === p.id : task.owner_role ? p.roles.map(basePost).includes(basePost(task.owner_role)) : true;
      if (!mine) return msgResponse("This task is not addressed to you.");
      if (task.status !== "open") return cardResponse(taskCard(task, stateOf(task)));
      if (!ANSWERABLE_KINDS.has(task.kind)) return msgResponse("This one is answered in S.A.M. (open it from the card).");
      if (verb === "task_not_yet" && !comment) return msgResponse("A short comment is needed with “Not yet” (what is missing, or when).");
      await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, task_id: task.id, text: comment || null, meta: { title: task.title } });
      if (verb === "task_done" && task.kind === "action" && (task as { ref_id?: string | null }).ref_id) {
        // a safety action: same rule as the app — the note is the evidence, the SM verification opens
        if (!comment) return msgResponse("Say what was done and where the evidence is — the note is kept as evidence.");
        const { data: ad } = await db.from("safety_actions").select("*").eq("id", (task as { ref_id?: string }).ref_id!).maybeSingle();
        if (!ad) return msgResponse("The action no longer exists.");
        try { await completeAction(db, { personId: p.id, name: p.display_name }, ad as Action, comment, comment, "teams"); } catch (e) { return msgResponse(e instanceof Error ? e.message : "Refused"); }
        await db.from("tasks").update({ answered_via: "teams", answered_at: now(), answer: comment }).eq("id", task.id);
      } else if (verb === "task_done") {
        await db.from("tasks").update({ status: "done", answered_via: "teams", answered_at: now(), answer: comment || null }).eq("id", task.id);
        await journal(db, task, p.display_name, `Done via Teams${comment ? `: ${comment}` : ""}`);
        await handoverIfDraft(db, task, p);
      } else {
        await db.from("tasks").update({ answered_via: "teams", answered_at: now(), answer: comment, detail: `${task.detail ? task.detail + " — " : ""}Not yet (${p.display_name.split(" ")[0]}): ${comment}` }).eq("id", task.id);
        await journal(db, task, p.display_name, `Not yet (via Teams): ${comment}`);
      }
      await db.from("audit_log").insert({ actor: p.id, entity: task.entity, object_type: "task", object_id: task.id, action: verb, after: { via: "teams", comment } });
      const state = { answered: verb === "task_done" ? "done" as const : "not_yet" as const, by: p.display_name, at: hhmm(), comment: comment || null };
      if (verb === "task_done") await refreshCards(db, { ...task, status: "done", answered_via: "teams", answer: comment || null }, state, ref.conversation_id);
      return cardResponse(taskCard(task, state));
    }
    if (verb === "file_move" || verb === "action_verify") {
      const { data: t } = await db.from("tasks").select("*").eq("id", data.taskId ?? "").maybeSingle();
      const task = t as (TaskRow & { ref_id?: string | null }) | null;
      if (!task) return msgResponse("This task no longer exists.");
      if (task.status !== "open") return cardResponse(taskCard(task, stateOf(task)));
      const posts = p.roles.map(basePost);
      const cmm = posts.includes("CMM") || posts.includes("SUPERADMIN");
      try {
        if (verb === "file_move") {
          if (!cmm) return msgResponse("Stage moves are made by Compliance.");
          const { data: fd } = await db.from("authority_files").select("*").eq("id", String(data.fileId ?? "")).maybeSingle();
          if (!fd) return msgResponse("The file no longer exists.");
          const f = fd as AuthorityFile;
          await applyMove(db, { personId: p.id, name: p.display_name, cmm, owner: true }, f, String(data.to) as AuthorityFile["stage"], { note: comment || null }, "teams");
          await db.from("tasks").update({ answered_via: "teams", answered_at: now(), answer: comment || null }).eq("id", task.id);
          await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, task_id: task.id, text: `${f.stage} → ${data.to}${comment ? `: ${comment}` : ""}`, meta: { file: f.id } });
          const state = { answered: "done" as const, by: p.display_name, at: hhmm(), comment: `${f.stage} → ${data.to}${comment ? ` · ${comment}` : ""}` };
          await refreshCards(db, { ...task, status: "done" }, state, ref.conversation_id);
          return cardResponse(taskCard(task, state));
        }
        if (!(cmm || posts.includes("SM") || posts.includes("FSO"))) return msgResponse("Verification is made by the safety desk (SM / CMM).");
        const { data: ad } = await db.from("safety_actions").select("*").eq("id", task.ref_id ?? "").maybeSingle();
        if (!ad) return msgResponse("The action no longer exists.");
        const verdict = data.verdict === "back" ? "back" : "accept";
        await verifyActionCore(db, { personId: p.id, name: p.display_name }, ad as Action, verdict, comment || null, null, "teams");
        await db.from("tasks").update({ answered_via: "teams", answered_at: now(), answer: comment || null }).eq("id", task.id);
        await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, task_id: task.id, text: `${verdict}${comment ? `: ${comment}` : ""}`, meta: { action: task.ref_id } });
        const state = { answered: verdict === "accept" ? "done" as const : "not_yet" as const, by: p.display_name, at: hhmm(), comment: verdict === "accept" ? `Accepted and closed${comment ? ` · ${comment}` : ""}` : `Sent back · ${comment}` };
        await refreshCards(db, { ...task, status: "done" }, state, ref.conversation_id);
        return cardResponse(taskCard(task, state));
      } catch (e) { return msgResponse(e instanceof Error ? e.message : "Refused"); }
    }
    if (verb === "file_submit_prep" || verb === "file_submit_confirm" || verb === "file_submit_cancel") {
      const { data: t } = await db.from("tasks").select("*").eq("id", data.taskId ?? "").maybeSingle();
      const task = t as (TaskRow & { ref_id?: string | null }) | null;
      if (!task) return msgResponse("This task no longer exists.");
      if (task.status !== "open") return cardResponse(taskCard(task, stateOf(task)));
      if (verb === "file_submit_cancel") return cardResponse(await cardFor(db, task));
      const posts = p.roles.map(basePost);
      const cmm = posts.includes("CMM") || posts.includes("SUPERADMIN");
      if (!cmm) return msgResponse("The submission is recorded by Compliance.");
      const { data: fd } = await db.from("authority_files").select("*").eq("id", String(data.fileId ?? "")).maybeSingle();
      if (!fd) return msgResponse("The file no longer exists.");
      const f = fd as AuthorityFile;
      if (f.stage !== "ready") return msgResponse(`The file is at stage “${f.stage}”, not ready to submit.`);
      const { data: ty } = await db.from("authority_file_types").select("target_days").eq("code", f.type_code).maybeSingle();
      const targetDays = (ty as { target_days?: number } | null)?.target_days ?? 20;
      if (verb === "file_submit_prep") return cardResponse(submitConfirmCard(task, { id: f.id, title: f.title, authority: f.authority, portal: f.portal, portal_url: f.portal_url, target_days: targetDays }));
      try {
        const g = (k: string) => (typeof data[k] === "string" ? (data[k] as string).trim() : "");
        await applyMove(db, { personId: p.id, name: p.display_name, cmm, owner: true }, f, "submitted", { note: comment || null, portal_ref: g("portal_ref"), portal_url: g("portal_url") || null, submitted_at: g("submitted_at") || null, target_date: g("target_date") || null }, "teams");
        await db.from("tasks").update({ answered_via: "teams", answered_at: now(), answer: `submitted ${g("portal_ref")}` }).eq("id", task.id);
        await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, task_id: task.id, text: `ready → submitted ${g("portal_ref")}`, meta: { file: f.id } });
        const state = { answered: "done" as const, by: p.display_name, at: hhmm(), comment: `Submitted · ${g("portal_ref")}${comment ? ` · ${comment}` : ""}` };
        await refreshCards(db, { ...task, status: "done" }, state, ref.conversation_id);
        return cardResponse(taskCard(task, state));
      } catch (e) { return msgResponse(e instanceof Error ? e.message : "Refused"); }
    }
    if (verb === "file_attach" || verb === "file_discard") {
      const fileId = String(data.fileId ?? "");
      if (verb === "file_discard") { await discardFile(db, p.id, fileId); return cardResponse(infoCard("Discarded", "The file was not kept.")); }
      const res = await attachFile(db, p, fileId, String(data.taskId ?? ""), String(data.note ?? ""));
      await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, task_id: res.ok ? String(data.taskId) : null, text: res.ok ? res.file.name : res.error, meta: { file: fileId } });
      if (!res.ok) return msgResponse(res.error);
      return cardResponse(attachedCard(res.file, res.where, res.link));
    }
    if (verb === "report_discard") return cardResponse(discardedCard(p.display_name));
    if (verb === "authority_create" || verb === "moc_create") {
      const { data: pe } = await db.from("people").select("entities").eq("id", p.id).maybeSingle();
      const person = { id: p.id, display_name: p.display_name, entities: ((pe as { entities?: string[] } | null)?.entities ?? []) };
      const res = verb === "authority_create" ? await createAuthorityFromCard(db, person, data as Record<string, unknown>) : await createMocFromCard(db, person, data as Record<string, unknown>);
      await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, text: res.ok ? res.id : res.error, meta: { conversation: a.conversation.id } });
      if (!res.ok) return msgResponse(`Not created: ${res.error}`);
      return verb === "authority_create"
        ? cardResponse(openedCard("Authority file", (res as { title: string }).title, p.display_name, `/proj/auth/${res.id}`))
        : cardResponse(openedCard("Management of change", `${(res as { number: string }).number} — ${(res as { name: string }).name}`, p.display_name, `/safe/risk/a/${res.id}`));
    }
    if (verb === "report_create") {
      const { data: pe } = await db.from("people").select("entities").eq("id", p.id).maybeSingle();
      const res = await createFromCard(db, { id: p.id, display_name: p.display_name, entities: ((pe as { entities?: string[] } | null)?.entities ?? []) }, data as Record<string, unknown>);
      await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, text: res.ok ? res.id : res.error, meta: { conversation: a.conversation.id } });
      if (!res.ok) return msgResponse(`Not created: ${res.error}`);
      await db.from("audit_log").insert({ actor: p.id, entity: String(data.entity ?? ""), object_type: "report", object_id: res.id, action: "create", after: { via: "teams" } });
      const id = res.id; after(() => runAnalysis(id));
      return cardResponse(createdCard(res.id, res.headline, p.display_name));
    }
    return msgResponse("Unknown action.");
  }

  // 3 · a message to the bot
  if (a.type === "message") {
    const text = (a.text ?? "").replace(/<at>.*?<\/at>/g, "").trim();
    const p = await personFor(db, a.from, ref, a.conversation.tenantId);
    await db.from("teams_inbound").insert({ person_id: p?.id ?? null, aad_object_id: a.from.aadObjectId ?? null, kind: "message", text, meta: { conversation: a.conversation.id, type: a.conversation.conversationType ?? "personal" } });
    if (!p) { await sendCard(ref, infoCard("Not attached yet", "Your Teams account is not attached to a person in S.A.M. — ask the Compliance department, then write to me again.")); return json({}); }
    if (!personal) {
      // TMS-03 · @S.A.M. in a chat or a channel: only when mentioned (with RSC the bot receives every message of the chat — the rest is ignored).
      const mentioned = (a.entities ?? []).some((e) => e.type === "mention" && e.mentioned?.id && a.recipient?.id && e.mentioned.id === a.recipient.id);
      if (!mentioned) return json({});
      const tref = threadRefOf(a);
      if (!tref) { await sendCard(ref, infoCard("Not here", "I can draft from a group chat or a channel conversation where S.A.M. has been added.")); return json({}); }
      let thread; try { thread = await readThread(tref); } catch (e) {
        await sendCard(ref, infoCard("I cannot read this conversation yet", `Add S.A.M. to this ${tref.kind === "chat" ? "chat" : "team"} (… › Manage apps) so I may read the thread, then mention me again. (${e instanceof Error ? e.message.slice(0, 160) : "Graph refused"})`)); return json({});
      }
      if (!thread.length) { await sendCard(ref, infoCard("Nothing to draft from", "This conversation has no message I can read.")); return json({}); }
      const { data: pe } = await db.from("people").select("entities").eq("id", p.id).maybeSingle();
      const entities = ((pe as { entities?: string[] } | null)?.entities ?? []);
      if (!entities.length) { await sendCard(ref, infoCard("No entity", "Your S.A.M. profile has no entity: ask the Compliance department.")); return json({}); }
      try {
        // TMS-07 · what to open: a safety report (default), an authority file, or a MOC
        const { intent } = await classifyIntent(db, p.id, text, thread);
        let card: unknown; let what: string;
        if (intent === "authority") { const { d, types } = await draftAuthority(db, p.id, entities, thread, text); card = authorityCard(d, entities, types, tref, p.display_name); what = "Authority file — draft"; }
        else if (intent === "moc") { const d = await draftMoc(db, p.id, entities, thread, text); card = mocCard(d, entities, tref, p.display_name); what = "Management of change — draft"; }
        else {
          const d = await draftReport(db, p.id, entities, thread, text);
          if (!d.occurrence) { await sendText(ref, `${p.display_name.split(" ")[0]}, I read the thread but found no safety occurrence to report${d.reason ? ` — ${d.reason}` : ""}. Tell me what to open (a report, an authority file, a MOC) or describe the event, and mention me again.`); return json({}); }
          card = draftCard(d, entities, tref, p.display_name); what = "Safety report — draft";
        }
        // the draft goes to the person's personal chat; the thread only gets a one-liner
        const priv = await ensureConversation(db, { id: p.id, email: p.email });
        if (priv) { await sendCard(priv, card, what); await sendText(ref, `${p.display_name.split(" ")[0]}, I sent you the draft privately (${what.replace(" — draft", "").toLowerCase()}) — check it in our chat and open it in S.A.M. from there.`); }
        else await sendCard(ref, card, what);
      } catch (e) { await sendCard(ref, infoCard("Draft failed", e instanceof Error ? e.message.slice(0, 200) : "Unknown error")); }
      return json({});
    }
    // TMS-05 · files sent in the personal chat: kept, then "which item is this the evidence of?"
    const files = (a.attachments ?? []).filter((x) => x.contentType === "application/vnd.microsoft.teams.file.download.info" || /^image\//.test(x.contentType));
    if (files.length) {
      const { files: saved, errors } = await saveIncomingFiles(db, p.id, files, text);
      const tasks = saved.length ? await attachableTasks(db, p) : [];
      if (saved.length && !tasks.length) { for (const f of saved) await discardFile(db, p.id, f.id); await sendCard(ref, infoCard("Nothing to attach it to", "You have no open safety action or authority file in S.A.M. Add the document from the app once the item exists.", "/home/tasks")); }
      for (const f of saved) if (tasks.length) await sendCard(ref, attachCard(f, tasks), `Evidence: ${f.name}`);
      if (errors.length) await sendCard(ref, infoCard("Not kept", errors.join("\n")));
      return json({});
    }
    // personal chat: list what waits for the person, as cards (up to 5), whatever the text says
    const { data: all } = await db.from("tasks").select("*").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(300);
    const posts = new Set(p.roles.map(basePost));
    const mine = ((all ?? []) as TaskRow[]).filter((t) => t.owner_person ? t.owner_person === p.id : t.owner_role ? posts.has(basePost(t.owner_role)) : false).slice(0, 5);
    if (!mine.length) { await sendCard(ref, infoCard("Nothing waiting for you", "Your Inbox is empty. I will write here as soon as something needs you.", "/home/tasks")); return json({}); }
    await sendCard(ref, infoCard(`${mine.length} item${mine.length > 1 ? "s" : ""} waiting for you`, "Answer with the buttons, or open S.A.M.", "/home/tasks"));
    for (const t of mine) {
      const r = await sendCard(ref, await cardFor(db, t), t.title);
      if (r.ok && r.id) await db.from("teams_cards").upsert({ task_id: t.id, person_id: p.id, conversation_id: ref.conversation_id, service_url: ref.service_url, activity_id: r.id, card_kind: "task", updated_at: null }, { onConflict: "task_id,person_id" });
    }
    return json({});
  }
  return json({});
}

/** Answers on an authority-file task go to the file's journal (append-only, "via Teams"). */
async function journal(db: ReturnType<typeof supabaseAdmin>, task: TaskRow & { ref_id?: string | null }, who: string, note: string) {
  const refId = (task as { ref_id?: string | null }).ref_id;
  if (!refId || !(task.kind === "authority" || task.kind === "authority_followup")) return;
  await db.from("authority_file_events").insert({ file_id: refId, kind: "reply", who, note, meta: { task: task.id, via: "teams" } });
}
/** "Done" on "Prepare the dossier" by its owner hands the file over to Compliance (the same move as in S.A.M.). */
async function handoverIfDraft(db: ReturnType<typeof supabaseAdmin>, task: TaskRow & { ref_id?: string | null }, p: { id: string; display_name: string }) {
  const refId = (task as { ref_id?: string | null }).ref_id;
  if (!refId || task.kind !== "authority" || !/^Prepare the dossier/.test(task.title)) return;
  const { data } = await db.from("authority_files").select("*").eq("id", refId).maybeSingle();
  const f = data as AuthorityFile | null;
  if (!f || f.stage !== "draft") return;
  await db.from("authority_files").update({ stage: "compliance", updated_at: now() }).eq("id", f.id);
  await db.from("authority_file_events").insert({ file_id: f.id, kind: "stage", who: p.display_name, actor: p.id, note: "Handed over to Compliance (via Teams)", meta: { from: "draft", to: "compliance", via: "teams" } });
  await syncTasks(db, { ...f, stage: "compliance" });
}
