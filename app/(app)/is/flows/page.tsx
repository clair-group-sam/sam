import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Part-IS, Interfaces & contracts" title="Interfaces & contracts" sub="Data exchanged between systems and with external parties, how, under which contract, and whether the contract carries a Part-IS clause." right={await RegisterAdd({ reg: "is_flows", s })} />
      <Register reg="is_flows" s={s} open={sp.open} adding={sp.new === "1"} empty="No interface recorded yet." />
    </>
  );
}
