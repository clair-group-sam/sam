import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Shell session={session}>{children}</Shell>;
}
