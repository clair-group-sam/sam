import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="ERP, Exercises" title="Exercises" sub="Tabletop, drill and full-scale exercises of the plans, with lessons learned and the actions decided." right={await RegisterAdd({ reg: "erp_exercises", s })} />
      <Register reg="erp_exercises" s={s} open={sp.open} adding={sp.new === "1"} empty="No exercise recorded yet." />
    </>
  );
}
