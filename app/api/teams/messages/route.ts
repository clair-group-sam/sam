import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { basePost } from "@/lib/session";
import { infoCard, personFor, sendCard, taskCard, teamsConfigured, verifyBotJwt, type TaskRow } from "@/lib/teams";
import { syncTasks, type AuthorityFile } from "@/lib/authority";

// TMS-01 · the bot's messaging endpoint (Azure Bot → here). Three kinds of activity: the person opens the bot (install),
// writes to it, or presses a button on a card (Universal Action). Every answer is written in S.A.M. "via Teams".
export const maxDuration = 25;

type Activity = {
  type: string; id?: string; name?: string; text?: string; serviceUrl: string; channelId?: string;
  from: { id: string; name?: string; aadObjectId?: string }; recipient?: { id: string };
  conversation: { id: string; conversationType?: string; tenantId?: string };
  membersAdded?: { id: string; aadObjectId?: string }[];
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
  if (!jwt.ok) return new Response(`unauthorized: ${jwt.reason}`, { status: 401 });
  const a = (await req.json()) as Activity;
  const db = supabaseAdmin();
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
      if (task.status !== "open") return cardResponse(taskCard(task, { answered: task.answer === "not yet" ? "not_yet" : "done", by: p.display_name, at: hhmm(), comment: task.answer }));
      if (verb === "task_not_yet" && !comment) return msgResponse("A short comment is needed with “Not yet” (what is missing, or when).");
      await db.from("teams_inbound").insert({ person_id: p.id, aad_object_id: a.from.aadObjectId ?? null, kind: "action", verb, task_id: task.id, text: comment || null, meta: { title: task.title } });
      if (verb === "task_done") {
        await db.from("tasks").update({ status: "done", answered_via: "teams", answered_at: now(), answer: comment || null }).eq("id", task.id);
        await journal(db, task, p.display_name, `Done via Teams${comment ? `: ${comment}` : ""}`);
        await handoverIfDraft(db, task, p);
      } else {
        await db.from("tasks").update({ answered_via: "teams", answered_at: now(), answer: comment, detail: `${task.detail ? task.detail + " — " : ""}Not yet (${p.display_name.split(" ")[0]}): ${comment}` }).eq("id", task.id);
        await journal(db, task, p.display_name, `Not yet (via Teams): ${comment}`);
      }
      await db.from("audit_log").insert({ actor: p.id, entity: task.entity, object_type: "task", object_id: task.id, action: verb, after: { via: "teams", comment } });
      return cardResponse(taskCard(task, { answered: verb === "task_done" ? "done" : "not_yet", by: p.display_name, at: hhmm(), comment: comment || null }));
    }
    return msgResponse("Unknown action.");
  }

  // 3 · a message to the bot
  if (a.type === "message") {
    const text = (a.text ?? "").replace(/<at>.*?<\/at>/g, "").trim();
    const p = await personFor(db, a.from, ref, a.conversation.tenantId);
    await db.from("teams_inbound").insert({ person_id: p?.id ?? null, aad_object_id: a.from.aadObjectId ?? null, kind: "message", text, meta: { conversation: a.conversation.id, type: a.conversation.conversationType ?? "personal" } });
    if (!p) { await sendCard(ref, infoCard("Not attached yet", "Your Teams account is not attached to a person in S.A.M. — ask the Compliance department, then write to me again.")); return json({}); }
    if (!personal) { await sendCard(ref, infoCard("Soon", "Drafting a report from a conversation (@S.A.M.) arrives in the next iteration. For now I work in our personal chat: write “tasks” there.")); return json({}); }
    // personal chat: list what waits for the person, as cards (up to 5), whatever the text says
    const { data: all } = await db.from("tasks").select("*").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(300);
    const posts = new Set(p.roles.map(basePost));
    const mine = ((all ?? []) as TaskRow[]).filter((t) => t.owner_person ? t.owner_person === p.id : t.owner_role ? posts.has(basePost(t.owner_role)) : false).slice(0, 5);
    if (!mine.length) { await sendCard(ref, infoCard("Nothing waiting for you", "Your Inbox is empty. I will write here as soon as something needs you.", "/home/tasks")); return json({}); }
    await sendCard(ref, infoCard(`${mine.length} item${mine.length > 1 ? "s" : ""} waiting for you`, "Answer with the buttons, or open S.A.M.", "/home/tasks"));
    for (const t of mine) { const r = await sendCard(ref, taskCard(t), t.title); if (r.ok && r.id && !t.teams) await db.from("tasks").update({ teams: { conversation_id: ref.conversation_id, service_url: ref.service_url, activity_id: r.id } }).eq("id", t.id); }
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
