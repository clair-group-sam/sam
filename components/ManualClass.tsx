import { ENT } from "@/lib/nav";

/** Regulated manual or internal document — shown under the manual's name; changed only by Compliance, in a draft (editor). */
export default function ManualClass({ internal, entity, action }: { internal: boolean; entity: string; action?: React.ReactNode }) {
  const auth = ENT[entity]?.auth ?? "the authority";
  return (
    <span className="mclass">
      {internal
        ? <span className="pill">Internal document</span>
        : <span className="pill blue">Regulated manual</span>}
      <span className="mini">{internal ? "no authority route — published by its author after SAM's review" : `every revision is approved by or notified to ${auth}`}</span>
      {action}
    </span>
  );
}
