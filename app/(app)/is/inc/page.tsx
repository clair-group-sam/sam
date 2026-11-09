import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Part-IS, IS events & incidents" title="IS events & incidents" sub="Information security events and incidents (IS.I.OR.220 / 230): what happened, the safety impact, the report to the authority and the actions." right={await RegisterAdd({ reg: "is_incidents", s })} />
      <Register reg="is_incidents" s={s} open={sp.open} adding={sp.new === "1"} empty="No information security event recorded yet." />
    </>
  );
}
