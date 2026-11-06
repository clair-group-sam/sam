import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { landingFor } from "@/lib/nav";
export default async function ModuleIndex({ params }: { params: Promise<{ mod: string }> }) {
  const { mod } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const first = landingFor(s.role, mod); // FB-051 · land on a built screen, not on a placeholder
  if (!first) notFound();
  redirect(`/${mod}/${first.id}`);
}
