import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Users & fleet, Aircraft registry" title="Aircraft registry" sub="Every aircraft of the group's AOCs, with its type, base and CAMO. Safety reports and certificates use this list." right={await RegisterAdd({ reg: "aircraft", s })} />
      <Register reg="aircraft" s={s} open={sp.open} adding={sp.new === "1"} empty="No aircraft yet." />
    </>
  );
}
