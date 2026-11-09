import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Part-IS, Systems register" title="Systems register" sub="The information systems the organisation relies on for aviation safety (EU 2023/203, IS.I.OR.200): owner, provider, hosting, data and criticality." right={await RegisterAdd({ reg: "is_systems", s })} />
      <Register reg="is_systems" s={s} open={sp.open} adding={sp.new === "1"} empty="No system recorded yet." />
    </>
  );
}
