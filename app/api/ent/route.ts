import { NextResponse, type NextRequest } from "next/server";
import { normEntity } from "@/lib/entity-codes";
/** Switch the current entity filter (cookie, 1 year). The server re-checks the scope on every page. */
export async function POST(req: NextRequest) {
  const { ent } = (await req.json().catch(() => ({}))) as { ent?: string };
  const e = ent && ent !== "ALL" ? normEntity(ent) : ent;
  const res = NextResponse.json({ ok: true, ent: e });
  if (e) res.cookies.set("sam_ent", e, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
