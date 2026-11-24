"use client";
import { useEffect, useState } from "react";

/** S.A.M. at work: a small turning mark while an AI call runs, by entity. A propeller for the flight school (ASFFR),
 *  a turbofan seen from the front for the air operators (ASJMT, ASJFR, and the Group view), a gear for maintenance (ASTFR).
 *  Line icons in the current text colour (DA v3); it stands still when the person asked for reduced motion. */
const KIND: Record<string, "prop" | "fan" | "gear"> = { ASFFR: "prop", ASJMT: "fan", ASJFR: "fan", ASTFR: "gear" };
const GEAR = "M10.20 5.24 L10.44 2.93 L13.56 2.93 L13.80 5.24 L15.51 5.94 L17.31 4.49 L19.51 6.69 L18.06 8.49 L18.76 10.20 L21.07 10.44 L21.07 13.56 L18.76 13.80 L18.06 15.51 L19.51 17.31 L17.31 19.51 L15.51 18.06 L13.80 18.76 L13.56 21.07 L10.44 21.07 L10.20 18.76 L8.49 18.06 L6.69 19.51 L4.49 17.31 L5.94 15.51 L5.24 13.80 L2.93 13.56 L2.93 10.44 L5.24 10.20 L5.94 8.49 L4.49 6.69 L6.69 4.49 L8.49 5.94Z";
export default function SamBusy({ entity, size = 15 }: { entity?: string | null; size?: number }) {
  const [ent, setEnt] = useState(entity ?? "");
  useEffect(() => { setEnt(entity ?? document.querySelector(".shellrow")?.getAttribute("data-ent") ?? ""); }, [entity]);
  const kind = KIND[ent] ?? "fan";
  return (
    <svg className={"sambusy " + kind} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "prop" && <g className="spin">{[0, 120, 240].map((a) => <path key={a} transform={`rotate(${a} 12 12)`} d="M12 11.2c-2-2.6-2-6.4 0-9.4 2 3 2 6.800 0 9.4z" />)}<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></g>}
      {kind === "fan" && <><circle cx="12" cy="12" r="10.2" /><g className="spin">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path key={a} transform={`rotate(${a} 12 12)`} d="M12.6 9.300Q15.400 6.800 13.600 2.900" strokeWidth={1.4} />)}<circle cx="12" cy="12" r="2.6" /><path d="M12 12.900a.9.9 0 1 1 .9-.9" strokeWidth={1.2} /></g></>}
      {kind === "gear" && <g className="spin"><path d={GEAR} /><circle cx="12" cy="12" r="2.8" /></g>}
    </svg>
  );
}
