import { redirect } from "next/navigation";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sweepTeams } from "@/lib/teams";
import Shell from "@/components/Shell";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { mayOpen } from "@/lib/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // FB-122 · a screen that is not in the menus of the profile is not opened by its address either
  const path = (await headers()).get("x-sam-path") ?? "";
  // a super admin who is not viewing as someone keeps every screen (they test the pages of the other profiles)
  if (path && !(session.superadmin && !session.viewAs) && !mayOpen(session.role, path) && path !== session.home) redirect(session.home);
  after(() => sweepTeams(supabaseAdmin())); // TMS-02 · tasks created by any action get their Teams card right after the page renders
  return <Shell session={session}>{children}</Shell>;
}
