"use client";
import { useEffect } from "react";

/* FB-121 · what the user sees when the server refuses something: the reason, in the page, with a way back.
 * The reason comes in error.digest (lib/fail.ts); anything else is an unexpected fault and shows its reference. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const d = error.digest ?? "";
  const known = d.startsWith("SAM:");
  return (
    <section className="card" style={{ maxWidth: 680, boxShadow: "inset 0 3px 0 var(--red)" }} role="alert">
      <div className="ch"><b>{known ? "This was not saved" : "Something went wrong"}</b></div>
      <div className="cb">
        <p style={{ fontSize: 15 }}>{known ? d.slice(4) : "S.A.M. could not finish this. Nothing was changed by this last step."}</p>
        {!known && d && <p className="mini mt-2">Reference for the support: <span className="mono">{d}</span></p>}
        <p className="mini mt-3">{known ? "Go back to the form, correct it and send it again. What you had typed may have to be entered again." : "Go back and try again; if it happens again, send the reference above to Compliance."}</p>
        <div className="flex gap-2 mt-3">
          <button type="button" className="btn primary" onClick={() => reset()}>Back to the page</button>
          <button type="button" className="btn" onClick={() => history.back()}>Previous page</button>
        </div>
      </div>
    </section>
  );
}
