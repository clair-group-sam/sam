import type { SupabaseClient } from "@supabase/supabase-js";
import { PageHeader } from "@/components/Page";
import EntityTile from "@/components/EntityTile";
import { ENT, ENT_COLOR } from "@/lib/nav";
import { ballOf, today, type Stage } from "@/lib/authority";
import { OPEN_STATUSES } from "@/lib/findings";
import { fr } from "@/lib/dates";

/* FB-170 · the Group view of the dashboards (20/11, Guillaume): one tile per entity with a few figures, to see where it burns;
 * a click opens the entity and its full dashboard. Counted straight from four lists read once for every entity — the full state
 * of each entity (reviews, packs, indicators) is only computed for the entity opened, which is what made the Group view slow. */
type Tile = { entity: string; findings: number; findingsLate: number; level1: number; ours: number; theirs: number; filesLate: number; actions: number; actionsLate: number; reports: number; next: { date: string; what: string } | null };

export async function groupTiles(db: SupabaseClient, ents: string[]): Promise<Tile[]> {
  const t0 = today();
  const [{ data: fnd }, { data: fil }, { data: act }, { data: rep }] = await Promise.all([
    db.from("findings").select("entity,status,due,level,number").in("entity", ents).in("status", OPEN_STATUSES).limit(5000),
    db.from("authority_files").select("entity,stage,target_date,ball_override,title").in("entity", ents).not("stage", "in", "(closed,standby)").limit(3000),
    db.from("safety_actions").select("entity,status,due,number").in("entity", ents).in("status", ["open", "in_progress"]).limit(5000),
    db.from("reports").select("entity,status").in("entity", ents).not("status", "in", "(closed,cancelled)").limit(5000),
  ]);
  const F = (fnd ?? []) as { entity: string; status: string; due: string | null; level: string; number: string }[];
  const C = (fil ?? []) as { entity: string; stage: Stage; target_date: string | null; ball_override: "us" | "authority" | null; title: string }[];
  const A = (act ?? []) as { entity: string; status: string; due: string | null; number: string }[];
  const R = (rep ?? []) as { entity: string }[];
  return ents.map((e) => {
    const f = F.filter((x) => x.entity === e), c = C.filter((x) => x.entity === e), a = A.filter((x) => x.entity === e);
    const ours = c.filter((x) => ballOf(x) === "us");
    const coming = [...f.filter((x) => x.due && x.due >= t0).map((x) => ({ date: x.due!, what: `finding ${x.number}` })), ...ours.filter((x) => x.target_date && x.target_date >= t0).map((x) => ({ date: x.target_date!, what: x.title })),
      ...a.filter((x) => x.due && x.due >= t0).map((x) => ({ date: x.due!, what: `action ${x.number}` }))].sort((x, y) => x.date.localeCompare(y.date));
    return { entity: e, findings: f.length, findingsLate: f.filter((x) => x.due && x.due < t0 && !["accepted", "closure_requested"].includes(x.status)).length, level1: f.filter((x) => x.level === "1").length,
      ours: ours.length, theirs: c.length - ours.length, filesLate: ours.filter((x) => x.target_date && x.target_date < t0).length,
      actions: a.length, actionsLate: a.filter((x) => x.due && x.due < t0).length, reports: R.filter((x) => x.entity === e).length, next: coming[0] ?? null };
  });
}

export default async function GroupTiles({ db, ents, title, group }: { db: SupabaseClient; ents: string[]; title: string; group: boolean }) {
  const tiles = await groupTiles(db, ents);
  const n = (v: number, late = false) => <b style={{ fontSize: 22, color: late && v ? "var(--terra)" : undefined }}>{v}</b>;
  return (
    <>
      <PageHeader eyebrow={`Dashboards, ${title}`} title={`${title}, ${group ? "Group view" : "all your entities"}`}
        sub="Where each entity stands, in a few figures. Click an entity to open its full dashboard; come back with Group at the top." />
      <div className="grid md:grid-cols-2 gap-4">
        {tiles.map((t) => { const late = t.findingsLate + t.filesLate + t.actionsLate; const tone = late || t.level1 ? "var(--terra)" : t.ours || t.findings ? "var(--amber-ink)" : "var(--green-ink, #2e7d32)";
          return (
            <EntityTile key={t.entity} entity={t.entity} className="card" style={{ borderTop: `4px solid ${tone}`, padding: 0, width: "100%" }}>
              <div className="ch"><span className="flex items-center gap-2"><span className="entdot" style={{ background: ENT_COLOR[t.entity] ?? "var(--field)" }} /><b style={{ fontSize: 17 }}>{ENT[t.entity]?.name ?? t.entity}</b><span className="mini">{t.entity}</span></span>
                <span className={"pill " + (late || t.level1 ? "red" : t.ours || t.findings ? "amber" : "green")}>{late ? `${late} late` : t.level1 ? `${t.level1} level 1 finding${t.level1 === 1 ? "" : "s"}` : t.ours ? `${t.ours} waiting for us` : "nothing late"}</span></div>
              <div className="cb grid grid-cols-2 gap-x-6 gap-y-3">
                <div>{n(t.findings)} <span className="mini">finding{t.findings === 1 ? "" : "s"} open</span><div className="mini">{t.findingsLate ? <span className="red">{t.findingsLate} past their date</span> : "none late"}{t.level1 ? `, ${t.level1} level 1` : ""}</div></div>
                <div>{n(t.ours)} <span className="mini">CAA application{t.ours === 1 ? "" : "s"} with us</span><div className="mini">{t.filesLate ? <span className="red">{t.filesLate} past target</span> : "none late"}, {t.theirs} with the authority</div></div>
                <div>{n(t.actions)} <span className="mini">safety action{t.actions === 1 ? "" : "s"} open</span><div className="mini">{t.actionsLate ? <span className="red">{t.actionsLate} late</span> : "none late"}</div></div>
                <div>{n(t.reports)} <span className="mini">safety report{t.reports === 1 ? "" : "s"} in progress</span><div className="mini">{t.next ? `next date ${fr(t.next.date)}: ${t.next.what.slice(0, 48)}` : "no date ahead"}</div></div>
              </div>
            </EntityTile>); })}
      </div>
    </>
  );
}
