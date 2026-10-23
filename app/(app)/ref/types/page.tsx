import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENTS4 } from "@/lib/nav";
import { FAMILIES, type FileType } from "@/lib/authority";

/** References › Authority application types: the catalogue the Projects module opens files from. */
export default async function Types() {
  const s = await getSession();
  if (!s) redirect("/login");
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
              <div key={t.code} className="cb" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="pill">{t.code}</span><b>{t.name}</b>
                  <span className="mini ml-auto">owner {t.default_owner_role ?? "—"} · {t.target_days} days at the authority{t.needs_signature ? " · signature" : ""}{!t.active ? " · inactive" : ""}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <div className="eyebrow mb-1">Route</div>
                    <table className="tbl"><tbody>{ENTS4.filter((e) => t.entities.includes(e)).map((e) => <tr key={e}><td style={{ width: 60 }}><span className={"ent " + e}>{e}</span></td><td>{t.routes[e]?.portal ?? "—"}<div className="mini">{t.routes[e]?.category}</div></td></tr>)}</tbody></table>
                    {t.closeout.length > 0 && <><div className="eyebrow mt-3 mb-1">Close-out</div><ol className="pl-5 text-[13px]">{t.closeout.map((c, i) => <li key={i}>{c}</li>)}</ol></>}
                  </div>
                  <div>
                    <div className="eyebrow mb-1">Dossier checklist</div>
                    <ol className="pl-5 text-[13px] grid gap-1">{t.checklist.map((c) => <li key={c.key}>{c.label} <span className="mini mono">{c.role ?? ""}{c.required === false ? " · optional" : ""}</span></li>)}</ol>
                  </div>
                </div>
              </div>))}
          </section>);
      })}
      <p className="mini">Source: Authority Applications Playbook (23/10/2026). Types are maintained in the database (table authority_file_types); a change to a type applies to files opened afterwards.</p>
    </>
  );
}
