import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
/** Full-text search inside one revision: ?rev=<revision id>&q=<words>. RLS limits to the caller's scope. */
export async function GET(req: NextRequest) {
  const rev = req.nextUrl.searchParams.get("rev") ?? "";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!rev || q.length < 2) return Response.json({ hits: [] });
  const sb = await supabaseServer();
  // FB-091 · every word matches as a prefix ("certif" finds certification, certificat…), accents and case ignored by the 'simple' index
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 8);
  if (!words.length) return Response.json({ hits: [] });
  const { data } = await sb.from("revision_sections").select("ref,title,body_text,ord").eq("revision_id", rev).is("deleted_at", null).textSearch("body_text", words.map((w) => `${w}:*`).join(" & "), { config: "simple" }).order("ord").limit(80);
  // one line per chapter: number of occurrences and the first short excerpt
  const hits = ((data ?? []) as { ref: string; title: string | null; body_text: string; ord: number }[]).map((s) => {
    const low = s.body_text.toLowerCase();
    let n = 0; let firstIdx = -1;
    for (const w of words) { let i = low.indexOf(w); while (i >= 0) { n++; if (firstIdx < 0 || i < firstIdx) firstIdx = i; i = low.indexOf(w, i + w.length); } }
    const i = Math.max(0, firstIdx);
    const snippet = s.body_text.slice(Math.max(0, i - 50), i + 90).replace(/\s+/g, " ").trim();
    return { ref: s.ref, title: s.title, snippet, n };
  })
    // cover, contents, list of effective pages… repeat every title: left out; chapters whose title carries a word come first
    .filter((h) => !/^0(\.|$)/.test(h.ref) && !/^(cover|couverture|table des mati|contents|sommaire|liste des pages|list of effective)/i.test((h.title ?? "").trim()))
    .sort((a, b) => Number(words.some((w) => (b.title ?? "").toLowerCase().includes(w))) - Number(words.some((w) => (a.title ?? "").toLowerCase().includes(w))))
    .slice(0, 40);
  return Response.json({ hits, words });
}
