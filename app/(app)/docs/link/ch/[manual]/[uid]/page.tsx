import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT } from "@/lib/nav";

/** Link made in S.A.M. to a chapter (stable chapter id): opens the chapter under its current number, or says why it cannot. */
export default async function ChapterLink({ params }: { params: Promise<{ manual: string; uid: string }> }) {
  const { manual: mid, uid } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const db = supabaseAdmin();
  const { data: m } = await db.from("manuals").select("id,entity,code,title").eq("id", mid).maybeSingle();
  const man = m as { id: string; entity: string; code: string; title: string } | null;
  if (man && (s.group || s.entities.includes(man.entity))) {
    const { data: r } = await db.from("revisions").select("id").eq("manual_id", mid).in("step", ["published", "repository"]).order("published_at", { ascending: false }).limit(1).maybeSingle();
    if (r) {
      const { data: sec } = await db.from("revision_sections").select("ref,deleted_at").eq("revision_id", r.id).eq("body->>uid", uid).maybeSingle();
      const x = sec as { ref: string; deleted_at: string | null } | null;
      if (x && !x.deleted_at) redirect(`/docs/manual/${mid}?sec=${encodeURIComponent(x.ref)}`);
    }
  }
  return (
    <>
      <PageHeader eyebrow="Documents · link" title="This chapter cannot be opened" sub={man ? `${man.code} — ${man.title}` : "Referenced document"} />
      <section className="card"><div className="cb">
        {!man ? <p>The referenced manual no longer exists in S.A.M.</p>
          : !(s.group || s.entities.includes(man.entity)) ? <p>The manual belongs to <b>{ENT[man.entity]?.name ?? man.entity}</b>, which is outside your access in S.A.M. Ask Compliance if you need to read it.</p>
          : <p>The chapter is not in the current published revision of this manual (it may have been deleted, or exist only in a draft). <Link className="underline" href={`/docs/manual/${man.id}`}>Open the manual</Link>.</p>}
        <Link href="/docs/lib" className="btn mt-4">Go to the library</Link>
      </div></section>
    </>
  );
}
