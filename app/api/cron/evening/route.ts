import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
// Evening (19:00 UTC = 20:00 / 21:00 Paris): Morning coffee recaps are deleted — they hold mail and Teams summaries (UX-02).
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  const { count } = await supabaseAdmin().from("coffee_recaps").delete({ count: "exact" }).gte("day", "1900-01-01");
  return Response.json({ ran: new Date().toISOString(), coffee_recaps_deleted: count ?? 0 });
}
