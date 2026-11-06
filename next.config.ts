import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // FB-048 · never serve a cached page: every screen depends on the entity cookie
  experimental: { serverActions: { bodySizeLimit: "10mb" }, staleTimes: { dynamic: 0, static: 0 } },
  // headless Chromium for the PDF export (DOC-13): kept out of the bundle, its binary shipped with the route
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: { "/api/docs/pdf/[id]": ["./node_modules/@sparticuz/chromium/bin/**"], "/api/risk/pdf/[id]": ["./node_modules/@sparticuz/chromium/bin/**"], "/set/core": ["./supabase/migrations/**"] },
};
export default nextConfig;
