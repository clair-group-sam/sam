import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Link from "next/link";
import Register, { RegisterAdd } from "@/components/Register";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { lastErpExercises } from "@/lib/erp-exercises";
import { DeleteTest } from "@/components/DeleteTest";
import { isTestData } from "@/lib/testdata";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const scope = s.entity === "ALL" ? s.entities : [s.entity];
  const fromCommittees = [...(await lastErpExercises(supabaseAdmin(), scope)).entries()].filter(([, x]) => x.from === "committee");
  // super admin: the exercises left by a test session, to remove (they count as the yearly exercise while they exist)
  const { data: tx } = s.superadmin && !s.viewAs ? await supabaseAdmin().from("erp_exercises").select("id,entity,scenario,held_on").in("entity", scope) : { data: [] };
  const tests = ((tx ?? []) as { id: string; entity: string; scenario: string; held_on: string | null }[]).filter((x) => isTestData(x.scenario));
  return (
    <>
      <PageHeader eyebrow="ERP, Exercises" title="Exercises" sub="Tabletop, drill and full-scale exercises of the plans, with lessons learned and the actions decided." right={await RegisterAdd({ reg: "erp_exercises", s })} />
      {fromCommittees.length > 0 && <div className="lockbar mb-4" style={{ margin: "0 0 16px" }}>{fromCommittees.map(([e, x]) => <span key={e}>{e}: last ERP exercise held on {x.on.slice(0, 10).split("-").reverse().join("/")} and recorded as a safety meeting ({x.ref}, {x.title}); it counts for the yearly exercise. </span>)}<Link className="underline" href="/safe/comm">Safety › Committees</Link>. Record the next ones here to keep the lessons learned with the plan.</div>}
      <Register reg="erp_exercises" s={s} open={sp.open} adding={sp.new === "1"} empty="No exercise recorded yet." />
      {tests.map((x) => <DeleteTest key={x.id} kind="exercise" id={x.id} what={`${x.entity}, ${x.scenario}${x.held_on ? `, ${x.held_on.slice(8, 10)}/${x.held_on.slice(5, 7)}/${x.held_on.slice(0, 4)}` : ""}`} />)}
    </>
  );
}
