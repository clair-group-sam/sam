import Link from "next/link";
import { PageHeader } from "@/components/Page";

/* FB-022 · a S.A.M. page instead of the raw Next.js 404, inside the shell (menus, entity, search stay available). */
export default function NotFound() {
  return (
    <>
      <PageHeader eyebrow="S.A.M." title="Nothing here" sub="This address does not match any page or object — it may have been renamed, closed, or belong to another entity." />
      <section className="card" style={{ maxWidth: 640 }}>
        <div className="cb">
          <p className="mini mb-3">Where you probably wanted to go:</p>
          <div className="flex gap-2 flex-wrap">
            <Link href="/home/tasks" className="btn primary">Inbox</Link>
            <Link href="/docs/lib" className="btn">Documents</Link>
            <Link href="/comp/audits" className="btn">Audits</Link>
            <Link href="/safe/reports" className="btn">Safety reports</Link>
            <Link href="/proj/boards" className="btn">Projects</Link>
          </div>
          <p className="mini mt-3">If the object exists in another entity, switch entity in the top bar: addresses are the same, the data is not.</p>
        </div>
      </section>
    </>
  );
}
