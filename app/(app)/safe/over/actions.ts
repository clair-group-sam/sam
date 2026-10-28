"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callClaude } from "@/lib/ai";
import { mayEditSpi, spiBoard, BASIS, METRICS, VERDICT, fmt, targetText } from "@/lib/spi";

const db = () => supabaseAdmin();
const str = (fd: FormData, k: string) => { const v = fd.get(k); const t = typeof v === "string" ? v.trim() : ""; return t || null; };
const num = (v: string | null) => { if (v == null) return null; const x = Number(v.replace(",", ".").replace(/\s|%/g, "")); return Number.isFinite(x) ? x : NaN; };
async function desk(entity: string | null): Promise<Session> {
  const s = await getSession(); if (!s) throw new Error("Sign in again.");
  if (!mayEditSpi(s)) throw new Error("Reserved to the safety desk (SM / CMM / FSO).");
  if (!entity || !s.entities.includes(entity)) throw new Error("Pick an entity in your scope.");
  return s;
}
const touch = () => { revalidatePath("/safe/over"); revalidatePath("/safe/over/data"); revalidatePath("/safe/over/set"); revalidatePath("/safe/over/spi/[id]", "page"); };

/** Monthly data grid: fields v|<key>|<YYYY-MM> (value) and d|<key>|<YYYY-MM> (out of, for a percentage). Empty = removed. */
export async function saveData(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity);
  const ups: Record<string, unknown>[] = []; const dels: [string, string][] = []; const bad: string[] = [];
  for (const [k, raw] of fd.entries()) {
    if (typeof raw !== "string" || !k.startsWith("v|")) continue;
    const [, key, m] = k.split("|"); const was = str(fd, `o|${key}|${m}`); const v = raw.trim(); const den = str(fd, `d|${key}|${m}`); const wasDen = str(fd, `od|${key}|${m}`);
    if (v === (was ?? "") && (den ?? "") === (wasDen ?? "")) continue; // unchanged
    if (!v) { if (was != null) dels.push([key, m]); continue; }
    const x = num(v); const dx = den == null ? null : num(den);
    if (Number.isNaN(x) || (dx != null && Number.isNaN(dx))) { bad.push(`${key} ${m}`); continue; }
    ups.push({ entity, key, month: `${m}-01`, value: x, den: dx, source: "manual", entered_by: s.person?.id ?? null, entered_at: new Date().toISOString() });
  }
  if (bad.length) throw new Error(`Not a number: ${bad.slice(0, 5).join(", ")}`);
  if (ups.length) { const { error } = await db().from("spi_data").upsert(ups, { onConflict: "entity,key,month" }); if (error) throw new Error(error.message); }
  for (const [key, m] of dels) await db().from("spi_data").delete().eq("entity", entity!).eq("key", key).eq("month", `${m}-01`);
  touch();
}

/** One month of one SPI from its page: enter / correct a value (it wins over the computed one) or remove it. */
export async function setMonth(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity);
  const key = String(fd.get("key")); const m = String(fd.get("month")); const v = str(fd, "value");
  if (!v) { await db().from("spi_data").delete().eq("entity", entity!).eq("key", key).eq("month", `${m}-01`); touch(); return; }
  const x = num(v); const d = num(str(fd, "den")); if (Number.isNaN(x) || Number.isNaN(d as number)) throw new Error("Not a number.");
  await db().from("spi_data").upsert({ entity, key, month: `${m}-01`, value: x, den: d, source: "manual", note: str(fd, "note"), entered_by: s.person?.id ?? null, entered_at: new Date().toISOString() }, { onConflict: "entity,key,month" });
  touch();
}

const DEF = ["label", "objective", "area", "metric", "basis", "direction", "period", "agg", "ref", "owner_role", "note"] as const;
/** Create or change an SPI and its target for a year. */
export async function saveDef(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity);
  const id = str(fd, "id"); const year = Number(str(fd, "year") ?? new Date().getUTCFullYear());
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of DEF) if (fd.has(k)) row[k] = str(fd, k);
  if (row.metric && !METRICS[String(row.metric)]) throw new Error("Unknown computed metric.");
  if (row.basis && !(String(row.basis) in BASIS)) throw new Error("Unknown basis.");
  let spiId = id;
  if (id) { const { error } = await db().from("spi_defs").update(row).eq("id", id).eq("entity", entity!); if (error) throw new Error(error.message); }
  else {
    const code = str(fd, "code")?.toUpperCase(); if (!code || !row.label) throw new Error("Give the SPI a code and a name.");
    const { data: last } = await db().from("spi_defs").select("sort").eq("entity", entity!).order("sort", { ascending: false }).limit(1);
    const { data, error } = await db().from("spi_defs").insert({ ...row, entity, code, sort: (((last ?? [])[0] as { sort: number } | undefined)?.sort ?? 0) + 1, status: "active" }).select("id").single();
    if (error || !data) throw new Error(error?.message.includes("duplicate") ? `${code} already exists.` : error?.message ?? "Not created."); spiId = (data as { id: string }).id;
  }
  if (fd.has("target") || fd.has("alert")) {
    const t = num(str(fd, "target")); const a = num(str(fd, "alert"));
    if (Number.isNaN(t as number) || Number.isNaN(a as number)) throw new Error("Target and alert are numbers (empty = TBD).");
    await db().from("spi_targets").upsert({ spi_id: spiId, year, target: t, alert: a, note: str(fd, "target_note"), set_by: s.person?.id ?? null, set_at: new Date().toISOString() }, { onConflict: "spi_id,year" });
  }
  touch();
}
export async function setStatus(fd: FormData) {
  const entity = str(fd, "entity"); await desk(entity);
  const st = String(fd.get("status")); if (!["active", "proposed", "retired"].includes(st)) throw new Error("Unknown status.");
  const id = str(fd, "id");
  const q = db().from("spi_defs").update({ status: st, updated_at: new Date().toISOString() }).eq("entity", entity!);
  if (id) await q.eq("id", id); else await q.eq("status", "proposed"); // no id: confirm the whole proposed set
  touch();
}
/** Carry the targets of a year to the next one (yearly review at the SRB / management review). */
export async function copyTargets(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity); const from = Number(fd.get("from")); const to = from + 1;
  const { data: defs } = await db().from("spi_defs").select("id").eq("entity", entity!);
  const ids = ((defs ?? []) as { id: string }[]).map((d) => d.id); if (!ids.length) return;
  const { data: tg } = await db().from("spi_targets").select("spi_id,target,alert,note").eq("year", from).in("spi_id", ids);
  const { data: have } = await db().from("spi_targets").select("spi_id").eq("year", to).in("spi_id", ids);
  const skip = new Set(((have ?? []) as { spi_id: string }[]).map((x) => x.spi_id));
  const rows = ((tg ?? []) as { spi_id: string; target: number | null; alert: number | null; note: string | null }[]).filter((t) => !skip.has(t.spi_id)).map((t) => ({ ...t, year: to, set_by: s.person?.id ?? null }));
  if (rows.length) await db().from("spi_targets").insert(rows);
  touch(); redirect(`/safe/over/set?y=${to}`);
}

/** SRB commentary: a draft of the safety performance review, from the board of the year (the safety desk edits and keeps it). */
export async function draftCommentary(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity); const year = Number(fd.get("year"));
  const b = await spiBoard(entity!, year);
  const lines = b.rows.filter((r) => r.status === "active").map((r) => `${r.code} ${r.label} — target ${targetText(r, r.t)}; Q${b.quarter}: ${fmt(r.quarter, r.basis)} (${VERDICT[r.quarterVerdict][0]}); YTD: ${fmt(r.ytd, r.basis)} (${VERDICT[r.ytdVerdict][0]}); months: ${r.cells.slice(0, Number(b.upTo.slice(5))).map((c, i) => `${i + 1}:${c ? (c.den != null && r.basis === "percent" ? `${c.num}/${c.den}` : c.num) : "-"}`).join(" ")}${r.offTwice ? " · off target two months in a row" : ""}`);
  const act = Object.entries(b.activity).map(([k, v]) => `${k}: ${v.map((x) => x ?? "-").join(" ")}`).join("\n");
  const { text, model } = await callClaude({ agent: "safety", personId: s.person?.id ?? null, entity, maxTokens: 1500,
    system: "You help the Safety Manager of an EASA air operator / training organisation prepare the safety performance part of the Safety Review Board (SRB). Write in English, plain and factual, for the Accountable Manager. Structure: 1) Overall reading (2–3 sentences). 2) Off target — each SPI concerned: value vs target, trend, likely reading (careful: a falling reporting rate usually means less reporting, not more safety), what to decide or check. 3) On target worth noting. 4) Data gaps (months or activity missing) that make a reading unreliable. 5) Proposed SRB decisions (actions, target reviews). Never invent figures; say when data is missing. Max 350 words. No markdown headings, use numbered sections and short paragraphs.",
    user: `Entity ${entity}, year ${year}, data up to ${b.upTo} (current quarter Q${b.quarter}).\nActivity per month:\n${act}\n\nSPIs:\n${lines.join("\n")}` });
  await db().from("spi_notes").insert({ entity, year, quarter: b.quarter, text: text.trim(), model, created_by: s.person?.id ?? null });
  touch();
}
export async function saveCommentary(fd: FormData) {
  const entity = str(fd, "entity"); const s = await desk(entity);
  const t = str(fd, "text"); if (!t) return;
  await db().from("spi_notes").insert({ entity, year: Number(fd.get("year")), quarter: Number(fd.get("quarter")) || null, text: t, created_by: s.person?.id ?? null });
  touch();
}
