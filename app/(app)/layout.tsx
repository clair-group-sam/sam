import { redirect } from "next/navigation";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sweepTeams } from "@/lib/teams";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  after(() => sweepTeams(supabaseAdmin())); // TMS-02 · tasks created by any action get their Teams card right after the page renders
  return <Shell session={session}>{children}</Shell>;
}
