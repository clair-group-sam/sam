import { ENT } from "@/lib/nav";
import SwitchEntity from "@/components/SwitchEntity";

/**
 * Whose object is this? Shown at the top of a manual, a project, a CAA application… (several entities share codes).
 * When the working entity differs, says so and offers to switch — never switches by itself.
 */
export default function EntityBand({ entity, current, multi, what = "manual" }: { entity: string; current: string; multi: boolean; what?: string }) {
  const e = ENT[entity];
  const other = current !== "ALL" && current !== entity;
  return (
    <div className={"entband " + entity}>
      <b>{e?.name ?? entity}</b><span>{entity} · {e?.qual} · {e?.auth}</span>
      {other && <><em>You are working in {ENT[current]?.name ?? current} — this {what} belongs to {e?.name ?? entity}.</em><SwitchEntity to={entity} label={`Switch to ${e?.name ?? entity}`} className="btn" /></>}
      {!other && current === "ALL" && multi && <em className="mute">Group view — this {what} belongs to {e?.name ?? entity}.</em>}
    </div>
  );
}
