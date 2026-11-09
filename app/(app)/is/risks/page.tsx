import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import Register, { RegisterAdd } from "@/components/Register";

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string; new?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Part-IS, IS risk assessment" title="IS risk assessment" sub="Information security risks with an impact on aviation safety (IS.I.OR.205): threat, likelihood, severity, treatment and owner." right={await RegisterAdd({ reg: "is_risks", s })} />
      <Register reg="is_risks" s={s} open={sp.open} adding={sp.new === "1"} empty="No information security risk assessed yet." />
    </>
  );
}
