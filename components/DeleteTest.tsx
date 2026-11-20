import { deleteTestObject } from "@/lib/test-delete";

/** Super admin: removes a test object for good (a report, a manual, an ERP exercise whose title says "test"). Shown by the page
 *  only when the object is test data and the person is a super admin in their own view. */
export function DeleteTest({ kind, id, what }: { kind: "report" | "manual" | "exercise"; id: string; what: string }) {
  return (
    <details className="mt-4"><summary className="mini underline" style={{ cursor: "pointer" }}>Delete this test {kind} (super admin)</summary>
      <form action={deleteTestObject} className="card cb mt-2 flex flex-wrap gap-3 items-center"><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
        <span><b>{what}</b> is removed for good, with what was written in it. It no longer counts in the statistics. This cannot be undone.</span>
        <label className="flex items-center gap-2"><input type="checkbox" name="confirm" required />I delete this test {kind}</label>
        <button className="btn" type="submit">Delete</button></form>
    </details>
  );
}
