import { NextResponse, type NextRequest } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { canDownloadPdf, getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Manual, Revision } from "@/lib/docs";

/**
 * DOC-13 · real PDF file, rendered on the server by headless Chromium from the print page (same layout),
 * with BOOKMARKS (document outline: parts › chapters › sub-chapters) and tagged structure.
 * The file is kept in storage and handed back as a short signed link (Vercel responses are limited to 4.5 MB).
 * On failure the user gets an error and is asked to try again later (no lesser fallback).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canDownloadPdf(s.roles)) return NextResponse.json({ error: "Download restricted" }, { status: 403 });
  const { id } = await ctx.params;
  const revId = req.nextUrl.searchParams.get("rev") ?? "";
  const sb = await supabaseServer();
  const { data: m } = await sb.from("manuals").select("*").eq("id", id).maybeSingle();
  const { data: r } = await sb.from("revisions").select("*").eq("id", revId).eq("manual_id", id).maybeSingle();
  if (!m || !r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const manual = m as Manual, rev = r as Revision;
  if (!s.group && !s.entities.includes(manual.entity)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const origin = `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  const target = `${origin}/print/manual/${id}?rev=${encodeURIComponent(revId)}`;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1240, height: 1754 } });
    const page = await browser.newPage();
    const hostname = host.split(":")[0];
    // the renderer opens the print page as the requesting user (same session cookies, incl. preview protection)
    await page.setCookie(...req.cookies.getAll().map((c) => ({ name: c.name, value: c.value, domain: hostname, path: "/", secure: origin.startsWith("https"), httpOnly: true, sameSite: "Lax" as const })));
    const resp = await page.goto(target, { waitUntil: "networkidle0", timeout: 40_000 });
    if (!resp || !resp.ok()) throw new Error(`print page HTTP ${resp?.status() ?? "?"}`);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; })))); });
    const fileName = (await page.title()) || `${manual.entity}-${manual.code}-Rev${rev.rev}`;
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, outline: true, tagged: true, timeout: 40_000 });
    const path = `${manual.entity}/${manual.code}/${rev.rev}/exports/${fileName}.pdf`;
    const admin = supabaseAdmin();
    const up = await admin.storage.from("manuals").upload(path, pdf, { upsert: true, contentType: "application/pdf" });
    if (up.error) throw new Error(up.error.message);
    const { data: signed } = await admin.storage.from("manuals").createSignedUrl(path, 300, { download: `${fileName}.pdf` });
    if (!signed) throw new Error("signed link");
    return NextResponse.json({ url: signed.signedUrl, fileName: `${fileName}.pdf` });
  } catch (e) {
    console.error("pdf export failed", manual.code, rev.rev, (e as Error).message);
    return NextResponse.json({ error: "The PDF could not be generated right now. Please try again later." }, { status: 503 });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
