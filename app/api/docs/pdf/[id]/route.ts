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
    // file name computed here (the page title can still be the app's default when a short document finishes loading first)
    const { data: pubs } = await sb.from("revisions").select("id,published_at").eq("manual_id", id).in("step", ["published", "repository"]).order("published_at", { ascending: false }).limit(1);
    const isPub = rev.step === "published" || rev.step === "repository";
    const suffix = !isPub ? "-DRAFT" : pubs?.[0] && pubs[0].id !== rev.id ? "-SUPERSEDED" : "";
    const fileName = `${manual.entity}-${manual.code}-Iss${rev.issue}-Rev${rev.rev}${suffix}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, outline: true, tagged: true, timeout: 40_000 });
    const safe = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-");
    const path = `${manual.entity}/${safe(manual.code)}/${safe(rev.rev)}/exports/${fileName}.pdf`;
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
