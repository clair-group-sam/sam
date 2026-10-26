import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { STATUS } from "@/lib/safety";
import { answerQuestion } from "../reports/[id]/actions";

type Rep = { id: string; entity: string; headline: string; received_at: string; status: string; feedback: string | null; feedback_sent_at: string | null };
type Ev = { report_id: string; id: number; at: string; kind: string; note: string | null; meta: { answered?: number } | null };

/** Safety › My reports: what I sent, its status, the Safety Manager's questions (answered here) and the feedback. Never the analysis. */
export default async function MyReports() {
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data } = s.person ? await db.from("reports").select("id,entity,headline,received_at,status,feedback,feedback_sent_at").eq("reporter_person", s.person.id).order("received_at", { ascending: false }) : { data: [] };
  const reps = (data ?? []) as Rep[];
  const { data: evs } = reps.length ? await db.from("report_events").select("report_id,id,at,kind,note,meta").in("report_id", reps.map((r) => r.id)).eq("to_reporter", true).order("at") : { data: [] };
  const events = (evs ?? []) as Ev[];
  return (
    <>
      <PageHeader eyebrow="Safety · My reports" title="My reports" sub="What you reported, where it stands, and what was done with it." right={<Link href="/safe/new" className="btn primary">+ Report an event</Link>} />
      {!reps.length && <section className="card"><div className="cb">You have not sent any report yet (anonymous reports are not listed here).</div></section>}
      {reps.map((r) => {
        const ev = events.filter((e) => e.report_id === r.id);
        const answered = new Set(ev.filter((e) => e.kind === "answer").map((e) => e.meta?.answered));
        return (
          <section key={r.id} className="card mb-4">
            <div className="ch"><span><span className="mono mr-2">{r.id}</span><b>{r.headline}</b> <span className={"ent " + r.entity}>{r.entity}</span></span><span className={"pill " + (STATUS[r.status]?.[1] ?? "")}>{STATUS[r.status]?.[0] ?? r.status}</span></div>
            <div className="cb">
              <ul className="journal">
                {ev.map((e) => (
                  <li key={e.id}><span className="mini mono mr-2">{new Date(e.at).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {e.kind === "question" ? <><b>Question from the Safety Manager:</b> {e.note}
                      {!answered.has(e.id) && <form action={answerQuestion} className="flex gap-2 mt-2"><input type="hidden" name="report" value={r.id} /><input type="hidden" name="q" value={e.id} /><input name="answer" className="inp flex-1" placeholder="Your answer" required /><button className="btn primary">Answer</button></form>}</>
                      : e.kind === "answer" ? <><b>Your answer:</b> {e.note}</> : e.kind === "feedback" ? <><b>Feedback:</b> {e.note}</> : <>{e.note}</>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </>
  );
}
