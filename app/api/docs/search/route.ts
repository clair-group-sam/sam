import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
/** Full-text search inside one revision: ?rev=<revision id>&q=<words>. RLS limits to the caller's scope. */
export async function GET(req: NextRequest) {
  const rev = req.nextUrl.searchParams.get("rev") ?? "";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!rev || q.length < 2) return Response.json({ hits: [] });
  const sb = await supabaseServer();
  const { data } = await sb.from("revision_sections").select("ref,title,body_text,ord").eq("revision_id", rev).textSearch("body_text", q, { type: "websearch", config: "simple" }).order("ord").limit(40);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !/^[-"]/.test(w)).map((w) => w.replace(/"/g, ""));
  const hits = ((data ?? []) as { ref: string; title: string | null; body_text: string; ord: number }[]).flatMap((s) => {
    const low = s.body_text.toLowerCase();
    const out: { ref: string; title: string | null; snippet: string; n: number }[] = [];
    let n = 0; const seen = new Set<number>();
    for (const w of words) { let i = low.indexOf(w); while (i >= 0 && n < 50) { n++; const key = Math.floor(i / 160); if (!seen.has(key) && out.length < 3) { seen.add(key); out.push({ ref: s.ref, title: s.title, snippet: s.body_text.slice(Math.max(0, i - 70), i + 110).replace(/\s+/g, " "), n: 0 }); } i = low.indexOf(w, i + w.length); } }
    return out.map((o) => ({ ...o, n }));
  });
  return Response.json({ hits, words });
}
