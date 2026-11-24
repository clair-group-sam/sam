"use client";
import { useEffect, useState } from "react";
import { SAM_BUSY_ART } from "@/components/SamBusyArt";

/** S.A.M. at work: a small isometric machine with one turning part while an AI call runs, by entity. A propeller nose for the
 *  flight school (ASFFR), a turbofan for the air operators (ASJMT, ASJFR, and the Group view), a flat-four piston engine on
 *  its stand for maintenance (ASTFR). Drawn with the Anatomy kit (components/SamBusyArt.ts is generated); still under reduced motion. */
const KIND: Record<string, "prop" | "fan" | "gear"> = { ASFFR: "prop", ASJMT: "fan", ASJFR: "fan", ASTFR: "gear" };
export default function SamBusy({ entity, size = 22 }: { entity?: string | null; size?: number }) {
  const [ent, setEnt] = useState(entity ?? "");
  useEffect(() => { setEnt(entity ?? document.querySelector(".shellrow")?.getAttribute("data-ent") ?? ""); }, [entity]);
  return <svg className="sb" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SAM_BUSY_ART[KIND[ent] ?? "fan"] }} />;
}
