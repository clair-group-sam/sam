/* REG-06 · reading a public watch source: the list of what the page publishes (titles and links), compared with what was seen at the
 * previous round. S.A.M. reads only when Compliance launches a round; pages behind a login are opened by the person (or read with their
 * session by the S.A.M. Reader extension). */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 S.A.M.-watch";
const decode = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;|&#160;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
export type Item = { title: string; url: string };
export type Reading = { ok: boolean; status: number; finalUrl: string; title: string | null; items: Item[]; note?: string; ms: number };

const NAV = /^(home|accueil|menu|search|recherche|login|log in|sign in|connexion|contact|cookies?|privacy|legal|mentions l[ée]gales|english|fran[çc]ais|next|previous|suivant|pr[ée]c[ée]dent|more|plus|read more|en savoir plus|share|partager|top|back|retour|skip to .*|subscribe|newsletter|facebook|twitter|linkedin|youtube|instagram|rss)$/i;
export async function readSource(url: string): Promise<Reading> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en,fr;q=0.8" }, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null;
    const base = new URL(res.url || url);
    // the content of the page, without header, navigation and footer
    const body = (html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
      .replace(/<(script|style|noscript|svg|header|nav|footer|form)[\s\S]*?<\/\1>/gi, " ");
    const seen = new Set<string>(); const items: Item[] = [];
    for (const m of body.matchAll(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = decode(m[2]); if (text.length < 12 || text.length > 300 || NAV.test(text)) continue;
      let href: string; try { href = new URL(m[1].replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
      if (/^(mailto|tel|javascript):/i.test(href)) continue;
      const k = `${text}|${href}`; if (seen.has(k)) continue; seen.add(k);
      items.push({ title: text, url: href }); if (items.length >= 60) break;
    }
    const blocked = res.status === 403 || res.status === 429 || /captcha|cloudflare|access denied|are you a robot|enable javascript/i.test(title ?? "") ;
    return { ok: res.ok && !blocked && items.length > 0, status: res.status, finalUrl: res.url || url, title, items, note: blocked ? "the site refuses automatic reading" : !items.length ? "no list found on the page" : undefined, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, title: null, items: [], note: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}
/** What is on the page now and was not at the previous round (by link, then by title). */
export function newSince(prev: Item[] | null, now: Item[]): Item[] {
  if (!prev) return [];
  const urls = new Set(prev.map((x) => x.url)), titles = new Set(prev.map((x) => x.title));
  return now.filter((x) => !urls.has(x.url) && !titles.has(x.title));
}
