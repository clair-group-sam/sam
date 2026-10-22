import type { SupabaseClient } from "@supabase/supabase-js";
import type { Manual, Revision } from "@/lib/docs";
import { ENT } from "@/lib/nav";
import { readersOf } from "@/lib/audience";
import { sendMail } from "@/lib/graph";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

/** One line on the authority status — mentioned only, no evidence attached (DOC-04). */
export function authorityLine(manual: Manual, rev: Revision & { return_received_at?: string | null }): string {
  const auth = ENT[manual.entity]?.auth ?? "the authority";
  if (rev.authority_route === "approval") return `Approved by ${auth}${rev.return_received_at ? ` on ${fr(rev.return_received_at)}` : ""}${rev.authority_ref ? ` (ref. ${rev.authority_ref})` : ""}.`;
  if (rev.authority_route === "notification") return `Notified to ${auth}${rev.authority_ref ? ` (ref. ${rev.authority_ref})` : ""}.`;
  return "No authority approval required for this revision.";
}

/**
 * DOC-04 · update notice, created only AFTER publication: a reading task in S.A.M. for everyone who must read the manual
 * (audience at the time of publication) + one e-mail (Bcc). The notice is recorded with its recipients.
 */
export async function sendUpdateNotice(db: SupabaseClient, opts: { manual: Manual; rev: Revision; origin: string; senderId: string | null; changed: { ref: string; title: string | null }[] }): Promise<{ recipients: number; emailed: number; emailStatus: string }> {
  const { manual, rev, origin, senderId, changed } = opts;
  const readers = await readersOf(db, manual);
  const link = `/docs/manual/${manual.id}?tab=changed&rev=${rev.id}`;
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const title = `Read ${manual.code} Iss ${rev.issue} Rev ${rev.rev}`;
  const detail = `${manual.title} — published ${fr(rev.published_at)}. ${authorityLine(manual, rev)}`;
  if (readers.length) {
    await db.from("tasks").update({ status: "superseded" }).eq("kind", "reading").eq("status", "open").in("owner_person", readers.map((r) => r.id)).like("link", `/docs/manual/${manual.id}%`);
    await db.from("tasks").insert(readers.map((r) => ({ entity: manual.entity, kind: "reading", title, detail, due, owner_person: r.id, status: "open", link, ref_id: rev.id })));
  }
  const ent = ENT[manual.entity]?.name ?? manual.entity;
  const subject = `[S.A.M.] ${ent} · ${manual.code} Iss ${rev.issue} Rev ${rev.rev} published — please read`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d2a36;max-width:620px">
<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6a7a88;margin:0 0 6px">${esc(ent)} · manual update</p>
<h2 style="margin:0 0 8px;color:#0d2a3f">${esc(manual.title)} — Issue ${rev.issue} Rev ${esc(rev.rev)}</h2>
<p style="margin:0 0 12px">Published on ${fr(rev.published_at)}. ${esc(authorityLine(manual, rev))}</p>
${rev.summary ? `<p style="margin:0 0 12px"><b>What changes:</b> ${esc(rev.summary)}</p>` : ""}
${changed.length ? `<p style="margin:0 0 4px"><b>Chapters revised</b></p><ul style="margin:0 0 14px;padding-left:18px">${changed.slice(0, 30).map((c) => `<li>${esc(c.ref)} ${esc(c.title ?? "")}</li>`).join("")}${changed.length > 30 ? `<li>… and ${changed.length - 30} more</li>` : ""}</ul>` : ""}
<p style="margin:18px 0"><a href="${origin}${link}" style="background:#0d2a3f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Read what changed in S.A.M.</a></p>
<p style="font-size:12px;color:#6a7a88">Please acknowledge your reading in S.A.M. within 30 days (by ${fr(due)}).</p></div>`;
  const mail = await sendMail({ bcc: readers.map((r) => r.email ?? "").filter(Boolean), subject, html });
  const emailStatus = mail.ok ? (mail.sent ? "sent" : "no address") : (mail.error ?? "failed");
  await db.from("manual_notices").insert({ revision_id: rev.id, manual_id: manual.id, entity: manual.entity, sent_by: senderId, recipients: readers.length, emailed: mail.sent, email_status: emailStatus, subject, body: html });
  return { recipients: readers.length, emailed: mail.sent, emailStatus };
}
