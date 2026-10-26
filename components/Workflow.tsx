import Link from "next/link";
import { STEPS } from "@/lib/docs";
import type { Transition } from "@/lib/revisions";
import { moveStep } from "@/app/(app)/docs/editor/[rev]/actions";

/** What the workflow card needs to know about one step: who does it, when it was done, and whether it applies. */
export type StepRow = { step: string; label: string; who: string; detail?: string; skipped?: string; done?: { at: string; by: string | null } | null; /** validated by Compliance: shown with a lock to the others */ locked?: boolean };
export type WorkflowProps = {
  revisionId: string; current: string; rows: StepRow[]; transitions: Transition[];
  /** Transition to "published" blocked while the authority's return is missing (DOC-03). */
  blockedNote?: string | null;
  /** Where the route decision is made (Compliance card below) — shown when the route is still open at that step. */
  routeHint?: string | null;
  /** FB-012 · transitions that cannot be taken yet, with the reason shown instead of an active button (keyed by target step). */
  blocked?: Record<string, string>;
};

/**
 * DOC-09 workflow for a regulated manual: every step in order, the one to do now with its action, the next ones greyed with
 * the person or department expected. Steps that do not apply (no signature, no authority route) are shown as "not required".
 */
export default function Workflow({ revisionId, current, rows, transitions, blockedNote, routeHint, blocked = {} }: WorkflowProps) {
  const idx = STEPS.indexOf(current);
  // the "now" row is the first row after the current step that is not skipped
  const nowRow = rows.find((r) => STEPS.indexOf(r.step) > idx && !r.skipped) ?? null;
  const back = transitions.filter((t) => STEPS.indexOf(t.to) <= idx);
  return (
    <div className="wf">
      {rows.map((r) => {
        const i = STEPS.indexOf(r.step);
        const state = r.skipped ? "skip" : i <= idx ? "done" : r.step === nowRow?.step ? "now" : "next";
        const forward = state === "now" ? transitions.filter((t) => t.to === r.step) : [];
        return (
          <div key={r.step} className={"wfrow " + state + (r.locked && state !== "done" ? " locked" : "")}>
            <div className="wfdot"><i />{state === "done" ? "✓" : ""}</div>
            <div className="wfbody">
              <div className="wfhead"><b>{r.label}</b>{r.locked && state !== "done" && <span className="lockpill">Compliance</span>}<span className="mini">{r.skipped ?? r.who}</span></div>
              {r.detail && state !== "skip" && <div className="mini">{r.detail}</div>}
              {state === "done" && r.done && <div className="mini">done {r.done.at.slice(0, 10)}{r.done.by ? ` · ${r.done.by}` : ""}</div>}
              {state === "now" && !forward.length && <div className="mini">{routeHint ?? `Waiting for ${r.who}.`}</div>}
              {state === "now" && forward.map((t) => (
                <form key={t.to} action={moveStep} className="wfact">
                  <input type="hidden" name="revision_id" value={revisionId} /><input type="hidden" name="to" value={t.to} />
                  <div className="flex items-center gap-3 flex-wrap">
                    <button className="btn primary" type="submit" disabled={(!!blockedNote && t.to === "published") || !!blocked[t.to]}>{t.label}</button>
                    <span className={"mini" + (blocked[t.to] ? " red" : "")}>{blocked[t.to] ? blocked[t.to] : blockedNote && t.to === "published" ? blockedNote : t.to === "published" ? `${t.note ?? ""} The update notice goes to every reader of the manual.` : t.note}</span>
                  </div>
                  {(t.to === "with_civil_aviation" || t.from === "with_civil_aviation") && <input name="note" className="inp mt-2" placeholder="Note for the authority exchange (what was sent / received)…" />}
                </form>
              ))}
            </div>
          </div>
        );
      })}
      {back.length > 0 && (
        <div className="wfback">
          {back.map((t) => (
            <form key={t.to} action={moveStep} className="flex items-center gap-3 flex-wrap">
              <input type="hidden" name="revision_id" value={revisionId} /><input type="hidden" name="to" value={t.to} />
              <button className="btn" type="submit">{t.label}</button><span className="mini">{t.note}</span>
              {t.from === "with_civil_aviation" && <input name="note" className="inp" style={{ maxWidth: 360 }} placeholder="The authority's remarks…" />}
            </form>
          ))}
        </div>
      )}
      <p className="mini mt-2"><Link className="underline" href="/docs/drafts">Who does what</Link> (DOC-09).</p>
    </div>
  );
}
