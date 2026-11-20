import { NextResponse, type NextRequest } from "next/server";
import { normEntity } from "@/lib/entity-codes";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
/** Switch the current entity filter (cookie). The server re-checks the scope on every page.
 *  { ent }: the entity to work in now. { def }: the entity the person lands on (people.default_entity; "" removes it) — it also becomes
 *  the current one. A person with a default starts each browser session on it (session cookie); without one, the last choice is kept a year. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ent?: string; def?: string };
  const norm = (x?: string) => (x && x !== "ALL" ? normEntity(x) : x);
  const s = await getSession();
  let e = norm(body.ent); let hasDefault = !!s?.defaultEntity;
  if (body.def !== undefined && s?.person) {
    const d = norm(body.def) || null;
    const ok = d === null || (d === "ALL" ? s.group || s.entities.length > 1 : s.entities.includes(d));
    if (!ok) return NextResponse.json({ ok: false, error: "Outside your scope" }, { status: 400 });
    const { error } = await supabaseAdmin().from("people").update({ default_entity: d }).eq("id", s.person.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    hasDefault = !!d; if (d) e = d;
  }
  const res = NextResponse.json({ ok: true, ent: e });
  if (e) res.cookies.set("sam_ent", e, { path: "/", sameSite: "lax", ...(hasDefault ? {} : { maxAge: 60 * 60 * 24 * 365 }) });
  return res;
}
