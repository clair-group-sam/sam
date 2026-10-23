import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { OPEN_STAGES, STAGE_LABEL, daysAtAuthority, fr, today, type AuthorityFile, type Stage } from "@/lib/authority";

const COLS: Stage[] = ["draft", "compliance", "signing", "ready", "submitted", "remarks", "approved", "published"];

/** Projects › Boards: the open authority files as a board, one column per stage. */
export default async function Boards({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { entity: q } = await searchParams;
  const ents = s.group ? ENTS4 : s.entities;
  const entity = q && (q === "ALL" ? s.group : ents.includes(q)) ? q : s.entity;
  const db = supabaseAdmin();
  let fq = db.from("authority_files").select("*").in("stage", OPEN_STAGES).order("target_date", { ascending: true, nullsFirst: false });
  fq = entity === "ALL" ? fq.in("entity", ents) : fq.eq("entity", entity);
  const { data } = await fq;
  const files = (data ?? []) as AuthorityFile[];
  const t0 = today();
  return (
    <>
      <PageHeader eyebrow="Projects · Boards" title="Authority files by stage" sub="Open files, oldest target date first in each column." right={<Link href="/proj/auth/new" className="btn primary">+ New file</Link>} />
      {ents.length > 1 && <div className="chips mb-4" style={{ display: "inline-flex" }}>{(s.group ? ["ALL", ...ents] : ents).map((e) => <Link key={e} href={`/proj/boards?entity=${e}`} className={"ent " + e + (e === entity ? " on" : "")}>{e}</Link>)}</div>}
      <div className="kanban">
        {COLS.map((st) => {
          const col = files.filter((f) => f.stage === st);
          if (st === "signing" && !col.length) return null;
          return (
            <div key={st} className="kcol">
              <div className="kh"><span>{STAGE_LABEL[st]}</span><b>{col.length}</b></div>
              {col.map((f) => { const d = daysAtAuthority(f); const late = (st === "submitted" || st === "remarks") && f.target_date && f.target_date < t0; return (
                <Link key={f.id} href={`/proj/auth/${f.id}`} className={"kcard" + (late ? " late" : "")}>
                  <div className="flex items-center gap-2 mb-1"><span className={"ent " + f.entity}>{f.entity}</span><span className="mono mini">{f.type_code}</span></div>
                  <b>{f.title}</b>
                  <div className="mini">{f.portal_ref ?? f.portal ?? ENT[f.entity]?.auth}{f.owner_role ? ` · ${f.owner_role}` : ""}</div>
                  <div className={"mini" + (late ? " red" : "")}>{f.target_date ? `target ${fr(f.target_date)}` : ""}{d !== null && (st === "submitted" || st === "remarks") ? ` · ${d} d` : ""}{f.rounds ? ` · ${f.rounds} round(s)` : ""}</div>
                </Link>); })}
              {!col.length && <div className="mini p-2">—</div>}
            </div>);
        })}
      </div>
    </>
  );
}
