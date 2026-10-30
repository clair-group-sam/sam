import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
import { egressIp, proxyUrl } from "@/lib/proxy-fetch";
import { eccairsConfig, eccairsEnv, taxonomyVersion } from "@/lib/eccairs";

/**
 * Safety desk. GET: the fixed outgoing IP(s) ECCAIRS / EASA must whitelist (through the Fixie proxy).
 * GET ?test=<ENT>: connection test — token + released taxonomy (reads nothing of the reports, changes nothing).
 * Called a few times only (Fixie free plan: 500 requests / month).
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || !isSafetyDesk(s)) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  const ent = req.nextUrl.searchParams.get("test");
  if (ent) {
    if (!eccairsConfig(ent)) return NextResponse.json({ entity: ent, configured: false });
    try { const t = await taxonomyVersion(ent); return NextResponse.json({ entity: ent, env: eccairsEnv(ent), ok: true, taxonomy: t.data }); }
    catch (e) { return NextResponse.json({ entity: ent, env: eccairsEnv(ent), ok: false, error: (e as Error).message }, { status: 502 }); }
  }
  try { const a = await egressIp(); return NextResponse.json({ proxy: !!proxyUrl(), ips: [a.ip].filter(Boolean) }); }
  catch (e) { return NextResponse.json({ proxy: !!proxyUrl(), error: (e as Error).message }, { status: 502 }); }
}
