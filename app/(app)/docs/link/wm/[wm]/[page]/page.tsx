import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { linkIndex } from "@/lib/links";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";

/**
 * Target of a cross-reference to another document (from a manual or one of its PDFs).
 * Opens the document in S.A.M. when it is there and within the reader's scope; otherwise says why it cannot be opened.
 */
export default async function WmLink({ params }: { params: Promise<{ wm: string; page: string }> }) {
  const { wm, page } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const idx = await linkIndex(supabaseAdmin());
  const man = idx.byWm.get(wm);
  const ref = idx.pageRef.get(`${wm}:${page}`)?.ref;
  if (man && (s.group || s.entities.includes(man.entity))) redirect(`/docs/manual/${man.manualId}${ref ? `?sec=${encodeURIComponent(ref)}` : ""}`);
  return (
    <>
      <PageHeader eyebrow="Documents · link" title="This document cannot be opened" sub={man ? `${man.code} — ${man.title}` : `Referenced document #${wm}`} />
      <section className="card"><div className="cb">
        {man
          ? <p>The document belongs to <b>{ENT[man.entity]?.name ?? man.entity}</b>, which is outside your access in S.A.M. Ask Compliance if you need to read it.</p>
          : <p>The referenced document is not in S.A.M. yet (it has not been imported from the previous system). Try again later or ask Compliance.</p>}
        <Link href="/docs/lib" className="btn mt-4">Go to the library</Link>
      </div></section>
    </>
  );
}
