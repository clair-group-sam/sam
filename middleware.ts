import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
type CookieToSet = { name: string; value: string; options?: CookieOptions };
const OPEN = ["/login", "/auth", "/api/health", "/api/cron"];
export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const open = OPEN.some((p) => req.nextUrl.pathname.startsWith(p));
  if (open) return res;
  // Supabase not configured yet (first deploy): send everyone to /login, which explains it.
  if (!url || !key) return NextResponse.redirect(new URL("/login?setup=1", req.url));
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (all: CookieToSet[]) => all.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  return res;
}
export const config = { matcher: ["/((?!_next|favicon.ico|icons|manifest.webmanifest|api/health|api/cron).*)"] };
