import { NextResponse, type NextRequest } from "next/server";
/** Switch the current entity filter (cookie, 1 year). The server re-checks the scope on every page. */
export async function POST(req: NextRequest) {
  const { ent } = (await req.json().catch(() => ({}))) as { ent?: string };
  const res = NextResponse.json({ ok: true, ent });
  if (ent) res.cookies.set("sam_ent", ent, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
