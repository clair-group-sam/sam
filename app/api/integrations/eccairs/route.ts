import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
import { egressIp, proxyUrl } from "@/lib/proxy-fetch";

/** Safety desk: the fixed outgoing IP ECCAIRS / EASA must whitelist (through the Fixie proxy). Called a few times only (Fixie free plan: 500 requests / month). */
export async function GET() {
  const s = await getSession();
  if (!s || !isSafetyDesk(s)) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  try { const a = await egressIp(); const b = proxyUrl() ? await egressIp() : null; return NextResponse.json({ proxy: !!proxyUrl(), ips: [...new Set([a.ip, b?.ip].filter(Boolean))] }); }
  catch (e) { return NextResponse.json({ proxy: !!proxyUrl(), error: (e as Error).message }, { status: 502 }); }
}
