"use client";
import { useFormStatus } from "react-dom";

export function BrewButton({ label, primary = true }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={"btn" + (primary ? " primary" : "")} disabled={pending}>{pending ? "☕ Brewing…" : label}</button>;
}
