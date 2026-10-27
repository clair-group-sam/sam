import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, NP_ROLES } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { STEP_LABEL } from "@/lib/docs";
import { FAMILIES, TRIGGERS, type FileType } from "@/lib/authority";
import { createFile } from "../actions";

/** Projects › Authority files › New: a file is opened from a type; S.A.M. copies the route and the checklist of the type. */
export default async function NewAuthorityFile({ searchParams }: { searchParams: Promise<{ entity?: string; type?: string; revision?: string; finding?: string; aircraft?: string; np?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = sp.entity && ents.includes(sp.entity) ? sp.entity : s.entity !== "ALL" && ents.includes(s.entity) ? s.entity : ents[0];
  const db = supabaseAdmin();
  const [{ data: types }, { data: revs }, { data: posts }] = await Promise.all([
    db.from("authority_file_types").select("*").eq("active", true).order("ord"),
    db.from("revisions").select("id,rev,issue,step,manuals!inner(id,code,title,entity)").not("step", "in", "(published,repository)").eq("manuals.entity", entity).order("created_at", { ascending: false }).limit(100),
    db.from("np_posts").select("code,title,holder_name").eq("entity", entity).order("ord"),
  ]);
  const list = ((types ?? []) as FileType[]).filter((t) => t.entities.includes(entity));
  type R = { id: string; rev: string; issue: number; step: string; manuals: { id: string; code: string; title: string; entity: string } };
  const revisions = (revs ?? []) as unknown as R[];
  const pre = revisions.find((r) => r.id === sp.revision);
  const roles = ["CMM", "SM", "AM", ...NP_ROLES.filter((r) => !["NP", "SMD", "QM"].includes(r)), "CAMO"];
  const defType = sp.type && list.some((t) => t.code === sp.type) ? sp.type : pre ? "OM-APP" : list[0]?.code;

  return (
    <>
      <PageHeader eyebrow="Projects · Authority files" title="New authority file" sub={`${ENT[entity]?.name ?? entity} — ${ENT[entity]?.auth ?? ""}. The type sets the route, the checklist and the expected time at the authority.`} />
      <form action={createFile} className="grid grid-cols-3 gap-4 items-start">
        {s.entity === "ALL" ? <div className="mb-3"><label><span className="mini">Entity (group view: choose, the form reloads)</span><div className="flex gap-2 flex-wrap mt-1">{ents.map((e) => <Link key={e} href={`/proj/auth/new?entity=${e}`} className={"btn" + (e === entity ? " primary" : "")}>{ENT[e]?.name ?? e}</Link>)}</div></label><input type="hidden" name="entity" value={entity} /></div> : <input type="hidden" name="entity" value={entity} />}
        <section className="card col-span-2">
          <div className="ch"><span className="eyebrow">The file</span></div>
          <div className="cb grid grid-cols-2 gap-3">
            <label className="col-span-2"><span className="mini">Type</span>
              <select name="type_code" className="inp" defaultValue={defType} required>
                {FAMILIES.map((fam) => { const ts = list.filter((t) => t.family === fam); return ts.length ? <optgroup key={fam} label={fam}>{ts.map((t) => <option key={t.code} value={t.code}>{t.code} — {t.name} · {t.routes[entity]?.portal ?? ""}</option>)}</optgroup> : null; })}
              </select></label>
            <label className="col-span-2"><span className="mini">Title (manual + revision, aircraft, person, programme…)</span><input name="title" className="inp" required placeholder={pre ? `${pre.manuals.code} Iss ${pre.issue} Rev ${pre.rev}` : "e.g. OM-D Iss 01 Rev 17 — addition of the Global Express"} defaultValue={pre ? `${pre.manuals.code} Iss ${pre.issue} Rev ${pre.rev} — ${pre.manuals.title}` : ""} /></label>
            <label><span className="mini">Trigger</span><select name="trigger_kind" className="inp" defaultValue={pre ? "revision" : sp.finding ? "finding" : sp.aircraft ? "aircraft" : sp.np ? "np" : "other"}>{TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label><span className="mini">Trigger note</span><input name="trigger_note" className="inp" placeholder="change request, finding, new aircraft…" /></label>
            <label><span className="mini">Owner (post that prepares the dossier)</span><select name="owner_role" className="inp" defaultValue="">{<option value="">type default</option>}{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label><span className="mini">Target date (decision wanted)</span><input name="target_date" type="date" className="inp" /></label>
            <label><span className="mini">Triggered on</span><input name="triggered_at" type="date" className="inp" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label><span className="mini">MOC reference / server folder</span><input name="moc_ref" className="inp" placeholder="261020 OPS - OM B.06 B.07 C510" /></label>
          </div>
        </section>
        <section className="card">
          <div className="ch"><span className="eyebrow">Linked objects</span></div>
          <div className="cb grid gap-3">
            <label><span className="mini">Manual revision</span><select name="revision_id" className="inp" defaultValue={sp.revision ?? ""}><option value="">—</option>{revisions.map((r) => <option key={r.id} value={r.id}>{r.manuals.code} Iss {r.issue} Rev {r.rev} · {STEP_LABEL[r.step] ?? r.step}</option>)}</select></label>
            <label><span className="mini">Finding reference</span><input name="finding_ref" className="inp" defaultValue={sp.finding ?? ""} placeholder="2026-265B" /></label>
            <label><span className="mini">Aircraft registration</span><input name="aircraft_reg" className="inp" defaultValue={sp.aircraft ?? ""} placeholder="9H-SOC" /></label>
            <label><span className="mini">Nominated post</span><select name="np_post_code" className="inp" defaultValue={sp.np ?? ""}><option value="">—</option>{((posts ?? []) as { code: string; title: string; holder_name: string | null }[]).map((p) => <option key={p.code} value={p.code}>{p.code} — {p.title}{p.holder_name ? ` (${p.holder_name})` : ""}</option>)}</select></label>
            <button className="btn primary mt-2" type="submit">Open the file</button>
            <p className="mini">The checklist of the type is copied into the file; you can add items. Tasks go to the owner's Inbox.</p>
          </div>
        </section>
      </form>
      <section className="card mt-5">
        <div className="ch"><span className="eyebrow">Types available for {entity}</span><Link className="mini underline" href="/ref/types">full reference</Link></div>
        <table className="tbl"><thead><tr><th>Code</th><th>Type</th><th>Route</th><th>Checklist</th><th>Owner</th><th>Days at authority</th></tr></thead>
          <tbody>{list.map((t) => <tr key={t.code}><td className="mono">{t.code}</td><td>{t.name}<div className="mini">{t.family}</div></td><td className="mini">{t.routes[entity]?.portal} · {t.routes[entity]?.category}</td><td className="mini">{t.checklist.length} items{t.needs_signature ? " · signature" : ""}</td><td className="mono">{t.default_owner_role}</td><td className="mono">{t.target_days}</td></tr>)}</tbody></table>
      </section>
    </>
  );
}
