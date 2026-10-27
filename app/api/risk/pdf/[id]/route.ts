import { NextResponse, type NextRequest } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** PDF of a risk assessment (print page rendered by headless Chromium), kept in storage, handed back as a short signed link. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const admin = supabaseAdmin();
  const { data } = await admin.from("risk_assessments").select("id,entity,number,name,version").eq("id", id).maybeSingle();
  const a = data as { id: string; entity: string; number: string; name: string; version: number } | null;
  if (!a || !s.entities.includes(a.entity)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const origin = `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1240, height: 1754 } });
    const page = await browser.newPage();
    const hostname = host.split(":")[0];
    await page.setCookie(...req.cookies.getAll().map((c) => ({ name: c.name, value: c.value, domain: hostname, path: "/", secure: origin.startsWith("https"), httpOnly: true, sameSite: "Lax" as const })));
    const resp = await page.goto(`${origin}/print/risk/${id}`, { waitUntil: "networkidle0", timeout: 40_000 });
    if (!resp || !resp.ok()) throw new Error(`print page HTTP ${resp?.status() ?? "?"}`);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, tagged: true, timeout: 40_000 });
    const safe = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
    const fileName = `${a.entity}-${safe(a.number)}-v${a.version}-${safe(a.name)}`;
    const path = `${a.entity}/risk/${a.id}/${fileName}.pdf`;
    const up = await admin.storage.from("evidence").upload(path, pdf, { upsert: true, contentType: "application/pdf" });
    if (up.error) throw new Error(up.error.message);
    const { data: signed } = await admin.storage.from("evidence").createSignedUrl(path, 300, { download: `${fileName}.pdf` });
    if (!signed) throw new Error("signed link");
    await admin.from("risk_events").insert({ assessment_id: a.id, kind: "pdf", actor: s.person?.id ?? null, note: `PDF exported (v${a.version})` });
    return NextResponse.json({ url: signed.signedUrl, fileName: `${fileName}.pdf` });
  } catch (e) {
    console.error("risk pdf failed", a.number, (e as Error).message);
    return NextResponse.json({ error: "The PDF could not be generated right now. Please try again later." }, { status: 503 });
  } finally { await browser?.close().catch(() => undefined); }
}
