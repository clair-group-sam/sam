import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT, ENTS4 } from "@/lib/nav";
import { isCmm } from "@/lib/revisions";

type Line = { ok: boolean | null; what: string; detail: string; href?: string; go?: string };

/* FB-090 · Go-live checklist: what must be in place before other people use S.A.M., read from the data itself. Nothing is stored. */
export default async function GoLive() {
  const s = await getSession(); if (!s) redirect("/login");
  if (!isCmm(s)) redirect("/home/tasks");
  const db = supabaseAdmin();
  const [{ data: eg }, { data: ppl }, { data: np }, { data: ct }, { data: ac }, { data: man }, { data: reg }, { data: esc }, { data: tst }] = await Promise.all([
    db.from("entra_groups").select("group_id,mapped_at,entity,is_group_function"),
    db.from("people").select("id,home_entity,entities,is_group_function,last_seen_at"),
    db.from("np_posts").select("entity,code,holder_name,holder_person"),
    db.from("erp_contacts").select("entity,kind,phone").eq("active", true),
    db.from("aircraft").select("entity,base"),
    db.from("manuals").select("entity,code,current_revision_id"),
    db.from("regulations").select("checked_at").order("checked_at", { ascending: false }).limit(1),
    db.from("audit_log").select("at,object_id").eq("object_type", "escalation").order("id", { ascending: false }).limit(20),
    db.from("reports").select("id").ilike("headline", "%test%").limit(20),
  ]);
  const groups = (eg ?? []) as { mapped_at: string | null; entity: string | null; is_group_function: boolean }[];
  const unmapped = groups.filter((g) => !g.mapped_at && !g.entity && !g.is_group_function).length;
  const people = (ppl ?? []) as { home_entity: string | null; entities: string[] | null; is_group_function: boolean }[];
  const inEnt = (e: string) => people.filter((p) => p.home_entity === e || (p.entities ?? []).includes(e)).length;
  const posts = (np ?? []) as { entity: string; holder_name: string | null; holder_person: string | null }[];
  const contacts = (ct ?? []) as { entity: string; kind: string; phone: string | null }[];
  const fleet = (ac ?? []) as { entity: string; base: string | null }[];
  const manuals = (man ?? []) as { entity: string; current_revision_id: string | null }[];
  const lastEar = ((reg ?? []) as { checked_at: string | null }[])[0]?.checked_at ?? null;
  const E = (esc ?? []) as { at: string; object_id: string }[]; const lastCron = E.find((x) => x.object_id === "cron")?.at ?? null; const lastHand = E.find((x) => x.object_id === "manual")?.at ?? null;
  const days = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
  const lines: Line[] = [
    { ok: unmapped === 0 && groups.length > 0, what: "Microsoft 365 groups mapped to an entity and a post", detail: groups.length ? `${groups.length - unmapped} mapped, ${unmapped} seen and not mapped` : "no group seen yet", href: "/set/groups", go: "Entra groups sync" },
    ...ENTS4.map((e): Line => ({ ok: inEnt(e) > 1, what: `People attached to ${ENT[e]?.name ?? e}`, detail: `${inEnt(e)} person${inEnt(e) === 1 ? "" : "s"} so far; the others arrive at their first sign-in once the groups are mapped`, href: "/users/book", go: "People" })),
    ...ENTS4.map((e): Line => { const p = posts.filter((x) => x.entity === e); const held = p.filter((x) => x.holder_name || x.holder_person).length; return { ok: p.length > 0 && held === p.length, what: `Posts and holders, ${ENT[e]?.name ?? e}`, detail: p.length ? `${p.length} posts, ${held} with a holder` : "no post defined: owners of manuals, findings and tasks cannot be resolved", href: `/np/over?entity=${e}`, go: "NP management" }; }),
    ...ENTS4.map((e): Line => { const c = contacts.filter((x) => x.entity === e && (x.kind === "internal" || x.kind === "investigation")); const miss = c.filter((x) => !x.phone).length; return { ok: c.length ? miss === 0 : null, what: `Crisis directory with phone numbers, ${ENT[e]?.name ?? e}`, detail: c.length ? `${c.length} unit members and bureaux, ${miss} without a phone` : "no crisis directory yet", href: "/erp/contacts", go: "Crisis directory" }; }),
    ...ENTS4.map((e): Line => { const m = manuals.filter((x) => x.entity === e); return { ok: m.some((x) => x.current_revision_id), what: `Manuals published, ${ENT[e]?.name ?? e}`, detail: `${m.filter((x) => x.current_revision_id).length} published of ${m.length}`, href: "/set/integ", go: "Web Manuals import" }; }),
    { ok: fleet.length > 0 && fleet.every((a) => a.base), what: "Aircraft registry complete", detail: `${fleet.length} aircraft, ${fleet.filter((a) => !a.base).length} without a base`, href: "/users/fleet", go: "Aircraft registry" },
    { ok: (days(lastCron) ?? 99) <= 1, what: "Daily jobs running by themselves (reminders, escalations, alerts, snapshots)", detail: lastCron ? `last automatic run ${days(lastCron)} day(s) ago` : `never ran automatically${lastHand ? `, last run by hand ${days(lastHand)} day(s) ago` : ""}: scheduled jobs only fire on the production deployment`, href: "/set/notif", go: "Notification rules" },
    { ok: (days(lastEar) ?? 99) <= 1, what: "EASA rules read every evening", detail: lastEar ? `last check ${days(lastEar)} day(s) ago` : "never checked", href: "/reg/ear", go: "Easy Access Rules" },
    { ok: !(tst ?? []).length, what: "Test data removed", detail: (tst ?? []).length ? `${(tst ?? []).length} safety report(s) named TEST, and the other test objects listed in scripts/cleanup-test-data.sql` : "no test report left", },
  ];
  const done = lines.filter((l) => l.ok).length;
  return (
    <>
      <PageHeader eyebrow="Settings, Go-live checklist" title="Go-live checklist" sub={`What must be in place before the teams use S.A.M., read live from the data: ${done} of ${lines.length} ready.`} />
      <section className="card"><table className="tbl"><thead><tr><th style={{ width: 120 }}>State</th><th>Prerequisite</th><th>Where it stands</th><th style={{ width: 200 }}>Where to fix it</th></tr></thead><tbody>
        {lines.map((l, i) => <tr key={i}><td><span className={"pill " + (l.ok ? "green" : l.ok === null ? "" : "amber")}>{l.ok ? "✓ Ready" : l.ok === null ? "– Not started" : "! To do"}</span></td><td><b>{l.what}</b></td><td className="mini">{l.detail}</td><td>{l.href ? <Link className="underline" href={l.href}>{l.go}</Link> : ""}</td></tr>)}
      </tbody></table></section>
    </>
  );
}
