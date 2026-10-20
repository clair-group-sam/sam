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
  // one line per chapter: number of occurrences and the first short excerpt
  const hits = ((data ?? []) as { ref: string; title: string | null; body_text: string; ord: number }[]).map((s) => {
    const low = s.body_text.toLowerCase();
    let n = 0; let firstIdx = -1;
    for (const w of words) { let i = low.indexOf(w); while (i >= 0) { n++; if (firstIdx < 0 || i < firstIdx) firstIdx = i; i = low.indexOf(w, i + w.length); } }
    const i = Math.max(0, firstIdx);
    const snippet = s.body_text.slice(Math.max(0, i - 50), i + 90).replace(/\s+/g, " ").trim();
    return { ref: s.ref, title: s.title, snippet, n };
  }).filter((h) => h.n > 0 || true);
  return Response.json({ hits, words });
}
