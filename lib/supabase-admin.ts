import { createClient } from "@supabase/supabase-js";
// Server only. Service role bypasses RLS: use for identity refresh and system jobs, never from the browser.
export const supabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
