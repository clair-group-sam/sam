import { ENT } from "@/lib/nav";

/** Whose manual is this? Always shown at the top of a manual, its editor and its preview (several entities share manual codes). */
export default function EntityBand({ entity, current, multi }: { entity: string; current: string; multi: boolean }) {
  const e = ENT[entity];
  const other = current !== "ALL" && current !== entity;
  return (
    <div className={"entband " + entity}>
      <b>{e?.name ?? entity}</b><span>{entity} · {e?.qual} · {e?.auth}</span>
      {other && <em>You are working on {ENT[current]?.name ?? current}: this manual belongs to {e?.name ?? entity}.</em>}
      {!other && multi && <em className="mute">You have access to several entities — check that this is the one you need.</em>}
    </div>
  );
}
