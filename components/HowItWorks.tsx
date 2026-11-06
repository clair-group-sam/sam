"use client";
import { useEffect, useState } from "react";

/* FB-015 · explanatory boxes shown open the first time, folded afterwards; the choice is remembered per browser (a convenience, nothing more). */
export function HowItWorks({ id, children }: { id: string; children: React.ReactNode }) {
  const key = `sam.help.${id}`;
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(key) === "0") setOpen(false); } catch { /* storage unavailable: stays open */ } }, [key]);
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ } };
  return (
    <div className="mb-5">
      <button type="button" className="mini" onClick={toggle} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--slate6)", display: "flex", alignItems: "center", gap: 6 }} aria-expanded={open}>
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span><b>How it works</b>{!open && <span>· show</span>}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
