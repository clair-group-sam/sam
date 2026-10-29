import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { leonConfigured } from "@/lib/leon";
import { syncLeonHours } from "@/lib/leon-hours";
// Evening (19:00 UTC = 20:00 / 21:00 Paris): Morning coffee recaps are deleted — they hold mail and Teams summaries (UX-02).
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  const { count } = await supabaseAdmin().from("coffee_recaps").delete({ count: "exact" }).gte("day", "1900-01-01");
  // SPI activity from Leon (ASJMT + ASJFR): this month and the previous one, every evening (journey logs closed late are picked up)
  let leon: unknown = "not configured";
  if (leonConfigured()) { const d = new Date(); const cur = d.toISOString().slice(0, 7); const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    try { leon = (await syncLeonHours([prev, cur])).map((r) => `${r.entity} ${r.month}: ${r.bh} BH`); } catch (e) { leon = (e as Error).message; } }
  return Response.json({ ran: new Date().toISOString(), coffee_recaps_deleted: count ?? 0, leon });
}
