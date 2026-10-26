import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveRefreshToken } from "@/lib/msgraph-user";

/** OAuth return from Supabase (Entra ID). Exchanges the code, then refreshes the person row (scope from Entra groups when present). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { data } = await sb.auth.exchangeCodeForSession(code);
    const user = data?.user;
    if (user) {
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const custom = (meta.custom_claims ?? {}) as Record<string, unknown>;
      const app = (user.app_metadata ?? {}) as Record<string, unknown>;
      const groups = (custom.groups ?? meta.groups ?? app.groups ?? []) as string[];
      const name = (meta.full_name ?? meta.name ?? "") as string;
      try {
        await supabaseAdmin().rpc("touch_person", { p_auth_uid: user.id, p_email: user.email, p_name: name, p_groups: Array.isArray(groups) ? groups : [] });
      } catch { /* identity refresh is best effort; RLS still protects the data */ }
      // Morning coffee: keep the Microsoft refresh token (delegated read-only rights), encrypted, for this person
      const refresh = data?.session?.provider_refresh_token;
      if (refresh) {
        try {
          const { data: p } = await supabaseAdmin().from("people").select("id").eq("auth_uid", user.id).maybeSingle();
          if (p) await saveRefreshToken((p as { id: string }).id, refresh);
        } catch { /* the recap will ask to sign in again */ }
      }
    }
  }
  return NextResponse.redirect(new URL("/home", req.url));
}
