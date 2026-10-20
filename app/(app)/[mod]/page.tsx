import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { subsFor } from "@/lib/nav";
export default async function ModuleIndex({ params }: { params: Promise<{ mod: string }> }) {
  const { mod } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const first = subsFor(s.role, mod).find((x) => !x.hidden);
  if (!first) notFound();
  redirect(`/${mod}/${first.id}`);
}
