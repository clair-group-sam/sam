import { NextResponse, type NextRequest } from "next/server";
import { VIEW_RE } from "@/lib/nav";
/** "View as": a super admin looks at S.A.M. as another profile would see it (cookie sam_view, session only).
 *  The cookie alone gives nothing: lib/session honours it for a SUPERADMIN only, and only to reduce what is seen. */
export async function POST(req: NextRequest) {
  const { view } = (await req.json().catch(() => ({}))) as { view?: string };
  const ok = !!view && VIEW_RE.test(view);
  const res = NextResponse.json({ ok: true, view: ok ? view : null });
  if (ok) res.cookies.set("sam_view", view, { path: "/", sameSite: "lax" });
  else res.cookies.delete("sam_view");
  return res;
}
