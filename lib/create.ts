import type { Session } from "@/lib/session";
import { postMayCreate } from "@/lib/revisions";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** CMM, AM, NPs and their deputies, plus the people Compliance has named (people.can_create_manuals). */
export async function mayCreateManual(s: Session): Promise<boolean> {
  if (postMayCreate(s)) return true;
  if (!s.person) return false;
  const { data, error } = await supabaseAdmin().from("people").select("can_create_manuals").eq("id", s.person.id).maybeSingle();
  return !error && !!(data as { can_create_manuals?: boolean } | null)?.can_create_manuals;
}
