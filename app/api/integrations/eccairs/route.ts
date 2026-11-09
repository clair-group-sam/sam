import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { isSafetyDesk } from "@/lib/safety";
import { egressIp, proxyUrl } from "@/lib/proxy-fetch";
import { eccairsConfig, eccairsEnv, taxonomyVersion, tokenDiagnostic } from "@/lib/eccairs";

/**
 * Safety desk. GET: the fixed outgoing IP(s) ECCAIRS / EASA must whitelist (through the Fixie proxy).
 * GET ?test=<ENT>: connection test — token + released taxonomy (reads nothing of the reports, changes nothing).
 * Called a few times only (Fixie free plan: 500 requests / month).
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || !isSafetyDesk(s)) return NextResponse.json({ error: "Safety desk only." }, { status: 403 });
  const diag = req.nextUrl.searchParams.get("diag");
  if (diag) return NextResponse.json(await tokenDiagnostic(diag));
  // raw look at the taxonomy answer for one entity (first attributes only) — to map the field names of the API
  const dump = req.nextUrl.searchParams.get("taxdump");
  if (dump) { const { e2 } = await import("@/lib/eccairs"); const tid = req.nextUrl.searchParams.get("tid") ?? "708"; const code = req.nextUrl.searchParams.get("code") ?? "24"; const attr = Number(req.nextUrl.searchParams.get("attr") ?? "431");
    try { const j = await e2(dump, `/taxonomy-service/external/entity/${code}?taxonomyId=${tid}`); const d = j.data as { attributesList?: { childrenAttributes?: { taxonomyCode: number; valueList?: { id?: number; identifier?: number } | null }[] } } & Record<string, unknown>; const attrs = d?.attributesList?.childrenAttributes ?? [];
      const a = attrs.find((x) => x.taxonomyCode === attr) ?? null; const withList = attrs.filter((x) => x.valueList).map((x) => ({ code: x.taxonomyCode, vl: x.valueList }));
      let list: unknown = null; const vid = a?.valueList?.id;
      if (vid) { try { const r = await e2(dump, `/taxonomy-service/external/value-lists/${vid}?taxonomyId=${tid}`); const dd = r.data as Record<string, unknown>; list = { keys: Object.keys(dd ?? {}), sample: JSON.stringify(dd).slice(0, 1500) }; } catch (e) { list = { error: (e as Error).message }; } }
      return NextResponse.json({ n: attrs.length, attribute: a, lists_in_entity: withList.slice(0, 40), list }); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); } }
  const ent = req.nextUrl.searchParams.get("test");
  if (ent) {
    if (!eccairsConfig(ent)) return NextResponse.json({ entity: ent, configured: false });
    try { const t = await taxonomyVersion(ent); return NextResponse.json({ entity: ent, env: eccairsEnv(ent), ok: true, taxonomy: t.data }); }
    catch (e) { return NextResponse.json({ entity: ent, env: eccairsEnv(ent), ok: false, error: (e as Error).message }, { status: 502 }); }
  }
  try { const a = await egressIp(); return NextResponse.json({ proxy: !!proxyUrl(), ips: [a.ip].filter(Boolean) }); }
  catch (e) { return NextResponse.json({ proxy: !!proxyUrl(), error: (e as Error).message }, { status: 502 }); }
}
