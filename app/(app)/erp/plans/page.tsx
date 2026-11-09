import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="ERP, Emergency plans" title="Emergency response plans" sub="One plan per entity and scenario, with its manual reference and review dates (ORO.GEN.200(a)(7), ORA.GEN.200, CAO.A.025)." right={await RegisterAdd({ reg: "erp_plans", s })} />
      <Register reg="erp_plans" s={s} open={sp.open} adding={sp.new === "1"} empty="No emergency plan recorded yet." />
    </>
  );
}
