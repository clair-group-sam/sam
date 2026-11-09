import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="ERP, Activation checklists" title="Activation checklists" sub="The actions each member of the crisis cell runs, by phase. In activation mode every action is ticked and timed in the log." right={await RegisterAdd({ reg: "erp_checklists", s })} />
      <Register reg="erp_checklists" s={s} open={sp.open} adding={sp.new === "1"} empty="No activation checklist yet." />
    </>
  );
}
