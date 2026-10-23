import Link from "next/link";
import { redirect } from "next/navigation";
import { basePost, getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { mayCreateManual } from "@/lib/create";
import { POSTS } from "@/lib/audience";
import { createManual, setCreators } from "./actions";

/** Library › New manual. The author becomes the owner (his post, or himself by name); internal documents are published by him after the review. */
export default async function NewManual({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!(await mayCreateManual(s))) return (<><PageHeader eyebrow="Documents · New manual" title="Not available" /><section className="card"><div className="cb">Creating a manual is reserved for Compliance, the accountable manager, nominated persons, their deputies and the people Compliance names.</div></section></>);
  const { entity: q } = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = q && ents.includes(q) ? q : s.entity !== "ALL" && ents.includes(s.entity) ? s.entity : ents[0];
  const db = supabaseAdmin();
  const { data: ms } = await db.from("manuals").select("path").eq("entity", entity);
  const folders = [...new Set(((ms ?? []) as { path: string | null }[]).map((m) => m.path).filter(Boolean) as string[])].sort();
  const myPosts = [...new Set(s.roles.map(basePost).filter((p) => POSTS.includes(p) || p.startsWith("NP")))];
  const cmm = isCmm(s);
  let people: { id: string; display_name: string; roles: string[]; can_create_manuals: boolean }[] = [];
  if (cmm) { const { data } = await db.from("people").select("id,display_name,roles,can_create_manuals").order("display_name"); people = (data ?? []) as typeof people; }

  return (
    <>
      <PageHeader eyebrow="Documents · Library" title="New manual" sub="Issue 1 Rev 00 is created as a draft; you write it in the editor." right={<Link href="/docs/lib" className="btn">‹ Library</Link>} />
      <form action={createManual} className="card mb-5">
        <div className="cb grid grid-cols-2 gap-4">
          <label><span className="eyebrow">Entity</span>
            <select name="entity" defaultValue={entity} className="inp">{ents.map((e) => <option key={e} value={e}>{e} — {ENT[e]?.name}</option>)}</select>
            <span className="mini">Folders below are those of {ENT[entity]?.name}; <Link className="underline" href={`/docs/new?entity=${ents.find((e) => e !== entity) ?? entity}`}>switch entity</Link> to see others.</span></label>
          <label><span className="eyebrow">Owner</span>
            <select name="owner" defaultValue={myPosts[0] ?? `PERSON:${s.person?.id}`} className="inp">
              {myPosts.map((p) => <option key={p} value={p}>{p} (my post — deputies included)</option>)}
              {cmm && POSTS.filter((p) => !myPosts.includes(p)).map((p) => <option key={p} value={p}>{p}</option>)}
              {s.person && <option value={`PERSON:${s.person.id}`}>Myself, by name ({s.name})</option>}
            </select></label>
          <label><span className="eyebrow">Code</span><input name="code" required className="inp" placeholder="e.g. PRO-TRAINING" /></label>
          <label><span className="eyebrow">Title</span><input name="title" required className="inp" placeholder="e.g. Training Policy" /></label>
          <label><span className="eyebrow">Folder</span>
            <select name="folder" className="inp" defaultValue=""><option value="">— choose —</option>{folders.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
          <label><span className="eyebrow">…or a new folder</span><input name="folder_new" className="inp" placeholder="e.g. 4. PROCESS MANUAL › #GLOBAL › POLICIES" /></label>
          {cmm ? (
          <label className="col-span-2 flex items-start gap-3 p-3 border border-line rounded-lg">
            <input type="checkbox" name="internal" className="mt-1" />
            <span><b>Internal document</b> — no approval by or notification to the civil aviation authority. You review it with the assistant (comments you can use or ignore) and publish it yourself. Leave unticked for a regulated manual (NP → Compliance → authority).</span>
          </label>
          ) : <p className="col-span-2 mini">The manual is created as a <b>regulated manual</b>. Compliance can make it an internal document while it is a draft.</p>}
          <label className="col-span-2"><span className="eyebrow">Chapters — one per line (“1.2 Scope” keeps its number; a plain title is numbered in order)</span>
            <textarea name="chapters" rows={7} className="inp" placeholder={"Purpose and scope\nDefinitions\nResponsibilities\nProcedure\nRecords"} /></label>
        </div>
        <div className="p-4 pt-0"><button className="btn primary" type="submit">Create and open the editor</button></div>
      </form>

      {cmm && (
        <form action={setCreators} className="card">
          <div className="ch"><span className="eyebrow">Other people allowed to create manuals</span><span className="mini">besides CMM, AM, nominated persons and deputies</span></div>
          <div className="cb">
            <div className="audgrid people mb-3">{people.filter((p) => !p.roles.map(basePost).some((r) => POSTS.includes(r) || r.startsWith("NP"))).map((p) => (
              <label key={p.id} className="audchk"><input type="checkbox" name="person" value={p.id} defaultChecked={p.can_create_manuals} /> {p.display_name}</label>))}
              {!people.length && <span className="mini">Nobody has signed in yet.</span>}</div>
            <button className="btn" type="submit">Save</button>
          </div>
        </form>
      )}
    </>
  );
}
