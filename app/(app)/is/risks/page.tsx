import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";
import { ENTS4, ENT } from "@/lib/nav";
import { takeIsHazards } from "./actions";
import { isHazardsToTake } from "@/lib/is-risks";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  const ents = (s.entity === "ALL" ? ENTS4 : [s.entity]).filter((e) => s.group || s.entities.includes(e));
  const toTake = (await Promise.all(ents.map(async (e) => [e, (await isHazardsToTake(e)).length] as const))).filter(([, n]) => n > 0);
  return (
    <>
      <PageHeader eyebrow="Part-IS, IS risk assessment" title="IS risk assessment" sub="Information security risks with an impact on aviation safety (IS.I.OR.205): threat, likelihood, severity, treatment and owner." right={await RegisterAdd({ reg: "is_risks", s })} />
      {toTake.map(([e, n]) => <form key={e} action={takeIsHazards} className="lockbar mb-4" style={{ margin: "0 0 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><input type="hidden" name="entity" value={e} /><span>{ENT[e]?.name ?? e}: the Safety hazard log already holds <b>{n}</b> information-security hazard{n === 1 ? "" : "s"} (HZ IS-…) that {n === 1 ? "is" : "are"} not in this register.</span><button className="btn">Take {n === 1 ? "it" : `the ${n}`} as IS risk{n === 1 ? "" : "s"}</button><span className="mini">copied with their current rating; the hazard log is not changed.</span></form>)}
      <Register reg="is_risks" s={s} open={sp.open} adding={sp.new === "1"} empty="No information security risk assessed yet." />
    </>
  );
}
