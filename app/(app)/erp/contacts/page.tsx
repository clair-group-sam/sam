import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="ERP, Crisis directory" title="Crisis directory" sub="Who to call in a crisis: crisis cell, authorities, investigation bodies, insurers, assistance. Keep phone numbers current; the list opens in activation mode." right={await RegisterAdd({ reg: "erp_contacts", s })} />
      <Register reg="erp_contacts" s={s} open={sp.open} adding={sp.new === "1"} empty="No crisis contact yet." />
    </>
  );
}
