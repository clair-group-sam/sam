/** 24/11 (Guillaume) · an item saved without an owner: it belongs to nobody's "My domain" and its tasks reach no nominated person.
 *  Said on the record itself, right after saving, with where to set the owner. */
export default function NoOwner({ show, what, where }: { show: boolean; what: string; where: string }) {
  if (!show) return null;
  return (
    <div className="card mb-4" role="alert" style={{ borderLeft: "4px solid var(--amber, #d98a00)" }}>
      <div className="cb"><b>No owner on this {what}.</b> It appears in nobody&apos;s “My domain” and nobody but Compliance is asked to act on it. Set the owner post {where}.</div>
    </div>
  );
}
