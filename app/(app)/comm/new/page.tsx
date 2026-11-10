import { AudienceCount } from "@/components/AudienceCount";
import { basePost } from "@/lib/session";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { POSTS, peopleFor } from "@/lib/audience";
import { mayWriteComm, saveComm } from "../actions";

/* COM · compose a communication: entity, audience (all staff, posts, people), kind, acknowledgement, e-mail. Save as draft or send. */
export default async function NewCommunication({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  if (!(await mayWriteComm(s))) redirect("/comm/camp");
  const sp = await searchParams;
  const db = supabaseAdmin();
  const { data: d } = sp.id ? await db.from("communications").select("*").eq("id", sp.id).eq("status", "draft").maybeSingle() : { data: null };
  const draft = d as { id: string; entity: string; title: string; body: string; kind: string; audience: string[]; require_ack: boolean; email: boolean; due: string | null } | null;
  const ents = (s.entity === "ALL" ? ENTS4 : [s.entity]).filter((e) => s.group || s.entities.includes(e));
  const entity = draft?.entity ?? ents[0];
  const people = await peopleFor(db, entity);
  const { data: p } = await db.from("app_params").select("value").eq("key", "comm_ack_days").maybeSingle();
  const days = Number((p as { value: string } | null)?.value ?? 14) || 14;
  const due = draft?.due ?? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const aud = new Set(draft?.audience ?? []); // FB-106 · nothing pre-ticked: the sender chooses who receives it
  return (
    <>
      <PageHeader eyebrow="Communication, New" title={draft ? "Edit the draft" : "New communication"} sub="Each recipient gets an Inbox item and a personal Teams card, plus an e-mail if you keep it ticked. Acknowledgements are tracked person by person." />
      <form action={saveComm} className="grid gap-4" style={{ maxWidth: 860 }}>
        {draft && <input type="hidden" name="id" value={draft.id} />}
        <section className="card"><div className="cb grid gap-3">
          <div className="grid grid-cols-4 gap-3">
            <label className="block"><span className="eyebrow">Entity</span>{ents.length > 1 && !draft ? <select name="entity" className="inp" defaultValue={entity}>{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select> : <><input type="hidden" name="entity" value={entity} /><div className="inp" style={{ background: "var(--gray05)" }}>{ENT[entity]?.name ?? entity}</div></>}</label>
            <label className="block"><span className="eyebrow">Kind</span><select name="kind" className="inp" defaultValue={draft?.kind ?? "information"}><option value="information">Information</option><option value="instruction">Instruction</option><option value="safety">Safety</option><option value="urgent">Urgent</option></select></label>
            <label className="block col-span-2"><span className="eyebrow">Title</span><input name="title" className="inp" required maxLength={200} defaultValue={draft?.title ?? ""} placeholder="New fuel policy at LFPB from 15/11" /></label>
          </div>
          <label className="block"><span className="eyebrow">Message</span><textarea name="body" className="inp" rows={9} required defaultValue={draft?.body ?? ""} placeholder="What changes, from when, what each person must do." /></label>
        </div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Audience in {ENT[entity]?.name ?? entity}</span><span className="mini">tick one or more</span></div><div className="cb grid gap-3">
          <label className="flex gap-2 items-center"><input type="checkbox" name="audience" value="ALL" defaultChecked={aud.has("ALL")} /> All staff of {ENT[entity]?.name ?? entity}</label>
          <div><span className="eyebrow">Posts (holders and deputies)</span><div className="flex flex-wrap gap-3 mt-1">{POSTS.map((p) => <label key={p} className="flex gap-1 items-center mono"><input type="checkbox" name="audience" value={`ROLE:${p}`} defaultChecked={aud.has(`ROLE:${p}`)} />{p}</label>)}</div></div>
          <details><summary className="mini" style={{ cursor: "pointer" }}>People by name ({people.length})</summary><div className="grid grid-cols-3 gap-1 mt-2">{people.map((x) => <label key={x.id} className="flex gap-2 items-center"><input type="checkbox" name="audience" value={`PERSON:${x.id}`} defaultChecked={aud.has(`PERSON:${x.id}`)} />{x.display_name}</label>)}</div></details>
        </div></section>
        <section className="card"><div className="cb grid gap-3">
          <div className="flex flex-wrap gap-6 items-end">
            <label className="flex gap-2 items-center"><input type="checkbox" name="require_ack" defaultChecked={draft?.require_ack ?? true} /> Ask each person to acknowledge</label>
            <label className="block"><span className="eyebrow">Acknowledge by</span><input type="date" name="due" className="inp" defaultValue={due} /></label>
            <label className="flex gap-2 items-center"><input type="checkbox" name="email" defaultChecked={draft?.email ?? false} /> Also send by e-mail</label>
          </div>
          <div className="flex gap-2 justify-end items-center flex-wrap">
            <AudienceCount people={people.map((x) => ({ id: x.id, staff: x.home_entity === entity || (x.entities ?? []).includes(entity), group: !!x.is_group_function, posts: (x.roles ?? []).map(basePost) }))} />
            <button className="btn" type="submit" name="send" value="0">Save as draft</button>
            <button className="btn primary" type="submit" name="send" value="1">Send now</button>
          </div>
        </div></section>
      </form>
    </>
  );
}
