"use client";
import { useState } from "react";
import Link from "next/link";
import { proposePrecisions, submitReport, type NewReport } from "@/app/(app)/safe/new/actions";
import { PHASES, type Precision } from "@/lib/safety-shared";

const DK = "I don't know";
type Step = "write" | "precise" | "sent";

/** SAF-01 New report: the reporter writes; on Send, SAM proposes a few factual precisions as form fields (never a chat); "Send as written" is always possible. */
export default function ReportForm({ entities, defaultEntity }: { entities: { code: string; name: string }[]; defaultEntity: string }) {
  const [r, setR] = useState<NewReport>({ entity: defaultEntity, headline: "", narrative: "", event_date: new Date().toISOString().slice(0, 10), event_time_utc: "", aircraft: "", flight_ref: "", phase: "", location: "", contributing: "", anonymous: false, language: "", precisions: {} });
  const [step, setStep] = useState<Step>("write");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Precision[]>([]);
  const [sentId, setSentId] = useState<string | null>(null);
  const set = (p: Partial<NewReport>) => setR((x) => ({ ...x, ...p }));
  const setPrec = (k: string, v: string) => setR((x) => ({ ...x, precisions: { ...x.precisions, [k]: v } }));
  const ready = r.headline.trim().length > 0 && r.narrative.trim().length >= 10;

  async function next() {
    setBusy(true); setErr(null);
    try {
      const known = { date: r.event_date, time_utc: r.event_time_utc, aircraft: r.aircraft, flight: r.flight_ref, phase: r.phase, location: r.location };
      const p = await proposePrecisions({ narrative: r.headline + "\n" + r.narrative, known });
      setItems(p.items); set({ language: p.lang }); setStep("precise");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function send(withPrecisions: boolean) {
    setBusy(true); setErr(null);
    const res = await submitReport({ ...r, precisions: withPrecisions ? r.precisions : {} });
    setBusy(false);
    if (res.ok) { setSentId(res.id); setStep("sent"); } else setErr(res.error);
  }

  if (step === "sent") return (
    <section className="card">
      <div className="cb">
        <h2 className="text-[20px] font-bold mb-2">Thank you — report {sentId} received</h2>
        <p>The Safety Manager has it now. You will see its status and any question in <Link className="underline" href="/safe/mine">My reports</Link>{r.anonymous ? " — as you sent it anonymously, keep the number " + sentId + " if you want to follow it up" : ""}.</p>
        <p className="mini mt-2">Reports are used to improve safety, never to blame (Regulation (EU) 376/2014, just culture). You will receive feedback on what was done with it.</p>
        <div className="mt-4 flex gap-2"><Link href="/safe/mine" className="btn primary">My reports</Link><button className="btn" onClick={() => { setStep("write"); setR((x) => ({ ...x, headline: "", narrative: "", contributing: "", precisions: {} })); }}>Report another event</button></div>
      </div>
    </section>
  );

  return (
    <div className="rep-grid">
      <section className="card">
        <div className="ch"><span className="eyebrow">What happened</span><span className="mini">in your own words, in your language</span></div>
        <div className="cb">
          <label className="block mb-3"><span className="eyebrow">In one line</span><input className="inp w-full" value={r.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="e.g. TCAS RA on approach LFMN" disabled={step !== "write"} /></label>
          <label className="block mb-3"><span className="eyebrow">Your account</span><textarea className="inp w-full rep-text" value={r.narrative} onChange={(e) => set({ narrative: e.target.value })} placeholder="What happened, as you saw it." disabled={step !== "write"} /></label>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <label><span className="eyebrow">Entity</span><select className="inp w-full" value={r.entity} onChange={(e) => set({ entity: e.target.value })} disabled={step !== "write"}>{entities.map((e) => <option key={e.code} value={e.code}>{e.code} — {e.name}</option>)}</select></label>
            <label><span className="eyebrow">Date</span><input type="date" className="inp w-full" value={r.event_date} onChange={(e) => set({ event_date: e.target.value })} disabled={step !== "write"} /></label>
            <label><span className="eyebrow">Time (UTC)</span><input type="time" className="inp w-full" value={r.event_time_utc} onChange={(e) => set({ event_time_utc: e.target.value })} disabled={step !== "write"} /></label>
            <label><span className="eyebrow">Aircraft</span><input className="inp w-full" value={r.aircraft} onChange={(e) => set({ aircraft: e.target.value.toUpperCase() })} placeholder="F-HXXX / 9H-XXX" disabled={step !== "write"} /></label>
            <label><span className="eyebrow">Flight</span><input className="inp w-full" value={r.flight_ref} onChange={(e) => set({ flight_ref: e.target.value })} placeholder="flight / lesson" disabled={step !== "write"} /></label>
            <label><span className="eyebrow">Phase</span><select className="inp w-full" value={r.phase} onChange={(e) => set({ phase: e.target.value })} disabled={step !== "write"}><option value="">—</option>{PHASES.map((p) => <option key={p}>{p}</option>)}</select></label>
          </div>
          <label className="block mb-3"><span className="eyebrow">Where</span><input className="inp w-full" value={r.location} onChange={(e) => set({ location: e.target.value })} placeholder="aerodrome, stand, airspace…" disabled={step !== "write"} /></label>
          <label className="block mb-3"><span className="eyebrow">Contributing factors in your view (optional)</span><textarea className="inp w-full" rows={2} value={r.contributing} onChange={(e) => set({ contributing: e.target.value })} disabled={step !== "write"} /></label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={r.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} disabled={step !== "write"} /> Send anonymously (your name is not stored; the Safety Manager cannot ask you questions)</label>
          {step === "write" && <div className="mt-4 flex justify-end"><button className="btn primary" disabled={!ready || busy} onClick={next}>{busy ? "Reading your report…" : "Send"}</button></div>}
        </div>
      </section>

      {step === "precise" && (
        <section className="card rep-prec">
          <div className="ch"><span className="eyebrow">Before sending · {items.length} precisions would help the Safety Manager</span></div>
          <div className="cb">
            {items.map((q) => (
              <div key={q.key} className="mb-3">
                <div className="text-[13px] font-semibold mb-1">{q.label}</div>
                {q.type === "choice" && q.options?.length ? (
                  <div className="rchips">{[...q.options, DK].map((o) => <button key={o} type="button" className={"rchip" + (r.precisions[q.key] === o ? " on" : "")} onClick={() => setPrec(q.key, r.precisions[q.key] === o ? "" : o)}>{o}</button>)}</div>
                ) : (
                  <div className="flex gap-2"><input type={q.type === "time" ? "time" : "text"} className="inp flex-1" value={r.precisions[q.key] === DK ? "" : (r.precisions[q.key] ?? "")} onChange={(e) => setPrec(q.key, e.target.value)} />
                    <button type="button" className={"rchip" + (r.precisions[q.key] === DK ? " on" : "")} onClick={() => setPrec(q.key, r.precisions[q.key] === DK ? "" : DK)}>{DK}</button></div>
                )}
              </div>
            ))}
            <p className="mini mb-3">Precisions proposed automatically from your account; nothing else is kept; read by the Safety Manager.</p>
            <div className="flex gap-2 justify-end flex-wrap">
              <button className="btn" onClick={() => setStep("write")} disabled={busy}>Back to my account</button>
              <button className="btn" onClick={() => send(false)} disabled={busy}>Send as written</button>
              <button className="btn primary" onClick={() => send(true)} disabled={busy}>{busy ? "Sending…" : "Send with these precisions"}</button>
            </div>
          </div>
        </section>
      )}
      {step === "write" && (
        <aside className="card rep-help"><div className="ch"><span className="eyebrow">What happens when you send</span></div>
          <div className="cb mini">
            <p>1 · SAM may suggest 3 to 5 short factual precisions (time, phase, consequences…). Answer, say &quot;I don&apos;t know&quot;, or send as written.</p>
            <p>2 · Only your final report is stored. It goes to the Safety Manager, who acknowledges it and decides within 72 h whether it must be notified to the authority (MOR).</p>
            <p>3 · You see its status, possible questions and the feedback in My reports.</p>
            <p>Just culture: reports are used to improve safety, never to blame (EU 376/2014).</p>
          </div></aside>
      )}
      {err && <div className="mini red mt-2">{err}</div>}
    </div>
  );
}
