import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";
import { CATEGORY_LABEL, FAMILIES, type FileType } from "@/lib/authority";
import { saveType } from "./actions";

/** One editable form per type (Compliance). The checklist is typed one item per line: "Label | ROLE | optional". */
function TypeForm({ t, isNew }: { t: FileType | null; isNew?: boolean }) {
  const checklist = (t?.checklist ?? []).map((c) => `${c.label}${c.role || c.required === false ? ` | ${c.role ?? ""}` : ""}${c.required === false ? " | optional" : ""}`).join("\n");
  return (
    <form action={saveType} className="grid gap-3 mt-3 p-3" style={{ background: "var(--bg2, #f7f9fb)", borderRadius: 10 }}>
      <div className="grid grid-cols-4 gap-3">
        <label><span className="mini">Code</span>{isNew ? <input name="code" className="inp mono" required placeholder="e.g. DG" /> : <><input type="hidden" name="code" value={t!.code} /><input className="inp mono" value={t!.code} disabled /></>}</label>
        <label className="col-span-2"><span className="mini">Name</span><input name="name" className="inp" required defaultValue={t?.name ?? ""} /></label>
        <label><span className="mini">Family</span><select name="family" className="inp" defaultValue={t?.family ?? FAMILIES[0]}>{FAMILIES.map((f) => <option key={f}>{f}</option>)}</select></label>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <label><span className="mini">Default owner post</span><input name="default_owner_role" className="inp mono" defaultValue={t?.default_owner_role ?? ""} placeholder="NPFO, CMM…" /></label>
        <label><span className="mini">Expected days at the authority</span><input name="target_days" type="number" min={0} className="inp" defaultValue={t?.target_days ?? 20} /></label>
        <label><span className="mini">Order</span><input name="ord" type="number" className="inp" defaultValue={t?.ord ?? 999} /></label>
        <div className="grid gap-1 pt-4"><label className="mini flex items-center gap-2"><input type="checkbox" name="needs_signature" defaultChecked={!!t?.needs_signature} /> needs signatures before submission</label>
          <label className="mini flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={t ? t.active : true} /> active (offered when opening a file)</label></div>
      </div>
      <div>
        <div className="eyebrow mb-1">Route per entity</div>
        <table className="tbl"><tbody>{ENTS4.map((e) => (
          <tr key={e}>
            <td style={{ width: 120 }}><label className="flex items-center gap-2"><input type="checkbox" name={`ent_${e}`} defaultChecked={t?.entities.includes(e) ?? false} /><span className={"ent " + e}>{e}</span></label></td>
            <td className="mini" style={{ width: 90 }}>{ENT[e]?.auth}</td>
            <td><input name={`portal_${e}`} className="inp" defaultValue={t?.routes[e]?.portal ?? ""} placeholder="Portal / form (TM-CAD OPS 4, METEOR APP, OSAC mail…)" /></td>
            <td style={{ width: 160 }}><select name={`category_${e}`} className="inp" defaultValue={t?.routes[e]?.category ?? "approval"}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
          </tr>))}</tbody></table>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="mini">Dossier checklist — one item per line: <code>Label | ROLE | optional</code></span><textarea name="checklist" className="inp mono" rows={Math.max(6, (t?.checklist.length ?? 0) + 2)} defaultValue={checklist} /></label>
        <label><span className="mini">Close-out steps — one per line</span><textarea name="closeout" className="inp" rows={Math.max(6, (t?.closeout.length ?? 0) + 2)} defaultValue={(t?.closeout ?? []).join("\n")} /></label>
      </div>
      <label><span className="mini">Notes (rules of the portal, key identifier, pitfalls)</span><textarea name="notes" className="inp" rows={2} defaultValue={t?.notes ?? ""} /></label>
      <div className="flex items-center gap-3"><button className="btn primary" type="submit">{isNew ? "+ Create the type" : "Save"}</button><span className="mini">Applies to files opened afterwards; existing files keep their own checklist. Keys of unchanged labels are kept.</span></div>
    </form>
  );
}

/** References › Authority application types: the catalogue the Projects module opens files from. */
export default async function Types() {
  const s = await getSession();
  if (!s) redirect("/login");
  const cmm = isCmm(s);
  const { data } = await supabaseAdmin().from("authority_file_types").select("*").order("ord");
  const types = (data ?? []) as FileType[];
  return (
    <>
      <PageHeader eyebrow="References" title="Authority application types" sub="One template per family of application: route per entity, dossier checklist, close-out steps, expected days at the authority. Files opened in Projects copy the checklist of their type." right={<Link href="/proj/auth/new" className="btn primary">Open a file</Link>} />
      {FAMILIES.map((fam) => {
        const ts = types.filter((t) => t.family === fam);
        if (!ts.length) return null;
        return (
          <section key={fam} className="card mb-4">
            <div className="ch"><span className="eyebrow">{fam}</span><span className="mini">{ts.length}</span></div>
            {ts.map((t) => (
              <div key={t.code} className="cb" style={{ borderTop: "1px solid var(--line)", opacity: t.active ? 1 : 0.6 }}>
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="pill">{t.code}</span><b>{t.name}</b>
                  <span className="mini ml-auto">owner {t.default_owner_role ?? "—"} · {t.target_days} days at the authority{t.needs_signature ? " · signature" : ""}{!t.active ? " · inactive" : ""}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <div className="eyebrow mb-1">Route</div>
                    <table className="tbl"><tbody>{ENTS4.filter((e) => t.entities.includes(e)).map((e) => <tr key={e}><td style={{ width: 60 }}><span className={"ent " + e}>{e}</span></td><td>{t.routes[e]?.portal || "—"}<div className="mini">{CATEGORY_LABEL[t.routes[e]?.category ?? ""] ?? t.routes[e]?.category}</div></td></tr>)}</tbody></table>
                    {t.closeout.length > 0 && <><div className="eyebrow mt-3 mb-1">Close-out</div><ol className="pl-5 text-[13px]">{t.closeout.map((c, i) => <li key={i}>{c}</li>)}</ol></>}
                    {t.notes && <p className="mini mt-2">{t.notes}</p>}
                  </div>
                  <div>
                    <div className="eyebrow mb-1">Dossier checklist</div>
                    <ol className="pl-5 text-[13px] grid gap-1">{t.checklist.map((c) => <li key={c.key}>{c.label} <span className="mini mono">{c.role ?? ""}{c.required === false ? " · optional" : ""}</span></li>)}</ol>
                  </div>
                </div>
                {cmm && <details className="mt-2"><summary className="mini underline cursor-pointer">Edit this type</summary><TypeForm t={t} /></details>}
              </div>))}
          </section>);
      })}
      {cmm && (
        <section className="card mb-4">
          <div className="ch"><span className="eyebrow">New type</span><span className="mini">Compliance</span></div>
          <div className="cb"><TypeForm t={null} isNew /></div>
        </section>
      )}
      <p className="mini">Source: Authority Applications Playbook (23/10/2026). Types are maintained here by Compliance (table authority_file_types); a change applies to files opened afterwards. Every change is in the audit log.</p>
    </>
  );
}
