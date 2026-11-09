import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="ERP, Response times" title="Response times" sub="The deadlines written in the plan (unit open within 1 h, passenger list within 45 min, authority within 2 h, MOR within 72 h). In activation mode each one runs as a clock from the start, turns red when late and is ticked with its time." right={await RegisterAdd({ reg: "erp_milestones", s })} />
      <Register reg="erp_milestones" s={s} open={sp.open} adding={sp.new === "1"} empty="No response time recorded yet." />
    </>
  );
}
