"use client";
import { useState } from "react";

/* FB-089 · starting the ERP is two steps: the second one says whether it is real and how many people are called out. */
export function ErpStartBar({ defaultExercise, unit }: { defaultExercise: boolean; unit: number }) {
  const [ex, setEx] = useState(defaultExercise);
  const [armed, setArmed] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <label className="flex gap-2 items-center"><input type="checkbox" name="exercise" checked={ex} onChange={(e) => { setEx(e.target.checked); setArmed(false); }} /> This is an exercise</label>
      {!armed ? <button className="btn erp" type="button" onClick={() => setArmed(true)}>Start…</button> : (
        <span className="flex items-center gap-2 flex-wrap" role="alert">
          <b style={{ color: ex ? "var(--amber-ink)" : "var(--terra)" }}>{ex ? "Exercise" : "REAL alert"}</b>
          <span className="mini">the response unit ({unit} contact{unit === 1 ? "" : "s"}) gets an Inbox item and a Teams card now, and the clocks start.</span>
          <button className="btn" type="button" onClick={() => setArmed(false)}>Cancel</button>
          <button className="btn erp" type="submit">{ex ? "Start the exercise" : "Confirm, this is real"}</button>
        </span>
      )}
    </div>
  );
}
