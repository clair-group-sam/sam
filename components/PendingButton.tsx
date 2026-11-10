"use client";
import { useFormStatus } from "react-dom";

/* 10/11 · a submit button that shows S.A.M. at work (Guillaume: « on devrait voir que le système mouline »). With name/value, only the clicked one spins. */
export function PendingButton({ label, busy = "S.A.M. is reading…", name, value, primary = false, disabled = false, title }: { label: string; busy?: string; name?: string; value?: string; primary?: boolean; disabled?: boolean; title?: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} title={title} disabled={disabled || pending} aria-busy={mine || undefined} className={"btn" + (primary ? " primary" : "") + (mine ? " busy" : "")}>
      {mine ? <><span className="spin" aria-hidden="true" /> {busy}</> : label}
    </button>
  );
}
