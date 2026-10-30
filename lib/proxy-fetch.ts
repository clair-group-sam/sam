// Outgoing calls through a fixed-IP proxy (Fixie, Vercel Marketplace: FIXIE_URL = http://user:pass@host:port), for the partners that
// whitelist our IP (ECCAIRS 2 / EASA). HTTPS goes through an HTTP CONNECT tunnel: the proxy sees the host name only, the content stays
// end-to-end encrypted. Without FIXIE_URL (or ECCAIRS_PROXY_URL), the normal fetch is used.
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

export const proxyUrl = () => process.env.ECCAIRS_PROXY_URL || process.env.FIXIE_URL || "";

export async function proxyFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const p = proxyUrl();
  if (!p) return fetch(url, { method: init.method, headers: init.headers, body: init.body, cache: "no-store" });
  const proxy = new URL(p); const target = new URL(url);
  const auth = proxy.username ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` : undefined;
  const port = Number(target.port || 443);
  const socket = await new Promise<import("node:net").Socket>((resolve, reject) => {
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port || 80), method: "CONNECT", path: `${target.hostname}:${port}`, headers: { host: `${target.hostname}:${port}`, ...(auth ? { "proxy-authorization": auth } : {}) }, timeout: 15000 });
    req.on("connect", (res, sock) => (res.statusCode === 200 ? resolve(sock) : reject(new Error(`proxy CONNECT refused (${res.statusCode})`))));
    req.on("timeout", () => req.destroy(new Error("proxy timeout")));
    req.on("error", reject); req.end();
  });
  return new Promise<Response>((resolve, reject) => {
    const req = https.request({ host: target.hostname, port, path: target.pathname + target.search, method: init.method ?? "GET", headers: { ...(init.headers ?? {}), ...(init.body ? { "content-length": String(Buffer.byteLength(init.body)) } : {}) },
      createConnection: () => tls.connect({ socket, servername: target.hostname }), timeout: 25000 }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : String(v)); resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: h })); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject); if (init.body) req.write(init.body); req.end();
  });
}

/** The IP the partner sees (through the proxy when it is set). */
export async function egressIp(): Promise<{ ip: string | null; via: "proxy" | "direct" }> {
  const r = await proxyFetch("https://api.ipify.org?format=json"); const j = (await r.json().catch(() => null)) as { ip?: string } | null;
  return { ip: j?.ip ?? null, via: proxyUrl() ? "proxy" : "direct" };
}
