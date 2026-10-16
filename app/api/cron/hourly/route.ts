import type { NextRequest } from "next/server";
// Step 4: 90/30/7-day certificate alerts, MOR 72 h clock (from receipt in S.A.M., SAF-01), reading reminders.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  return Response.json({ ran: new Date().toISOString(), jobs: [] });
}
