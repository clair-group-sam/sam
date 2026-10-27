import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
type CookieToSet = { name: string; value: string; options?: CookieOptions };
const OPEN = ["/login", "/auth", "/api/health", "/api/cron", "/api/import"];

/**
 * Session gate. Pages re-check the session themselves (getSession), so the middleware only has to
 * (1) keep the auth cookies fresh and (2) send anonymous visitors to /login — without ever blocking a request:
 * prefetches are let through untouched and the auth call is capped at 5 s (Vercel kills the function at 25 s).
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = req.nextUrl.pathname;
  if (OPEN.some((p) => path.startsWith(p))) return res;
  if (!url || !key) return NextResponse.redirect(new URL("/login?setup=1", req.url));
  const hasAuthCookie = req.cookies.getAll().some((c) => /^sb-.*-auth-token/.test(c.name));
  if (!hasAuthCookie) return NextResponse.redirect(new URL("/login", req.url));
  // Router prefetches: no auth round-trip (the real navigation will do it).
  if (req.headers.get("next-router-prefetch") || req.headers.get("purpose") === "prefetch" || req.headers.get("sec-purpose")?.includes("prefetch")) return res;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (all: CookieToSet[]) => all.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  try {
    const user = await Promise.race([
      supabase.auth.getUser().then((r) => r.data.user),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
    ]);
    if (user === null) return NextResponse.redirect(new URL("/login", req.url));
  } catch { /* let the page decide */ }
  return res;
}
export const config = { matcher: ["/((?!_next|favicon.ico|icons|logos|manifest.webmanifest|api/health|api/cron|api/import).*)"] };
