import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="ERP, Crisis directory" title="Crisis directory" sub="One directory per entity replaces the tables of the MSM, of ENR-CM-15 and of the checklists. A unit member is attached to a post: when the post changes holder in NP management, the directory follows. Activation mode and the printed ERP binder read from here." right={await RegisterAdd({ reg: "erp_contacts", s })} />
      <Register reg="erp_contacts" s={s} open={sp.open} adding={sp.new === "1"} empty="No crisis contact yet." />
    </>
  );
}
