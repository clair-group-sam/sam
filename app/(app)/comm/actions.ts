"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSession, basePost, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { peopleFor, resolveReaders } from "@/lib/audience";
import { sendMail } from "@/lib/graph";
import { ENT } from "@/lib/nav";

/* COM · Communications outside the bot (UX-03 §8, COM-01): a message to an audience of the entity (all staff, posts, people),
 * delivered as an Inbox item (and so a personal Teams card) + an e-mail; each recipient acknowledges; read tracking per person. */
const db = () => supabaseAdmin();
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function mayWriteComm(s: Session): Promise<boolean> {
  return s.role === "cmm" || s.role === "np" || s.roles.map(basePost).some((r) => ["AM", "CMM", "SM", "SUPERADMIN"].includes(r));
}
async function me(): Promise<Session> { const s = await getSession(); if (!s) redirect("/login"); if (!(await mayWriteComm(s))) throw new Error("Your post cannot send communications."); return s; }
const KINDS = ["information", "instruction", "safety", "urgent"];

/** Draft (new or edited). The audience is a list of tokens: ALL, ROLE:<post>, PERSON:<id>. */
export async function saveComm(fd: FormData) {
  const s = await me();
  const id = String(fd.get("id") ?? "");
  const entity = String(fd.get("entity") ?? "");
  if (!entity || (!s.group && !s.entities.includes(entity))) throw new Error("Pick an entity in your scope.");
  const title = String(fd.get("title") ?? "").trim(), body = String(fd.get("body") ?? "").trim();
  if (!title || !body) throw new Error("A title and a message are required.");
  const audience = fd.getAll("audience").map(String).filter(Boolean);
  const kind = String(fd.get("kind") ?? "information");
  const row = { entity, title: title.slice(0, 200), body: body.slice(0, 20_000), kind: KINDS.includes(kind) ? kind : "information", audience: audience.length ? audience : ["ALL"],
    require_ack: fd.get("require_ack") === "on", email: fd.get("email") === "on", due: String(fd.get("due") ?? "") || null };
  let cid = id;
  if (id) {
    const { data: cur } = await db().from("communications").select("status,entity").eq("id", id).maybeSingle();
    if ((cur as { status: string } | null)?.status !== "draft") throw new Error("A sent communication cannot be edited.");
    await db().from("communications").update(row).eq("id", id);
  } else {
    const { data, error } = await db().from("communications").insert({ ...row, created_by: s.person?.id ?? null }).select("id").single();
    if (error) throw new Error(error.message); cid = (data as { id: string }).id;
  }
  revalidatePath("/comm/camp");
  if (fd.get("send") === "1") return sendComm(cid);
  redirect(`/comm/camp?c=${cid}`);
}

/** Send: resolve the audience now, one Inbox item per recipient (Teams card by the usual sweep), one e-mail (Bcc). */
async function sendComm(id: string) {
  const s = await me();
  const { data: c } = await db().from("communications").select("*").eq("id", id).maybeSingle();
  const com = c as { id: string; entity: string; title: string; body: string; kind: string; audience: string[]; require_ack: boolean; email: boolean; due: string | null; status: string } | null;
  if (!com || com.status !== "draft") throw new Error("Already sent.");
  if (!s.group && !s.entities.includes(com.entity)) throw new Error("Out of your scope.");
  const people = await peopleFor(db(), com.entity);
  const readers = resolveReaders(people, com.entity, com.audience);
  if (!readers.length) throw new Error("Nobody matches this audience: check the posts or people chosen.");
  const link = `/comm/camp?c=${com.id}`;
  await db().from("communication_recipients").upsert(readers.map((r) => ({ communication_id: com.id, person_id: r.id })), { onConflict: "communication_id,person_id" });
  await db().from("tasks").insert(readers.map((r) => ({ entity: com.entity, kind: "communication", title: `${com.kind === "urgent" ? "Urgent: " : ""}${com.title}`.slice(0, 200),
    detail: com.require_ack ? "Read the message and acknowledge it in S.A.M." : "Read the message.", due: com.require_ack ? com.due : null, owner_person: r.id, status: "open", link, ref_id: com.id })));
  let emailed = 0, emailStatus = "not sent";
  if (com.email) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const ent = ENT[com.entity]?.name ?? com.entity;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0d2a3f;max-width:620px">
<p style="font-size:12.5px;color:#5b7183;margin:0 0 6px">${esc(ent)}, ${esc(com.kind)} from ${esc(s.name)}</p>
<h2 style="margin:0 0 10px">${esc(com.title)}</h2>
<div style="white-space:pre-wrap;line-height:1.5">${esc(com.body)}</div>
<p style="margin:18px 0"><a href="${origin}${link}" style="background:#0d2a3f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">${com.require_ack ? "Open and acknowledge in S.A.M." : "Open in S.A.M."}</a></p>
${com.require_ack && com.due ? `<p style="font-size:12.5px;color:#5b7183">Please acknowledge by ${com.due.split("-").reverse().join("/")}.</p>` : ""}</div>`;
    const m = await sendMail({ bcc: readers.map((r) => r.email ?? "").filter(Boolean), subject: `[S.A.M.] ${ent}: ${com.title}`, html });
    emailed = m.sent; emailStatus = m.ok ? (m.sent ? "sent" : "no address") : (m.error ?? "failed");
  }
  await db().from("communications").update({ status: "sent", sent_at: new Date().toISOString(), sent_by: s.person?.id ?? null, recipients: readers.length, emailed, email_status: emailStatus }).eq("id", com.id);
  await db().from("audit_log").insert({ actor: s.person?.id ?? null, entity: com.entity, object_type: "communication", object_id: com.id, action: "communication_sent", after: { recipients: readers.length, emailed, email: emailStatus, audience: com.audience } });
  revalidatePath("/comm/camp"); revalidatePath("/comm/track"); revalidatePath("/home/tasks");
  redirect(`/comm/camp?c=${com.id}`);
}

/** The recipient opens or acknowledges: recorded once, the Inbox item closes on acknowledgement. */
export async function acknowledgeComm(fd: FormData) {
  const s = await getSession(); if (!s?.person) redirect("/login");
  const id = String(fd.get("id") ?? "");
  const now = new Date().toISOString();
  await db().from("communication_recipients").update({ acknowledged_at: now, read_at: now, via: "app" }).eq("communication_id", id).eq("person_id", s.person.id).is("acknowledged_at", null);
  await db().from("tasks").update({ status: "done" }).eq("kind", "communication").eq("ref_id", id).eq("owner_person", s.person.id).eq("status", "open");
  revalidatePath("/comm/camp"); revalidatePath("/comm/track"); revalidatePath("/home/tasks");
  redirect(`/comm/camp?c=${id}`);
}

export async function archiveComm(fd: FormData) {
  const s = await me(); const id = String(fd.get("id") ?? "");
  const { data: c } = await db().from("communications").select("entity,status").eq("id", id).maybeSingle();
  const com = c as { entity: string; status: string } | null;
  if (!com || (!s.group && !s.entities.includes(com.entity))) throw new Error("Out of your scope.");
  if (com.status === "draft") await db().from("communications").delete().eq("id", id);
  else { await db().from("communications").update({ status: "archived" }).eq("id", id); await db().from("tasks").update({ status: "superseded" }).eq("kind", "communication").eq("ref_id", id).eq("status", "open"); }
  revalidatePath("/comm/camp"); redirect("/comm/camp");
}

/** Mark as read when a recipient opens it (no acknowledgement). Called from the page render. */
export async function markRead(id: string, personId: string) {
  await db().from("communication_recipients").update({ read_at: new Date().toISOString() }).eq("communication_id", id).eq("person_id", personId).is("read_at", null);
  const { data: c } = await db().from("communications").select("require_ack").eq("id", id).maybeSingle();
  if (c && !(c as { require_ack: boolean }).require_ack) await db().from("tasks").update({ status: "done" }).eq("kind", "communication").eq("ref_id", id).eq("owner_person", personId).eq("status", "open");
}
